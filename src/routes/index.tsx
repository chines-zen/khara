import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  Check,
  ChevronDown,
} from "lucide-react";

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";
import { type Opportunity } from "@/lib/opportunities";
import { KpiCard } from "@/components/opportunities/KpiCard";
import { AppNav } from "@/components/opportunities/AppNav";
import { fetchOpportunities } from "@/lib/api/sc-opportunities";
import { useIsManager } from "@/hooks/use-is-manager";
import { sfRecordUrl } from "@/lib/sfdc";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  DashboardFilterBar,
  DEFAULT_DASHBOARD_FILTERS,
  type DashboardFilters,
} from "@/components/opportunities/DashboardFilterBar";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Dash — KHARA" },
      {
        name: "description",
        content: "Pipeline health overview with key sales KPIs.",
      },
      { property: "og:title", content: "Dash — KHARA" },
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

function applyFilters(
  opportunities: Opportunity[],
  filters: DashboardFilters,
): Opportunity[] {
  const minArr = filters.arrMin === "" ? null : Number(filters.arrMin);
  return opportunities.filter((o) => {
    if (filters.stages.length && !filters.stages.includes(o.stage))
      return false;
    if (filters.owners.length && !filters.owners.includes(o.owner))
      return false;
    if (
      filters.ses.length &&
      (!o.nameOfSc || !filters.ses.includes(o.nameOfSc))
    )
      return false;
    if (filters.closeMonths.length) {
      const monthKey = o.closeDate.slice(0, 7);
      if (!filters.closeMonths.includes(monthKey)) return false;
    }
    if (minArr !== null && !Number.isNaN(minArr) && o.amount < minArr)
      return false;
    return true;
  });
}

type GroupByOption = "opp" | "owner" | "stage" | "nameOfSc";
type WinRateMode = "count" | "value";

const GROUP_BY_LABELS: Record<GroupByOption, string> = {
  opp: "Opp",
  owner: "AE",
  stage: "Stage",
  nameOfSc: "SE",
};

function groupKeyFor(o: Opportunity, groupBy: GroupByOption): string {
  if (groupBy === "opp") return o.id;
  if (groupBy === "nameOfSc") return o.nameOfSc ?? "Unassigned";
  return o[groupBy];
}

function groupLabelFor(o: Opportunity, groupBy: GroupByOption): string {
  if (groupBy === "opp") return o.name;
  return groupKeyFor(o, groupBy);
}

type ChartRow = {
  month: string;
  monthLabel: string;
  items: { key: string; label: string; amount: number }[];
  total: number;
} & Record<
  string,
  number | string | { key: string; label: string; amount: number }[]
>;

type ChartSeries = { key: string; label: string };

function buildChartData(
  opps: Opportunity[],
  groupBy: GroupByOption,
): { rows: ChartRow[]; series: ChartSeries[] } {
  const byMonth = new Map<string, Opportunity[]>();
  opps.forEach((o) => {
    const key = o.closeDate.slice(0, 7);
    if (!byMonth.has(key)) byMonth.set(key, []);
    byMonth.get(key)!.push(o);
  });

  const seriesLabels = new Map<string, string>();
  opps.forEach((o) => {
    const key = groupKeyFor(o, groupBy);
    if (!seriesLabels.has(key))
      seriesLabels.set(key, groupLabelFor(o, groupBy));
  });
  const series = Array.from(seriesLabels.entries())
    .map(([key, label]) => ({ key, label }))
    .sort((a, b) => a.label.localeCompare(b.label));

  const rows = Array.from(byMonth.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, list]) => {
      const groupTotals = new Map<string, number>();
      list.forEach((o) => {
        const key = groupKeyFor(o, groupBy);
        groupTotals.set(key, (groupTotals.get(key) ?? 0) + o.amount);
      });
      const row: ChartRow = {
        month,
        monthLabel: fmtMonth(month),
        total: list.reduce((s, o) => s + o.amount, 0),
        items: Array.from(groupTotals.entries())
          .map(([key, amount]) => ({
            key,
            label: seriesLabels.get(key) ?? key,
            amount,
          }))
          .sort((a, b) => b.amount - a.amount),
      };
      groupTotals.forEach((amount, key) => {
        row[key] = amount;
      });
      return row;
    });

  return { rows, series };
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

function ChartTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: any[];
}) {
  if (!active || !payload || !payload.length) return null;
  const row = payload[0].payload as ChartRow;
  return (
    <div className="bg-white border border-zd-border rounded shadow-md p-3 text-xs min-w-[220px]">
      <div className="font-semibold text-zd-dark mb-2">{row.monthLabel}</div>
      <ul className="space-y-1">
        {row.items.map((item) => (
          <li key={item.key} className="flex justify-between gap-4">
            <span className="text-zd-teal/80 truncate">{item.label}</span>
            <span className="font-mono text-zd-dark">
              {fmtCompact(item.amount)}
            </span>
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
  const [filters, setFilters] = useState<DashboardFilters>(
    DEFAULT_DASHBOARD_FILTERS,
  );
  const [groupBy, setGroupBy] = useState<GroupByOption>("owner");
  const [groupByOpen, setGroupByOpen] = useState(false);
  const [winRateMode, setWinRateMode] = useState<WinRateMode>("count");
  const {
    data: loaderOpportunities,
    isError,
    error: opportunitiesError,
  } = useQuery({
    queryKey: ["opportunities"],
    queryFn: fetchOpportunities,
    retry: false,
  });
  const opportunities = loaderOpportunities?.opportunities ?? [];
  const isManager = useIsManager();

  const groupByOptions: GroupByOption[] = isManager
    ? ["nameOfSc", "owner", "stage", "opp"]
    : ["owner", "stage", "opp"];

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
    const closedValue = [...won, ...lost].reduce((s, o) => s + o.amount, 0);
    const wonValue = won.reduce((s, o) => s + o.amount, 0);
    const winRateBase = winRateMode === "count" ? closed : closedValue;
    const winRateNumerator = winRateMode === "count" ? won.length : wonValue;
    const winRate = winRateBase > 0 ? (winRateNumerator / winRateBase) * 100 : 0;
    return {
      total,
      wonCount: won.length,
      closedCount: closed,
      wonValue,
      pipeline,
      winRate,
    };
  }, [filtered, winRateMode]);

  const { rows: chartData, series } = useMemo(
    () => buildChartData(filtered, groupBy),
    [filtered, groupBy],
  );

  if (isError) {
    return (
      <div className="bg-zd-bg font-sans text-zd-dark selection:bg-zd-green/20 min-h-screen">
        <AppNav />
        <main className="p-6">
          <div className="bg-white border border-red-200 rounded p-8 text-center text-sm text-red-600">
            Failed to load opportunities: {opportunitiesError.message}
            <div className="mt-1 text-red-500/70">
              Try refreshing. If this persists, the Snowflake connection may
              need to be restarted.
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
        <DashboardFilterBar
          filters={filters}
          onChange={setFilters}
          opportunities={opportunities}
          isManager={isManager}
        />

        <div className="grid grid-cols-4 gap-4">
          <KpiCard label="Total Opportunities" value={String(kpis.total)} />
          <KpiCard
            label={`Won (${kpis.wonCount}/${kpis.closedCount})`}
            value={fmtCompact(kpis.wonValue)}
            accent
            delay={60}
          />
          <KpiCard
            label="Pipeline Value"
            value={fmtCompact(kpis.pipeline)}
            delay={120}
          />
          <div
            className="bg-white p-4 border border-zd-border rounded animate-row"
            style={{ animationDelay: "180ms" }}
          >
            <div className="flex items-center gap-0 mb-1">
              <span className="text-[11px] font-semibold text-zd-teal/60 uppercase tracking-wider">
                Win Rate
              </span>
              <select
                aria-label="Win rate calculation"
                value={winRateMode}
                onChange={(e) => setWinRateMode(e.target.value as WinRateMode)}
                className="bg-transparent text-[11px] font-semibold text-zd-teal/60 border-0 p-0 focus:outline-none focus:ring-0 cursor-pointer"
              >
                <option value="count">(#)</option>
                <option value="value">($)</option>
              </select>
            </div>
            <p className="text-2xl font-bold font-mono text-zd-dark">
              {kpis.winRate.toFixed(1)}%
            </p>
          </div>
        </div>

        <div className="bg-white border border-zd-border rounded p-4">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold text-zd-dark">
              ARR by Close Month
            </h2>
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-1.5">
                <span className="text-[10px] font-bold text-zd-teal/50 uppercase tracking-wider">
                  Group by
                </span>
                <Popover open={groupByOpen} onOpenChange={setGroupByOpen}>
                  <PopoverTrigger asChild>
                    <button
                      type="button"
                      className="inline-flex items-center gap-1 text-xs font-semibold text-zd-teal hover:text-zd-dark transition-colors"
                    >
                      {GROUP_BY_LABELS[groupBy]}
                      <ChevronDown className="size-3" />
                    </button>
                  </PopoverTrigger>
                  <PopoverContent align="end" className="w-40 p-1">
                    {groupByOptions.map((opt) => {
                      const active = opt === groupBy;
                      return (
                        <button
                          key={opt}
                          type="button"
                          onClick={() => {
                            setGroupBy(opt);
                            setGroupByOpen(false);
                          }}
                          className={`w-full flex items-center justify-between gap-2 px-2 py-1.5 text-sm rounded hover:bg-zd-bg ${
                            active
                              ? "text-zd-dark font-semibold"
                              : "text-zd-teal/80"
                          }`}
                        >
                          <span>{GROUP_BY_LABELS[opt]}</span>
                          {active && (
                            <Check className="size-3.5 text-zd-green" />
                          )}
                        </button>
                      );
                    })}
                  </PopoverContent>
                </Popover>
              </div>
            </div>
          </div>
          <div className={groupBy === "opp" ? "h-72 w-full" : "h-88 w-full"}>
            {chartData.length === 0 ? (
              <div className="h-full flex items-center justify-center text-sm text-zd-teal/50">
                No data for current filters.
              </div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={chartData}
                  margin={{ top: 8, right: 16, left: 8, bottom: 8 }}
                >
                  <CartesianGrid
                    strokeDasharray="3 3"
                    stroke="#e5e7eb"
                    vertical={false}
                  />
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
                  {groupBy !== "opp" && (
                    <Legend
                      verticalAlign="bottom"
                      wrapperStyle={{
                        fontSize: 11,
                        color: "#5b7a89",
                        paddingTop: 12,
                      }}
                    />
                  )}
                  {series.map((s, idx) => (
                    <Bar
                      key={s.key}
                      dataKey={s.key}
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

        {isManager && <SeTotalsTable opps={filtered} />}

        <SortableOppTable opps={filtered} isManager={isManager} />
      </main>
    </div>
  );
}

type SeTotalsRow = { se: string; arr: number; oppCount: number };
type SeTotalsSortKey = "se" | "arr" | "oppCount";

const SE_TOTALS_COLUMNS: {
  key: SeTotalsSortKey;
  label: string;
  align?: "right";
}[] = [
  { key: "se", label: "SE" },
  { key: "arr", label: "ARR", align: "right" },
  { key: "oppCount", label: "Opp", align: "right" },
];

function buildSeTotals(opps: Opportunity[]): SeTotalsRow[] {
  const bySe = new Map<string, SeTotalsRow>();
  opps.forEach((o) => {
    const se = o.nameOfSc ?? "Unassigned";
    const row = bySe.get(se) ?? { se, arr: 0, oppCount: 0 };
    row.arr += o.amount;
    row.oppCount += 1;
    bySe.set(se, row);
  });
  return Array.from(bySe.values());
}

function SeTotalsTable({ opps }: { opps: Opportunity[] }) {
  const [sortKey, setSortKey] = useState<SeTotalsSortKey>("arr");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  const rows = useMemo(() => {
    const list = buildSeTotals(opps);
    list.sort((a, b) => {
      const av = a[sortKey];
      const bv = b[sortKey];
      const cmp =
        typeof av === "number" && typeof bv === "number"
          ? av - bv
          : String(av).localeCompare(String(bv));
      return sortDir === "asc" ? cmp : -cmp;
    });
    return list;
  }, [opps, sortKey, sortDir]);

  const toggleSort = (key: SeTotalsSortKey) => {
    if (key === sortKey) {
      setSortDir(sortDir === "asc" ? "desc" : "asc");
    } else {
      setSortKey(key);
      setSortDir(key === "se" ? "asc" : "desc");
    }
  };

  return (
    <div className="bg-white border border-zd-border rounded overflow-hidden">
      <div className="px-4 py-3 border-b border-zd-border flex items-center justify-between">
        <h2 className="text-sm font-semibold text-zd-dark">SE Totals</h2>
        <span className="text-[11px] text-zd-teal/60 font-mono">
          {rows.length} {rows.length === 1 ? "SE" : "SEs"}
        </span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-zd-bg/50 border-b border-zd-border">
            <tr className="text-left text-[10px] font-bold text-zd-teal/60 uppercase tracking-wider">
              {SE_TOTALS_COLUMNS.map((col) => {
                const active = sortKey === col.key;
                const Icon = active
                  ? sortDir === "asc"
                    ? ArrowUp
                    : ArrowDown
                  : ArrowUpDown;
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
                      <Icon
                        className={`size-3 ${active ? "opacity-100" : "opacity-40"}`}
                      />
                    </button>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody className="divide-y divide-zd-border">
            {rows.length === 0 ? (
              <tr>
                <td
                  colSpan={3}
                  className="px-4 py-8 text-center text-zd-teal/50"
                >
                  No opportunities match the current filters.
                </td>
              </tr>
            ) : (
              rows.map((row) => (
                <tr key={row.se}>
                  <td className="px-4 py-2 font-medium text-zd-dark">
                    {row.se}
                  </td>
                  <td className="px-4 py-2 text-right font-mono text-zd-dark">
                    {fmtCompact(row.arr)}
                  </td>
                  <td className="px-4 py-2 text-right font-mono text-zd-teal/90">
                    {row.oppCount}
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

type SortKey =
  | "name"
  | "account"
  | "nameOfSc"
  | "owner"
  | "amount"
  | "stage"
  | "closeDate";
type SortDir = "asc" | "desc";

const BASE_COLUMNS: { key: SortKey; label: string; align?: "right" }[] = [
  { key: "name", label: "Opp" },
  { key: "account", label: "Account" },
  { key: "owner", label: "AE" },
  { key: "amount", label: "ARR", align: "right" },
  { key: "stage", label: "Stage" },
  { key: "closeDate", label: "Close Date" },
];

const SE_COLUMN: { key: SortKey; label: string; align?: "right" } = {
  key: "nameOfSc",
  label: "SE",
};

function SortableOppTable({
  opps,
  isManager,
}: {
  opps: Opportunity[];
  isManager: boolean;
}) {
  const [sortKey, setSortKey] = useState<SortKey>("closeDate");
  const [sortDir, setSortDir] = useState<SortDir>("asc");

  const columns = useMemo(() => {
    if (!isManager) return BASE_COLUMNS;
    const ownerIdx = BASE_COLUMNS.findIndex((c) => c.key === "owner");
    return [
      ...BASE_COLUMNS.slice(0, ownerIdx),
      SE_COLUMN,
      ...BASE_COLUMNS.slice(ownerIdx),
    ];
  }, [isManager]);

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
              {columns.map((col) => {
                const active = sortKey === col.key;
                const Icon = active
                  ? sortDir === "asc"
                    ? ArrowUp
                    : ArrowDown
                  : ArrowUpDown;
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
                      <Icon
                        className={`size-3 ${active ? "opacity-100" : "opacity-40"}`}
                      />
                    </button>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody className="divide-y divide-zd-border">
            {sorted.length === 0 ? (
              <tr>
                <td
                  colSpan={columns.length}
                  className="px-4 py-8 text-center text-zd-teal/50"
                >
                  No opportunities match the current filters.
                </td>
              </tr>
            ) : (
              sorted.map((o) => (
                <tr
                  key={o.id}
                  onClick={() =>
                    window.open(sfRecordUrl(o.id), "_blank", "noopener")
                  }
                  className="cursor-pointer hover:bg-zd-bg/60 transition-colors"
                >
                  <td className="px-4 py-2 font-medium text-zd-dark">
                    {o.name}
                  </td>
                  <td className="px-4 py-2 text-zd-teal/90">{o.account}</td>
                  {isManager && (
                    <td className="px-4 py-2 text-zd-teal/90">
                      {o.nameOfSc ?? "—"}
                    </td>
                  )}
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
