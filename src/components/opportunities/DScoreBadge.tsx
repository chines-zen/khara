type Props = { score: number; className?: string };

export function dScoreTier(score: number): "low" | "mid" | "high" {
  if (score < 40) return "low";
  if (score <= 70) return "mid";
  return "high";
}

export function DScoreBadge({ score, className = "" }: Props) {
  const tier = dScoreTier(score);
  const styles =
    tier === "high"
      ? "bg-green-100 text-green-700"
      : tier === "mid"
        ? "bg-yellow-100 text-yellow-700"
        : "bg-red-100 text-red-700";
  return (
    <span
      className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase ${styles} ${className}`}
    >
      {score}
    </span>
  );
}
