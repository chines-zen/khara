import type { Stage } from "@/lib/opportunities";

export function StageChip({ stage }: { stage: Stage }) {
  return (
    <span className="text-[10px] bg-zd-dark/5 text-zd-dark/70 px-1.5 py-0.5 rounded font-medium">
      {stage}
    </span>
  );
}
