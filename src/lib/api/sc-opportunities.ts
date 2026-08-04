import type { Opportunity } from "@/lib/opportunities";

export class ScUserNotFoundError extends Error {}

export class DataExpiredError extends Error {}

export type ScOpportunitiesResponse = {
  opportunities: Opportunity[];
  metadata: {
    cached: boolean;
    cachedAt: string;
    expiresAt: string;
    count: number;
  };
};

// Fetch opportunities from the DB-cached, server-scoped (SC identity + stage + ARR/close-date) endpoint
export async function fetchOpportunities(): Promise<ScOpportunitiesResponse> {
  const response = await fetch("/api/opportunities/my-sc-opps", {
    credentials: "include",
  });

  if (response.status === 404) {
    const data = await response.json().catch(() => null);
    throw new ScUserNotFoundError(data?.details || "No SC record found for your account.");
  }

  if (response.status === 409) {
    const data = await response.json().catch(() => null);
    if (data?.code === "DATA_EXPIRED") {
      throw new DataExpiredError(
        data?.details || "Please refresh your data. Make sure you're on the VPN before doing so.",
      );
    }
  }

  if (!response.ok) {
    const data = await response.json().catch(() => null);
    throw new Error(data?.details || data?.error || "Failed to fetch opportunities");
  }

  return response.json();
}
