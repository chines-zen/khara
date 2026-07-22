import { useQuery } from "@tanstack/react-query";

async function fetchIsManager(): Promise<boolean> {
  const res = await fetch("/api/me", { credentials: "include" });
  if (!res.ok) return false;
  const me = await res.json().catch(() => null);
  return Boolean(me?.isManager);
}

export function useIsManager(): boolean {
  const { data } = useQuery({
    queryKey: ["me", "isManager"],
    queryFn: fetchIsManager,
    staleTime: Infinity,
    retry: false,
  });
  return data ?? false;
}
