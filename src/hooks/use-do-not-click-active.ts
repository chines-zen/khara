import { useQuery } from "@tanstack/react-query";

async function fetchDoNotClickActive(): Promise<boolean> {
  const res = await fetch("/api/health");
  if (!res.ok) return false;
  const health = await res.json().catch(() => null);
  return Boolean(health?.doNotClickActive);
}

export function useDoNotClickActive(): boolean {
  const { data } = useQuery({
    queryKey: ["health", "doNotClickActive"],
    queryFn: fetchDoNotClickActive,
    staleTime: Infinity,
    retry: false,
  });
  return data ?? false;
}
