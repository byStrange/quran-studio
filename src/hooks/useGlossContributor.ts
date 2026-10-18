import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { isTauri } from "@/lib/ai";

export interface GlossContributorStatus {
  /** May open the Uzbek gloss contribution tool and submit batches. */
  isContributor: boolean;
  /** May approve or reject submitted batches into the live corpus. */
  canReview: boolean;
}

const NONE: GlossContributorStatus = { isContributor: false, canReview: false };

/**
 * Whether the signed-in account is on the gloss contributor allowlist.
 *
 * Gated behind `isTauri()`: the tool only works in the desktop backend (the AI
 * runs there), so there is nothing to show — or to ask the database about — in a
 * plain browser. A normal account gets `{false, false}` and never sees the tool.
 */
export function useGlossContributor(): GlossContributorStatus {
  const { data } = useQuery({
    queryKey: ["gloss-contributor-status"],
    enabled: isTauri(),
    staleTime: 5 * 60 * 1000,
    queryFn: async (): Promise<GlossContributorStatus> => {
      const { data, error } = await supabase.rpc("gloss_contributor_status");
      if (error) throw error;
      const row = data?.[0];
      return {
        isContributor: row?.is_contributor ?? false,
        canReview: row?.can_review ?? false,
      };
    },
  });
  return data ?? NONE;
}
