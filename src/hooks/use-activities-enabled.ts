import { useHealthFlag } from "@/hooks/use-health-flag";

export function useActivitiesEnabled(): boolean {
  return useHealthFlag("activitiesEnabled");
}
