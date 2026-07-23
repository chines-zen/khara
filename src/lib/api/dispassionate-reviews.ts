// Dispassionate Review (D-Score) history for a single opportunity. Mirrors the
// transformReview shape from services/dispassionate-reviews-cache.js. Note the
// score/notes key asymmetry: the `competitiveness` score dimension pairs with
// the `otherCompetitors` note key.

export type DScoreReviewScores = {
  discovery: string | null;
  solutionFit: string | null;
  architecture: string | null;
  integration: string | null;
  security: string | null;
  netValue: string | null;
  competitiveness: string | null;
  partner: string | null;
  itAlignment: string | null;
  execGoals: string | null;
  services: string | null;
  advancedDemo: string | null;
  testingAccess: string | null;
};

export type DScoreReviewNotes = {
  discovery: string | null;
  solutionFit: string | null;
  architecture: string | null;
  integration: string | null;
  security: string | null;
  netValue: string | null;
  otherCompetitors: string | null;
  partner: string | null;
  itAlignment: string | null;
  execGoals: string | null;
  services: string | null;
  advancedDemo: string | null;
  testingAccess: string | null;
};

export type DScoreReview = {
  id: string;
  opportunityId: string;
  name: string;
  summedDScore: number | null;
  scores: DScoreReviewScores;
  notes: DScoreReviewNotes;
  validFromTimestamp: string | null;
  validToTimestamp: string | null;
  lastActivityDate: string | null;
  syncedAt: string | null;
};

export type DScoreReviewsResponse = {
  reviews: DScoreReview[];
  metadata: {
    cached: boolean;
    cachedAt: string | null;
    count: number;
  };
};

export async function fetchDispassionateReviews(
  oppId: string,
): Promise<DScoreReviewsResponse> {
  const response = await fetch(
    `/api/opportunities/${oppId}/dispassionate-reviews`,
    { credentials: "include" },
  );

  if (!response.ok) {
    const data = await response.json().catch(() => null);
    throw new Error(
      data?.details || data?.error || "Failed to fetch dispassionate reviews",
    );
  }

  return response.json();
}
