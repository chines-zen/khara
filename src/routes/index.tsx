import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import { type Opportunity } from "@/lib/opportunities";
import { KpiCard } from "@/components/opportunities/KpiCard";
import { AppNav } from "@/components/opportunities/AppNav";
import { fetchOpportunities } from "@/lib/api/sc-opportunities";
import {
  DashboardFilterBar,
  DEFAULT_DASHBOARD_FILTERS,
  type DashboardFilters,
} from "@/components/opportunities/DashboardFilterBar";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Dashboard — SE Opp Rigor" },
      {
        name: "description",
        content: "Pipeline health overview with key sales KPIs.",
      },
      { property: "og:title", content: "Dashboard — SE Opp Rigor" },
      {
        property: "og:description",
        content: "Pipeline health overview with key sales KPIs.",
      },
    ],
  }),
  component: DashboardPage,
});

const fmtCompact = (n: number) => {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(0)}k`;
  return `$${n}`;
};

const fmtMonth = (key: string) => {
  const [y, m] = key.split("-");
  const d = new Date(Number(y), Number(m) - 1, 1);
  return d.toLocaleString("en-US", { month: "short", year: "2-digit" });
};

const fmtDate = (iso: string) => {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
};


const sfRecordUrl = (id: string) =>
  `https://zendesk.lightning.force.com/lightning/r/Opportunity/${id}/view`;

function applyFilters(opportunities: Opportunity[], filters: DashboardFilters): Opportunity[] {
  const minArr = filters.arrMin === "" ? null : Number(filters.arrMin);
  return opportunities.filter((o) => {
    if (filters.stages.length && !filters.stages.includes(o.stage)) return false;
    if (filters.owner && o.owner !== filters.owner) return false;
    if (filters.closeMonths.length) {
      const monthKey = o.closeDate.slice(0, 7);
      if (!filters.closeMonths.includes(monthKey)) return false;
    }
    if (minArr !== null && !Number.isNaN(minArr) && o.amount < minArr) return false;
    return true;
  });
}


type ChartRow = {
  month: string;
  monthLabel: string;
  opps: { name: string; amount: number }[];
  total: number;
} & Record<string, number | string | { name: string; amount: number }[]>;

function buildChartData(opps: Opportunity[]): ChartRow[] {
  const byMonth = new Map<string, Opportunity[]>();
  opps.forEach((o) => {
    const key = o.closeDate.slice(0, 7);
    if (!byMonth.has(key)) byMonth.set(key, []);
    byMonth.get(key)!.push(o);
  });
  return Array.from(byMonth.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, list]) => {
      const row: ChartRow = {
        month,
        monthLabel: fmtMonth(month),
        opps: list.map((o) => ({ name: o.name, amount: o.amount })),
        total: list.reduce((s, o) => s + o.amount, 0),
      };
      list.forEach((o) => {
        row[o.id] = o.amount;
      });
      return row;
    });
}

const STACK_COLORS = [
  "#2bb673",
  "#1d4f6a",
  "#7bc6a3",
  "#f2a541",
  "#c45c5c",
  "#8a6bbe",
  "#3c89a8",
  "#d97757",
];

function ChartTooltip({ active, payload }: { active?: boolean; payload?: any[] }) {
  if (!active || !payload || !payload.length) return null;
  const row = payload[0].payload as ChartRow;
  return (
    <div className="bg-white border border-zd-border rounded shadow-md p-3 text-xs min-w-[220px]">
      <div className="font-semibold text-zd-dark mb-2">{row.monthLabel}</div>
      <ul className="space-y-1">
        {row.opps.map((o) => (
          <li key={o.name} className="flex justify-between gap-4">
            <span className="text-zd-teal/80 truncate">{o.name}</span>
            <span className="font-mono text-zd-dark">{fmtCompact(o.amount)}</span>
          </li>
        ))}
      </ul>
      <div className="mt-2 pt-2 border-t border-zd-border flex justify-between font-semibold">
        <span>Total</span>
        <span className="font-mono text-zd-green">{fmtCompact(row.total)}</span>
      </div>
    </div>
  );
}

