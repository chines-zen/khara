type Props = { label: string; value: string; accent?: boolean; delay?: number };

export function KpiCard({ label, value, accent, delay = 0 }: Props) {
  return (
    <div
      className="bg-white p-4 border border-zd-border rounded animate-row"
      style={{ animationDelay: `${delay}ms` }}
    >
      <p className="text-[11px] font-semibold text-zd-teal/60 uppercase tracking-wider mb-1">
        {label}
      </p>
      <p
        className={`text-2xl font-bold font-mono ${accent ? "text-zd-green" : "text-zd-dark"}`}
      >
        {value}
      </p>
    </div>
  );
}
