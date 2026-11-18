-- ---------------------------------------------------------------------------
-- Shared AI credentials, handed out by an admin.
--
-- Until now every reader pasted their own Ollama key into Settings. The key now
-- lives here, once, and an admin decides who may use it:
--
--   * app_admins          who may manage AI access and the provider config.
--   * ai_access           accounts an admin has granted AI to.
--   * ai_provider_config  the provider (Ollama Cloud or Curialy AI), its key,
--                         base URL and models. One row may be active.
--
-- No client can read or write these tables directly (RLS on, no policies, no
-- grants). Everything goes through the SECURITY DEFINER functions below, which
-- check the caller. The first admin is added once in the SQL editor:
--
--   insert into public.app_admins (user_id)
--   select id from auth.users where email = 'you@example.com';
-- ---------------------------------------------------------------------------

create table public.app_admins (
  user_id    uuid        primary key references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);

create table public.ai_access (
  user_id    uuid        primary key references auth.users (id) on delete cascade,
  granted_by uuid        references auth.users (id) on delete set null,
  granted_at timestamptz not null default now()
);

create table public.ai_provider_config (
  provider     text        primary key check (provider in ('ollama', 'curialy')),
  api_key      text        not null,
  base_url     text,
  model        text,
  vision_model text,
  is_active    boolean     not null default false,
  updated_at   timestamptz not null default now()
);

-- At most one active provider.
create unique index ai_provider_config_one_active
  on public.ai_provider_config (is_active) where is_active;

alter table public.app_admins         enable row level security;
alter table public.ai_access          enable row level security;
alter table public.ai_provider_config enable row level security;

revoke all on public.app_admins, public.ai_access, public.ai_provider_config
  from anon, authenticated;

create or replace function public.is_app_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.app_admins where user_id = auth.uid());
$$;

-- What the app asks on start-up: may this account use AI, and may it manage it.
create or replace function public.ai_access_status()
returns table (has_access boolean, is_admin boolean)
language sql
stable
security definer
set search_path = public
as $$
  select
    public.is_app_admin()
      or exists (select 1 from public.ai_access where user_id = auth.uid()),
    public.is_app_admin();
$$;

-- The active provider's credentials, for admins and granted accounts only.
create or replace function public.get_ai_config()
returns table (provider text, api_key text, base_url text, model text, vision_model text)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not (
    public.is_app_admin()
    or exists (select 1 from public.ai_access where user_id = auth.uid())
  ) then
    return;
  end if;
  return query
    select c.provider, c.api_key, c.base_url, c.model, c.vision_model
    from public.ai_provider_config c
    where c.is_active;
end;
$$;

-- --- admin: provider config -------------------------------------------------
-- The key is never returned; the admin sees only whether one is stored.
create or replace function public.admin_list_ai_providers()
returns table (
  provider text, has_key boolean, base_url text, model text,
  vision_model text, is_active boolean
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_app_admin() then
    raise exception 'admin only' using errcode = '42501';
  end if;
  return query
    select c.provider, c.api_key <> '', c.base_url, c.model, c.vision_model, c.is_active
    from public.ai_provider_config c
    order by c.provider;
end;
$$;

-- A null or empty p_api_key keeps the stored key, so base URL / model can be
-- edited without re-entering it. Making a provider active deactivates the other.
create or replace function public.admin_save_ai_provider(
  p_provider     text,
  p_api_key      text,
  p_base_url     text,
  p_model        text,
  p_vision_model text,
  p_is_active    boolean
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_app_admin() then
    raise exception 'admin only' using errcode = '42501';
  end if;
  if p_provider not in ('ollama', 'curialy') then
    raise exception 'unknown provider %', p_provider;
  end if;
  if not exists (select 1 from public.ai_provider_config where provider = p_provider)
     and coalesce(trim(p_api_key), '') = '' then
    raise exception 'an API key is required the first time' using errcode = '22023';
  end if;

  if p_is_active then
    update public.ai_provider_config set is_active = false
    where is_active and provider <> p_provider;
  end if;

  insert into public.ai_provider_config
    (provider, api_key, base_url, model, vision_model, is_active, updated_at)
  values (
    p_provider, trim(p_api_key), nullif(trim(p_base_url), ''),
    nullif(trim(p_model), ''), nullif(trim(p_vision_model), ''), p_is_active, now()
  )
  on conflict (provider) do update set
    api_key      = case when coalesce(trim(p_api_key), '') = ''
                        then public.ai_provider_config.api_key else trim(p_api_key) end,
    base_url     = nullif(trim(p_base_url), ''),
    model        = nullif(trim(p_model), ''),
    vision_model = nullif(trim(p_vision_model), ''),
    is_active    = p_is_active,
    updated_at   = now();
end;
$$;

create or replace function public.admin_delete_ai_provider(p_provider text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_app_admin() then
    raise exception 'admin only' using errcode = '42501';
  end if;
  delete from public.ai_provider_config where provider = p_provider;
end;
$$;

-- --- admin: who has access --------------------------------------------------
create or replace function public.admin_list_ai_users()
returns table (user_id uuid, email text, has_access boolean, is_admin boolean)
language plpgsql
stable
security definer
set search_path = public, auth
as $$
begin
  if not public.is_app_admin() then
    raise exception 'admin only' using errcode = '42501';
  end if;
  return query
    select u.id, u.email::text,
           exists (select 1 from public.ai_access a where a.user_id = u.id),
           exists (select 1 from public.app_admins d where d.user_id = u.id)
    from auth.users u
    order by u.email;
end;
$$;

create or replace function public.admin_set_ai_access(p_user uuid, p_granted boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_app_admin() then
    raise exception 'admin only' using errcode = '42501';
  end if;
  if p_granted then
    insert into public.ai_access (user_id, granted_by)
    values (p_user, auth.uid())
    on conflict (user_id) do nothing;
  else
    delete from public.ai_access where user_id = p_user;
  end if;
end;
$$;

revoke all on function public.is_app_admin() from public;
revoke all on function public.ai_access_status() from public;
revoke all on function public.get_ai_config() from public;
revoke all on function public.admin_list_ai_providers() from public;
revoke all on function public.admin_save_ai_provider(text, text, text, text, text, boolean) from public;
revoke all on function public.admin_delete_ai_provider(text) from public;
revoke all on function public.admin_list_ai_users() from public;
revoke all on function public.admin_set_ai_access(uuid, boolean) from public;

grant execute on function public.ai_access_status() to authenticated;
grant execute on function public.get_ai_config() to authenticated;
grant execute on function public.admin_list_ai_providers() to authenticated;
grant execute on function public.admin_save_ai_provider(text, text, text, text, text, boolean) to authenticated;
grant execute on function public.admin_delete_ai_provider(text) to authenticated;
grant execute on function public.admin_list_ai_users() to authenticated;
grant execute on function public.admin_set_ai_access(uuid, boolean) to authenticated;
