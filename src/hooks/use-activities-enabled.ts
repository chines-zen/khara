import { useQuery } from "@tanstack/react-query";

async function fetchActivitiesEnabled(): Promise<boolean> {
  const res = await fetch("/api/health");
  if (!res.ok) return false;
  const health = await res.json().catch(() => null);
  return Boolean(health?.activitiesEnabled);
}

export function useActivitiesEnabled(): boolean {
  const { data } = useQuery({
    queryKey: ["health", "activitiesEnabled"],
    queryFn: fetchActivitiesEnabled,
    staleTime: Infinity,
    retry: false,
  });
  return data ?? false;
}
