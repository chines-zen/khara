export type SnowflakeSyncDomain = {
  durationMs: number;
  records: number;
  syncedTargets: number;
  cached: boolean;
  cachedAt: string | null;
};

export type SnowflakeDataSyncResponse = {
  success: true;
  runId: string;
  startedAt: string;
  completedAt: string;
  durationMs: number;
  domains: {
    opportunities: SnowflakeSyncDomain;
    activities: SnowflakeSyncDomain;
    dispassionateReviews: SnowflakeSyncDomain;
    gongCalls: SnowflakeSyncDomain;
  };
};

/**
 * Refresh all scope-dependent Snowflake mirrors. The endpoint does not resolve
 * until all four domains are written locally, so callers can safely refetch the
 * cache-backed UI queries together afterwards.
 */
export async function syncSnowflakeData(): Promise<SnowflakeDataSyncResponse> {
  const response = await fetch("/api/data-sync", {
    method: "POST",
    credentials: "include",
  });

  if (!response.ok) {
    const data = await response.json().catch(() => null);
    throw new Error(
      data?.details || data?.error || "Failed to synchronize Snowflake data",
    );
  }

  return response.json();
}
