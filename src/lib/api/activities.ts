export type Activity = {
  id: string;
  accountId: string | null;
  accountName: string | null;
  activityDate: string | null; // ISO yyyy-mm-dd
  activityMonth: string | null; // ISO yyyy-mm-dd (first of month)
  activityYearQuarter: string | null; // e.g. "2026Q3"
  activityYearMonth: string | null; // e.g. "202607"
  subject: string | null;
  type: string | null;
  subType: string | null;
  durationHours: number;
  ownerId: string | null;
  ownerName: string | null;
  ownerRole: string | null;
  createdById: string | null;
  createdByName: string | null;
  whatid: string | null;
  whatidType: string | null; // "Account" | "Opp" | ...
  activityMatchOppName: string | null;
  activityMatchAccountName: string | null;
  isSalesActivity: boolean | null;
  sourceSnapshotDate: string | null;
};

export type ActivitiesResponse = {
  activities: Activity[];
  metadata: {
    cached: boolean;
    cachedAt: string | null;
    count: number;
  };
};

export async function fetchActivities(): Promise<ActivitiesResponse> {
  const response = await fetch("/api/activities", {
    credentials: "include",
  });

  if (!response.ok) {
    const data = await response.json().catch(() => null);
    throw new Error(
      data?.details || data?.error || "Failed to fetch activities",
    );
  }

  return response.json();
}
