import type { Stage } from "@/lib/opportunities";

export function StageChip({ stage }: { stage: Stage }) {
  const tone =
    stage === "Won"
      ? "bg-zd-green/15 text-zd-dark"
      : stage === "Lost"
      ? "bg-red-100 text-red-700"
      : "bg-zd-dark/5 text-zd-dark/70";
  return (
    <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${tone}`}>
      {stage}
    </span>
  );
}
