export const HEALTH_QUERY_KEY = ["health"] as const;

export type Health = {
  appUpdatedAt: string | null;
  lastSyncScope: Record<string, unknown> | null;
  devMode: boolean;
  activitiesEnabled: boolean;
  doNotClickActive: boolean;
  claudeTokenConfigured: boolean;
};

// Single source of truth for /api/health. The feature-flag hooks all read from
// this one query key rather than each fetching the endpoint under a key of their
// own, which previously meant three or four identical requests per page load.
export async function fetchHealth(): Promise<Health | null> {
  const res = await fetch("/api/health");
  if (!res.ok) return null;
  return res.json().catch(() => null);
}
