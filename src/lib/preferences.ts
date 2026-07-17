import { useQuery } from "@tanstack/react-query";
import { fetchUserPreference } from "./api/user-preferences";

export const PREFERRED_NAME_QUERY_KEY = ["userPreference", "preferredName"];
export const TIMEZONE_QUERY_KEY = ["userPreference", "timezone"];

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

// Reads the "timezone" preference (IANA name, e.g. "America/New_York") from
// the server. Falls back to the browser's local timezone when unset so the
// NavBar time sync renders correctly before the user has picked one.
export function useTimezone(): string {
  const { data } = useQuery({
    queryKey: TIMEZONE_QUERY_KEY,
    queryFn: () => fetchUserPreference<string>("timezone"),
    staleTime: 5 * 60 * 1000,
  });

  return data ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
}
