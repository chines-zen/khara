import type { Opportunity } from "@/lib/opportunities";
import { formatDisplayDate } from "@/lib/utils";
import { StageChip } from "./StageChip";

type Props = {
  opp: Opportunity;
  active: boolean;
  onClick: () => void;
  isHidden?: boolean;
};

const fmt = (n: number) => `$${n.toLocaleString()}`;

function daysSince(iso: string): number {
  const then = new Date(iso + "T00:00:00").getTime();
  const now = Date.now();
  return Math.max(0, Math.floor((now - then) / 86_400_000));
}

function UpdatedChip({ date, scNotes, stage }: { date: string | null; scNotes: string; stage: Opportunity["stage"] }) {
  if (stage === "Won" || stage === "Lost") {
    return null;
  }

  if (!date) {
    // Check if SC Notes are actually empty or if there's a parsing error
    const isEmptyNotes = !scNotes || scNotes.trim() === '';
    return (
      <span
        className="text-[10px] font-medium px-1.5 py-0.5 rounded shrink-0 bg-orange-100 text-orange-800"
        title={isEmptyNotes ? "No SC Notes found" : "Date parsing error - no standard date format found"}
      >
        ⚠️ {isEmptyNotes ? "no sc notes" : "parsing error"}
      </span>
    );
  }

  const d = daysSince(date);
  const tone =
    d <= 7
      ? "bg-zd-green/15 text-zd-dark"
      : d <= 14
      ? "bg-amber-100 text-amber-800"
      : "bg-red-100 text-red-700";
  return (
    <span
      className={`text-[10px] font-medium px-1.5 py-0.5 rounded shrink-0 ${tone}`}
      title={`Last updated ${formatDisplayDate(date)}`}
    >
      {d}d since update
    </span>
  );
}

export function OpportunityListItem({ opp, active, onClick, isHidden }: Props) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full text-left p-4 hover:bg-zd-bg transition-colors border-l-4 ${
        active ? "bg-zd-green/5 border-zd-green" : "border-transparent"
      }`}
    >
      <div className="flex justify-between items-start mb-1 gap-2">
        <h3 className="font-bold text-sm text-zd-dark truncate">{opp.name}</h3>
        <UpdatedChip date={opp.lastUpdateDate} scNotes={opp.scNotes} stage={opp.stage} />
      </div>
      <div className="flex justify-between text-xs text-zd-teal/70">
        <span className="truncate">{opp.owner}</span>
        <span className="font-mono font-medium shrink-0">{fmt(opp.amount)}</span>
      </div>
      <div className="mt-2 flex items-center gap-2 flex-wrap">
        <StageChip stage={opp.stage} />
        <span className="text-[10px] text-zd-teal/40">Closes {formatDisplayDate(opp.closeDate)}</span>
        {isHidden && (
          <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-yellow-100 text-yellow-800 ml-auto">
            Hidden
          </span>
        )}
      </div>
    </button>
  );
}
