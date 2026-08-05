import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/providers/AuthProvider";
import { DEFAULT_UI_PREFS, type Profile, type UiPrefs } from "@/lib/types";
import { detectTimezone } from "@/lib/utils";

export function useProfile() {
  const { user } = useAuth();

  return useQuery({
    queryKey: ["profile", user?.id],
    enabled: Boolean(user),
    queryFn: async (): Promise<Profile> => {
      const { data, error } = await supabase
        .from("profiles")
        .select("*")
        .eq("user_id", user!.id)
        .maybeSingle();
      if (error) throw error;

      // The signup trigger creates this row; if a profile is somehow missing
      // (e.g. a user created before the trigger existed), heal it here.
      if (!data) {
        const { data: created, error: insertError } = await supabase
          .from("profiles")
          .insert({ user_id: user!.id, timezone: detectTimezone() })
          .select()
          .single();
        if (insertError) throw insertError;
        return created;
      }
      return data;
    },
  });
}

/** Merged view of stored preferences over the defaults. */
export function useUiPrefs(): UiPrefs {
  const { data } = useProfile();
  return { ...DEFAULT_UI_PREFS, ...((data?.ui_prefs as Partial<UiPrefs> | null) ?? {}) };
}

export function useUpdateProfile() {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (patch: { timezone?: string; ui_prefs?: Partial<UiPrefs> }) => {
      const { data: current } = await supabase
        .from("profiles")
        .select("ui_prefs")
        .eq("user_id", user!.id)
        .maybeSingle();

      const merged = {
        ...DEFAULT_UI_PREFS,
        ...((current?.ui_prefs as Partial<UiPrefs> | null) ?? {}),
        ...(patch.ui_prefs ?? {}),
      };

      const { data, error } = await supabase
        .from("profiles")
        .update({
          ...(patch.timezone ? { timezone: patch.timezone } : {}),
          ...(patch.ui_prefs ? { ui_prefs: merged } : {}),
          updated_at: new Date().toISOString(),
        })
        .eq("user_id", user!.id)
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: (data) => {
      queryClient.setQueryData(["profile", user?.id], data);
      // Streak day boundaries depend on the timezone.
      queryClient.invalidateQueries({ queryKey: ["streak"] });
      queryClient.invalidateQueries({ queryKey: ["reading-overview"] });
    },
  });
}
