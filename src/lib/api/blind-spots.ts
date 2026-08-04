import type { CloseDatePreset } from "@/lib/fiscal-quarter";
import type { Opportunity } from "@/lib/opportunities";

export type BlindSpotsSettings = {
  ownerEmails: string[];
  arrThreshold: number;
  closeDatePreset?: CloseDatePreset;
  closeDateFrom: string | null;
  closeDateTo: string | null;
};

export type BlindSpotsResponse = {
  opportunities: Opportunity[];
  reviewedOpportunityIds: string[];
  metadata: {
    configured: boolean;
    count: number;
    cached?: boolean;
    cachedAt?: string | null;
    expiresAt?: string | null;
  };
};

export async function fetchBlindSpots(): Promise<BlindSpotsResponse> {
  const response = await fetch("/api/blind-spots", { credentials: "include" });
  if (!response.ok) {
    const data = await response.json().catch(() => null);
    throw new Error(
      data?.details || data?.error || "Failed to fetch Blind Spots",
    );
  }
  return response.json();
}

export async function setBlindSpotReviewed(
  opportunityId: string,
  reviewed: boolean,
): Promise<void> {
  const response = await fetch(
    `/api/blind-spots/${encodeURIComponent(opportunityId)}/reviewed`,
    {
      method: "PUT",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reviewed }),
    },
  );
  if (!response.ok) {
    const data = await response.json().catch(() => null);
    throw new Error(
      data?.details ||
        data?.error ||
        "Failed to update Blind Spot review state",
    );
  }
}
