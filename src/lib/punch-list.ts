import { type Opportunity } from "@/lib/opportunities";

export type PunchListSettings = {
  staleNotesEnabled: boolean;
  staleNotesDays: number;
  noScNotesEnabled: boolean;
  noEngagementTypeEnabled: boolean;
  includeHiddenOpps: boolean;
  includeClosedOpps: boolean;
};

export const DEFAULT_PUNCH_LIST_SETTINGS: PunchListSettings = {
  staleNotesEnabled: true,
  staleNotesDays: 14,
  noScNotesEnabled: true,
  noEngagementTypeEnabled: true,
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
          !opp.lastUpdateDate || daysSince(opp.lastUpdateDate) >= settings.staleNotesDays;
        if (isStale) reasons.push(`${settings.staleNotesDays}+ days since Notes Update`);
      }

      if (settings.noScNotesEnabled && !opp.scNotes?.trim()) {
        reasons.push("No SC Notes");
      }

      if (settings.noEngagementTypeEnabled && !opp.scEngagementType?.trim()) {
        reasons.push("No SC Engagement Type");
      }

      return { opp, reasons };
    })
    .filter((row) => row.reasons.length > 0);
}
