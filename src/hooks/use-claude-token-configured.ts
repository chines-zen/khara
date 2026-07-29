import { useQuery } from "@tanstack/react-query";
import { HEALTH_QUERY_KEY, fetchHealth } from "@/lib/api/health";

// Re-exported under the old name so callers that invalidate this flag (see
// OpportunityDetail) keep working — it's now the shared health query key.
export const claudeTokenConfiguredKey = HEALTH_QUERY_KEY;

export function useClaudeTokenConfigured(): boolean {
  const { data, isPending } = useQuery({
    queryKey: HEALTH_QUERY_KEY,
    queryFn: fetchHealth,
    staleTime: Infinity,
    retry: false,
  });
  // Assume configured until we know otherwise, so the "add a token" prompt
  // doesn't flash on every page load.
  if (isPending) return true;
  return Boolean(data?.claudeTokenConfigured);
}