function DashboardPage() {
  const [filters, setFilters] = useState<DashboardFilters>(DEFAULT_DASHBOARD_FILTERS);
  const { data: loaderOpportunities, isError, error: opportunitiesError } = useQuery({
    queryKey: ["opportunities"],
    queryFn: fetchOpportunities,
    retry: false,
  });
  const opportunities = loaderOpportunities?.opportunities ?? [];

  const filtered = useMemo(
    () => applyFilters(opportunities, filters),
    [opportunities, filters],
  );

  const kpis = useMemo(() => {
    const total = filtered.length;
    const won = filtered.filter((o) => o.stage === "Won");
    const lost = filtered.filter((o) => o.stage === "Lost");
    const pipeline = filtered
      .filter((o) => o.stage !== "Won" && o.stage !== "Lost")
      .reduce((s, o) => s + o.amount, 0);
    const closed = won.length + lost.length;
    const winRate = closed > 0 ? (won.length / closed) * 100 : 0;
    const wonValue = won.reduce((s, o) => s + o.amount, 0);
    return { total, wonCount: won.length, wonValue, pipeline, winRate };
  }, [filtered]);

  const chartData = useMemo(() => buildChartData(filtered), [filtered]);
  const oppIds = useMemo(() => filtered.map((o) => o.id), [filtered]);

  if (isError) {
    return (
      <div className="bg-zd-bg font-sans text-zd-dark selection:bg-zd-green/20 min-h-screen">
        <AppNav />
        <main className="p-6">
          <div className="bg-white border border-red-200 rounded p-8 text-center text-sm text-red-600">
            Failed to load opportunities: {opportunitiesError.message}
            <div className="mt-1 text-red-500/70">
              Try refreshing. If this persists, the Snowflake connection may need to be restarted.
            </div>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="bg-zd-bg font-sans text-zd-dark selection:bg-zd-green/20">
      <AppNav />
      <main className="p-6 space-y-6">
        <DashboardFilterBar filters={filters} onChange={setFilters} opportunities={opportunities} />

        <div className="grid grid-cols-4 gap-4">
          <KpiCard label="Total Opportunities" value={String(kpis.total)} />
          <KpiCard
            label={`Won (${kpis.wonCount})`}
            value={fmtCompact(kpis.wonValue)}
            accent
            delay={60}
          />
          <KpiCard label="Pipeline Value" value={fmtCompact(kpis.pipeline)} delay={120} />
          <KpiCard label="Win Rate" value={`${kpis.winRate.toFixed(1)}%`} delay={180} />
        </div>

        <div className="bg-white border border-zd-border rounded p-4">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold text-zd-dark">ARR by Close Month</h2>
            <span className="text-[11px] text-zd-teal/60 font-mono">
              {filtered.length} opps
            </span>
          </div>
          <div className="h-72 w-full">
            {chartData.length === 0 ? (
              <div className="h-full flex items-center justify-center text-sm text-zd-teal/50">
                No data for current filters.
              </div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartData} margin={{ top: 8, right: 16, left: 8, bottom: 8 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" vertical={false} />
                  <XAxis
                    dataKey="monthLabel"
                    tick={{ fontSize: 11, fill: "#5b7a89" }}
                    axisLine={{ stroke: "#e5e7eb" }}
                    tickLine={false}
                  />
                  <YAxis
                    tickFormatter={(v) => fmtCompact(Number(v))}
                    tick={{ fontSize: 11, fill: "#5b7a89" }}
                    axisLine={{ stroke: "#e5e7eb" }}
                    tickLine={false}
                  />
                  <Tooltip
                    cursor={{ fill: "rgba(43,182,115,0.08)" }}
                    content={<ChartTooltip />}
                  />
                  {oppIds.map((id, idx) => (
                    <Bar
                      key={id}
                      dataKey={id}
                      stackId="arr"
                      fill={STACK_COLORS[idx % STACK_COLORS.length]}
                      isAnimationActive={false}
                    />
                  ))}
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>

        <SortableOppTable opps={filtered} />
      </main>
    </div>
  );
}

type SortKey = "name" | "account" | "owner" | "amount" | "stage" | "closeDate";
type SortDir = "asc" | "desc";

const COLUMNS: { key: SortKey; label: string; align?: "right" }[] = [
  { key: "name", label: "Opp" },
  { key: "account", label: "Account" },
  { key: "owner", label: "Owner" },
  { key: "amount", label: "ARR", align: "right" },
  { key: "stage", label: "Stage" },
  { key: "closeDate", label: "Close Date" },
];

function SortableOppTable({ opps }: { opps: Opportunity[] }) {
  const [sortKey, setSortKey] = useState<SortKey>("closeDate");
  const [sortDir, setSortDir] = useState<SortDir>("asc");

  const sorted = useMemo(() => {
    const list = [...opps];
    list.sort((a, b) => {
      const av = a[sortKey];
      const bv = b[sortKey];
      let cmp = 0;
      if (typeof av === "number" && typeof bv === "number") cmp = av - bv;
      else cmp = String(av).localeCompare(String(bv));
      return sortDir === "asc" ? cmp : -cmp;
    });
    return list;
  }, [opps, sortKey, sortDir]);

  const toggleSort = (key: SortKey) => {
    if (key === sortKey) {
      setSortDir(sortDir === "asc" ? "desc" : "asc");
    } else {
      setSortKey(key);
      setSortDir(key === "amount" ? "desc" : "asc");
    }
  };

  return (
    <div className="bg-white border border-zd-border rounded overflow-hidden">
      <div className="px-4 py-3 border-b border-zd-border flex items-center justify-between">
        <h2 className="text-sm font-semibold text-zd-dark">Opportunities</h2>
        <span className="text-[11px] text-zd-teal/60 font-mono">
          {opps.length} {opps.length === 1 ? "row" : "rows"}
        </span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-zd-bg/50 border-b border-zd-border">
            <tr className="text-left text-[10px] font-bold text-zd-teal/60 uppercase tracking-wider">
              {COLUMNS.map((col) => {
                const active = sortKey === col.key;
                const Icon = active ? (sortDir === "asc" ? ArrowUp : ArrowDown) : ArrowUpDown;
                return (
                  <th
                    key={col.key}
                    className={`px-4 py-2 ${col.align === "right" ? "text-right" : ""}`}
                  >
                    <button
                      type="button"
                      onClick={() => toggleSort(col.key)}
                      className={`inline-flex items-center gap-1 uppercase tracking-wider hover:text-zd-dark transition-colors ${
                        active ? "text-zd-dark" : ""
                      } ${col.align === "right" ? "flex-row-reverse" : ""}`}
                    >
                      <span>{col.label}</span>
                      <Icon className={`size-3 ${active ? "opacity-100" : "opacity-40"}`} />
                    </button>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody className="divide-y divide-zd-border">
            {sorted.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-zd-teal/50">
                  No opportunities match the current filters.
                </td>
              </tr>
            ) : (
              sorted.map((o) => (
                <tr
                  key={o.id}
                  onClick={() => window.open(sfRecordUrl(o.id), "_blank", "noopener")}
                  className="cursor-pointer hover:bg-zd-bg/60 transition-colors"
                >
                  <td className="px-4 py-2 font-medium text-zd-dark">{o.name}</td>
                  <td className="px-4 py-2 text-zd-teal/90">{o.account}</td>
                  <td className="px-4 py-2 text-zd-teal/90">{o.owner}</td>
                  <td className="px-4 py-2 text-right font-mono text-zd-dark">
                    {fmtCompact(o.amount)}
                  </td>
                  <td className="px-4 py-2 text-zd-teal/90">{o.stage}</td>
                  <td className="px-4 py-2 font-mono text-zd-teal/80 whitespace-nowrap">
                    {fmtDate(o.closeDate)}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

