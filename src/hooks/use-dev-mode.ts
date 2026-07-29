import { useHealthFlag } from "@/hooks/use-health-flag";

export function useDevMode(): boolean {
  return useHealthFlag("devMode");
}
