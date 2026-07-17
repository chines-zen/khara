import { useQuery } from "@tanstack/react-query";
import { fetchUserPreference } from "./api/user-preferences";

export const PREFERRED_NAME_QUERY_KEY = ["userPreference", "preferredName"];

// Reads the "preferredName" preference from the server (Postgres
// user_preferences table) so it follows the logged-in user across devices,
// not just this browser. Settings page saves it via saveUserPreference and
// invalidates PREFERRED_NAME_QUERY_KEY so this picks up the change immediately.
export function usePreferredName(): string {
  const { data } = useQuery({
    queryKey: PREFERRED_NAME_QUERY_KEY,
    queryFn: () => fetchUserPreference<string>("preferredName"),
    staleTime: 5 * 60 * 1000,
  });

  return data ?? "";
}
