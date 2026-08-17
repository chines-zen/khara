export type SnowflakeSyncDomain = {
  durationMs: number;
  records: number;
  syncedTargets: number;
  cached: boolean;
  cachedAt: string | null;
};

export type SnowflakeSyncDomainName =
  | "opportunities"
  | "activities"
  | "blindSpots"
  | "dispassionateReviews"
  | "gongCalls";

export type SnowflakeSyncDomainStatus = {
  domain: SnowflakeSyncDomainName;
  status: "pending" | "running" | "succeeded" | "failed";
  error: string | null;
};

export type SnowflakeSyncRunStatus = {
  id: string;
  status: "running" | "succeeded" | "failed" | "partial";
  error: string | null;
  domains: SnowflakeSyncDomainStatus[];
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
    blindSpots: SnowflakeSyncDomain;
    dispassionateReviews: SnowflakeSyncDomain;
    gongCalls: SnowflakeSyncDomain;
  };
};

/**
 * Refresh all scope-dependent Snowflake mirrors while reporting actual domain
 * state to the caller.
 */
export async function syncSnowflakeData(
  onStatus?: (status: SnowflakeSyncRunStatus) => void,
): Promise<void> {
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

  const { runId } = (await response.json()) as { runId: string };
  const knownDomains: SnowflakeSyncDomainName[] = [
    "opportunities",
    "activities",
    "blindSpots",
    "dispassionateReviews",
    "gongCalls",
  ];

  while (true) {
    const statusResponse = await fetch(`/api/data-sync/${runId}`, {
      credentials: "include",
    });
    if (!statusResponse.ok) {
      throw new Error("Failed to fetch Snowflake sync status");
    }
    const { run } = (await statusResponse.json()) as {
      run: SnowflakeSyncRunStatus;
    };
    const domains = knownDomains.map(
      (domain) =>
        run.domains.find((item) => item.domain === domain) ?? {
          domain,
          status: "pending" as const,
          error: null,
        },
    );
    const current = { ...run, domains };
    onStatus?.(current);
    if (run.status !== "running") {
      if (run.status !== "succeeded") {
        throw new Error(
          run.error ||
            domains.find((domain) => domain.status === "failed")?.error ||
            "Snowflake data sync failed",
        );
      }
      return;
    }
    await new Promise((resolve) => window.setTimeout(resolve, 500));
  }
}
