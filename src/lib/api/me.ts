export const ME_QUERY_KEY = ["me"] as const;

export type Me = {
  id: number;
  email: string;
  name: string;
  createdAt: string;
  lastLogin: string;
  needsEmailSetup: boolean;
  needsOnboarding: boolean;
  isManager: boolean;
};

// Single source of truth for /api/me. Every consumer shares this query key so a
// cold page load makes one request instead of one per hook — each request runs
// the auth middleware, which on a new session resolves the user's Snowflake
// identity, so duplicate calls used to mean duplicate Snowflake work.
export async function fetchMe(): Promise<Me | null> {
  const res = await fetch("/api/me", { credentials: "include" });
  if (!res.ok) return null;
  return res.json().catch(() => null);
}
