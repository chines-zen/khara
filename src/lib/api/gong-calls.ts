export type GongCall = {
  opportunityId: string;
  conversationKey: string;
  callId: string;
  callDate: string | null;
  title: string;
  brief: string;
  nextSteps: string;
  keyPoints: unknown[];
  attendees: GongAttendee[];
  gongUrl: string;
  syncedAt: string | null;
};

export type GongAttendee = {
  name: string;
  company: string;
};

export type GongCallsResponse = {
  calls: GongCall[];
  metadata: {
    cached: boolean;
    cachedAt: string | null;
    count: number;
  };
};

export async function fetchGongCalls(
  oppId: string,
): Promise<GongCallsResponse> {
  const response = await fetch(`/api/opportunities/${oppId}/gong-calls`, {
    credentials: "include",
  });

  if (!response.ok) {
    const data = await response.json().catch(() => null);
    throw new Error(
      data?.details || data?.error || "Failed to fetch Gong calls",
    );
  }

  return response.json();
}
