export const STAGES = [
  "Prospecting",
  "Qualification",
  "Proposal",
  "Negotiation",
  "Won",
  "Lost",
] as const;

export type Stage = (typeof STAGES)[number];

export const CLOSED_STAGES: Stage[] = ["Won", "Lost"];

export type Opportunity = {
  id: string;
  name: string;
  account: string;
  stage: Stage;
  amount: number;
  closeDate: string; // ISO yyyy-mm-dd
  owner: string;
  nameOfSc?: string; // SE assigned to this opp (Snowflake NAME_OF_SC)
  scNotes: string;
  nextSteps: string; // AE Notes (Snowflake NEXT_STEP_C) — free text, not a list
  managerNotes: string;
  scManagerNotes: string;
  scEngagementType?: string;
  productSpecialistNotes?: string;
  dScore: number; // 0-100
  lastUpdateDate: string | null; // Parsed from SC Notes - most recent date mentioned
  recentDScoreDate?: string; // legacy fallback for the D-Score history end date; live opps derive it from lastUpdateDate/closeDate
  latestDScoreReviewDate?: string | null; // ISO yyyy-mm-dd; most recent Dispassionate Review date (live opps), null if none
  dScoreDelta: number;
};
