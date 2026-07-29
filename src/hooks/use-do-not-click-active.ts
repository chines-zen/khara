import { useHealthFlag } from "@/hooks/use-health-flag";

export function useDoNotClickActive(): boolean {
  return useHealthFlag("doNotClickActive");
}
