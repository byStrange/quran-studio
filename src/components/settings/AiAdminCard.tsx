import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { describeAiError } from "@/lib/ai";
import { useT } from "@/providers/I18nProvider";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/field";
import { SelectField, Toggle } from "@/components/ui/primitives";
import { useToast } from "@/components/ui/toast";

type Provider = "ollama" | "curialy";

const PROVIDER_LABEL: Record<Provider, string> = {
  ollama: "Ollama Cloud",
  curialy: "Curialy AI",
};

const BASE_URL_HINT: Record<Provider, string> = {
  ollama: "https://ollama.com",
  curialy: "https://api.curialy.tech/v1",
};

/** Admin only: the shared provider credentials and who may use them. */
export function AiAdminCard() {
  const t = useT();
  const toast = useToast();
  const queryClient = useQueryClient();

  const providers = useQuery({
    queryKey: ["ai-admin-providers"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("admin_list_ai_providers");
      if (error) throw error;
      return data ?? [];
    },
  });
  const users = useQuery({
    queryKey: ["ai-admin-users"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("admin_list_ai_users");
      if (error) throw error;
      return data ?? [];
    },
  });

  const [provider, setProvider] = useState<Provider>("curialy");
  const stored = providers.data?.find((p) => p.provider === provider);
  const [apiKey, setApiKey] = useState("");
  const [baseUrl, setBaseUrl] = useState<string | null>(null);
  const [model, setModel] = useState<string | null>(null);
  const [visionModel, setVisionModel] = useState<string | null>(null);
  const [active, setActive] = useState<boolean | null>(null);
  const [filter, setFilter] = useState("");

  const isActive = active ?? stored?.is_active ?? !providers.data?.some((p) => p.is_active);

  const reset = () => {
    setApiKey("");
    setBaseUrl(null);
    setModel(null);
    setVisionModel(null);
    setActive(null);
  };

  const save = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc("admin_save_ai_provider", {
        p_provider: provider,
        p_api_key: apiKey,
        p_base_url: baseUrl ?? stored?.base_url ?? "",
        p_model: model ?? stored?.model ?? "",
        p_vision_model: visionModel ?? stored?.vision_model ?? "",
        p_is_active: isActive,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      reset();
      toast(t("settings.aiAdmin.saved"), "success");
      void queryClient.invalidateQueries({ queryKey: ["ai-admin-providers"] });
      void queryClient.invalidateQueries({ queryKey: ["ai-config"] });
    },
    onError: (e) => toast(describeAiError(e, t), "error"),
  });

  const setAccess = useMutation({
    mutationFn: async (v: { userId: string; granted: boolean }) => {
      const { error } = await supabase.rpc("admin_set_ai_access", {
        p_user: v.userId,
        p_granted: v.granted,
      });
      if (error) throw error;
    },
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["ai-admin-users"] }),
    onError: (e) => toast(describeAiError(e, t), "error"),
  });

  const visibleUsers = (users.data ?? []).filter((u) =>
    u.email.toLowerCase().includes(filter.trim().toLowerCase()),
  );

  return (
    <Card>
      <CardHeader
        title={t("settings.aiAdmin.title")}
        description={t("settings.aiAdmin.description")}
      />
      <CardBody className="space-y-4">
        <div className="flex items-center justify-between gap-6">
          <div className="text-[0.8125rem] font-medium text-fg">
            {t("settings.aiAdmin.provider")}
          </div>
          <SelectField
            value={provider}
            onValueChange={(v) => {
              setProvider(v === "ollama" ? "ollama" : "curialy");
              reset();
            }}
            options={(Object.keys(PROVIDER_LABEL) as Provider[]).map((p) => ({
              value: p,
              label: PROVIDER_LABEL[p],
            }))}
            className="w-44"
          />
        </div>

        <Input
          type="password"
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          placeholder={
            stored?.has_key ? t("settings.aiAdmin.keyKeep") : t("settings.aiAdmin.keyPlaceholder")
          }
          autoComplete="off"
          aria-label={t("settings.aiAdmin.key")}
        />
        <Input
          value={baseUrl ?? stored?.base_url ?? ""}
          onChange={(e) => setBaseUrl(e.target.value)}
          placeholder={`${t("settings.aiAdmin.baseUrl")}: ${BASE_URL_HINT[provider]}`}
          aria-label={t("settings.aiAdmin.baseUrl")}
        />
        <div className="grid grid-cols-2 gap-2">
          <Input
            value={model ?? stored?.model ?? ""}
            onChange={(e) => setModel(e.target.value)}
            placeholder={t("settings.aiAdmin.model")}
            aria-label={t("settings.aiAdmin.model")}
          />
          <Input
            value={visionModel ?? stored?.vision_model ?? ""}
            onChange={(e) => setVisionModel(e.target.value)}
            placeholder={t("settings.aiAdmin.visionModel")}
            aria-label={t("settings.aiAdmin.visionModel")}
          />
        </div>
        <div className="flex items-center justify-between gap-6">
          <div className="text-[0.8125rem] text-fg">{t("settings.aiAdmin.active")}</div>
          <Toggle
            checked={isActive}
            onCheckedChange={setActive}
            label={t("settings.aiAdmin.active")}
          />
        </div>
        <Button
          variant="primary"
          loading={save.isPending}
          disabled={!stored?.has_key && !apiKey.trim()}
          onClick={() => save.mutate()}
        >
          {t("common.save")}
        </Button>

        <div className="space-y-2 border-t border-border pt-4">
          <div className="text-[0.8125rem] font-medium text-fg">
            {t("settings.aiAdmin.people")}
          </div>
          <Input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder={t("settings.aiAdmin.search")}
            aria-label={t("settings.aiAdmin.search")}
          />
          <ul className="max-h-72 divide-y divide-border overflow-y-auto">
            {visibleUsers.map((u) => (
              <li key={u.user_id} className="flex items-center justify-between gap-4 py-2">
                <span className="truncate text-[0.8125rem] text-fg">
                  {u.email}
                  {u.is_admin ? (
                    <span className="ml-2 text-[0.6875rem] text-fg-subtle">
                      {t("settings.aiAdmin.admin")}
                    </span>
                  ) : null}
                </span>
                <Toggle
                  checked={u.has_access || u.is_admin}
                  disabled={u.is_admin || setAccess.isPending}
                  onCheckedChange={(granted) =>
                    setAccess.mutate({ userId: u.user_id, granted })
                  }
                  label={u.email}
                />
              </li>
            ))}
          </ul>
        </div>
      </CardBody>
    </Card>
  );
}
