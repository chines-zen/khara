import { useQuery } from "@tanstack/react-query";
import { HEALTH_QUERY_KEY, fetchHealth, type Health } from "@/lib/api/health";

// Shared reader for the boolean feature flags on /api/health. All callers use the
// same query key, so the endpoint is fetched once per page load no matter how
// many flags are read.
export function useHealthFlag(flag: keyof Health): boolean {
  const { data } = useQuery({
    queryKey: HEALTH_QUERY_KEY,
    queryFn: fetchHealth,
    staleTime: Infinity,
    retry: false,
  });
  return Boolean(data?.[flag]);
}
