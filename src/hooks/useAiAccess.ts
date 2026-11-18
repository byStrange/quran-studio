import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/providers/AuthProvider";
import { isTauri, setAiConfig, type AiConfig } from "@/lib/ai";

export interface AiAccess {
  /** An admin granted this account AI (admins always have it). */
  hasAccess: boolean;
  isAdmin: boolean;
  loading: boolean;
}

export function useAiAccess(): AiAccess {
  const { user } = useAuth();
  const { data, isLoading } = useQuery({
    queryKey: ["ai-access", user?.id],
    enabled: Boolean(user),
    staleTime: 60 * 1000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("ai_access_status");
      if (error) throw error;
      return {
        hasAccess: data?.[0]?.has_access ?? false,
        isAdmin: data?.[0]?.is_admin ?? false,
      };
    },
  });
  return {
    hasAccess: data?.hasAccess ?? false,
    isAdmin: data?.isAdmin ?? false,
    loading: isLoading,
  };
}

/**
 * Keeps the desktop backend's AI credentials in step with Supabase: fetches the
 * active provider for a granted account and hands it to Rust, and clears it on
 * sign-out or when access is revoked. Mount once, inside the signed-in app.
 */
export function useAiConfigSync(): void {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const { hasAccess, loading } = useAiAccess();
  const { data: config, isFetched } = useQuery({
    queryKey: ["ai-config", user?.id],
    enabled: Boolean(user) && isTauri() && hasAccess,
    staleTime: 5 * 60 * 1000,
    queryFn: async (): Promise<AiConfig | null> => {
      const { data, error } = await supabase.rpc("get_ai_config");
      if (error) throw error;
      const row = data?.[0];
      return row
        ? {
            provider: row.provider === "curialy" ? "curialy" : "ollama",
            apiKey: row.api_key,
            baseUrl: row.base_url,
            model: row.model,
            visionModel: row.vision_model,
          }
        : null;
    },
  });

  const userId = user?.id;
  useEffect(() => {
    if (!isTauri() || loading) return;
    if (userId && hasAccess && !isFetched) return;
    const next = userId && hasAccess ? (config ?? null) : null;
    setAiConfig(next)
      .catch(() => undefined)
      .finally(() => void queryClient.invalidateQueries({ queryKey: ["ai-status"] }));
  }, [userId, hasAccess, loading, config, isFetched, queryClient]);
}
