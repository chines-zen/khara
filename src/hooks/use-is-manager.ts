import { useQuery } from "@tanstack/react-query";
import { ME_QUERY_KEY, fetchMe } from "@/lib/api/me";

export function useIsManager(): boolean {
  const { data } = useQuery({
    queryKey: ME_QUERY_KEY,
    queryFn: fetchMe,
    staleTime: Infinity,
    retry: false,
  });
  return Boolean(data?.isManager);
}
