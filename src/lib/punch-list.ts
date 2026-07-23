import { type Opportunity } from "@/lib/opportunities";

export type PunchListSettings = {
  staleNotesEnabled: boolean;
  staleNotesDays: number;
  staleDScoreEnabled: boolean;
  staleDScoreDays: number;
  noScNotesEnabled: boolean;
  noEngagementTypeEnabled: boolean;
  dScoreBelowEnabled: boolean;
  dScoreBelowThreshold: number;
  dScoreAboveEnabled: boolean;
  dScoreAboveThreshold: number;
  includeHiddenOpps: boolean;
  includeClosedOpps: boolean;
};

export const DEFAULT_PUNCH_LIST_SETTINGS: PunchListSettings = {
  staleNotesEnabled: true,
  staleNotesDays: 14,
  staleDScoreEnabled: true,
  staleDScoreDays: 14,
  noScNotesEnabled: true,
  noEngagementTypeEnabled: true,
  dScoreBelowEnabled: false,
  dScoreBelowThreshold: 5,
  dScoreAboveEnabled: false,
  dScoreAboveThreshold: 25,
  includeHiddenOpps: false,
  includeClosedOpps: false,
};

export type PunchListRow = {
  opp: Opportunity;
  reasons: string[];
};

function daysSince(dateIso: string): number {
  return Math.floor(
    (Date.now() - new Date(dateIso + "T00:00:00").getTime()) / 86_400_000,
  );
}

export function buildPunchList(
  opportunities: Opportunity[],
  hiddenIds: string[],
  settings: PunchListSettings,
): PunchListRow[] {
  let scoped = settings.includeHiddenOpps
    ? opportunities
    : opportunities.filter((o) => !hiddenIds.includes(o.id));

  if (!settings.includeClosedOpps) {
    scoped = scoped.filter((o) => o.stage !== "Won" && o.stage !== "Lost");
  }

  return scoped
    .map((opp) => {
      const reasons: string[] = [];

      if (settings.staleNotesEnabled) {
        const isStale =
          !opp.lastUpdateDate ||
          daysSince(opp.lastUpdateDate) >= settings.staleNotesDays;
        if (isStale)
          reasons.push(`${settings.staleNotesDays}+ days since Notes Update`);
      }

      if (settings.staleDScoreEnabled) {
        // Prefer the live latest review date; fall back to mock recentDScoreDate.
        // Missing entirely (no review on record) counts as stale, per punch-list intent.
        const reviewDate = opp.latestDScoreReviewDate ?? opp.recentDScoreDate;
        const isStale =
          !reviewDate || daysSince(reviewDate) >= settings.staleDScoreDays;
        if (isStale)
          reasons.push(
            `${settings.staleDScoreDays}+ days since D-Score Update`,
          );
      }

      if (settings.noScNotesEnabled && !opp.scNotes?.trim()) {
        reasons.push("No SE Notes");
      }

      if (settings.noEngagementTypeEnabled && !opp.scEngagementType?.trim()) {
        reasons.push("No SE Engagement Type");
      }

      if (
        settings.dScoreBelowEnabled &&
        opp.dScore < settings.dScoreBelowThreshold
      ) {
        reasons.push(`D-Score below ${settings.dScoreBelowThreshold}`);
      }

      if (
        settings.dScoreAboveEnabled &&
        opp.dScore > settings.dScoreAboveThreshold
      ) {
        reasons.push(`D-Score above ${settings.dScoreAboveThreshold}`);
      }

      return { opp, reasons };
    })
    .filter((row) => row.reasons.length > 0);
}
