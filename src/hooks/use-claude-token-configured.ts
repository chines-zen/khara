import { useQuery } from "@tanstack/react-query";

export const claudeTokenConfiguredKey = ["health", "claudeTokenConfigured"];

async function fetchClaudeTokenConfigured(): Promise<boolean> {
  const res = await fetch("/api/health");
  if (!res.ok) return false;
  const health = await res.json().catch(() => null);
  return Boolean(health?.claudeTokenConfigured);
}

export function useClaudeTokenConfigured(): boolean {
  const { data } = useQuery({
    queryKey: claudeTokenConfiguredKey,
    queryFn: fetchClaudeTokenConfigured,
    staleTime: Infinity,
    retry: false,
  });
  return data ?? true;
}
