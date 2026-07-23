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
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  Legend,
} from "recharts";

import { AppNav } from "@/components/opportunities/AppNav";
import { KpiCard } from "@/components/opportunities/KpiCard";
import { fetchActivities, type Activity } from "@/lib/api/activities";
import { useIsManager } from "@/hooks/use-is-manager";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  ActivitiesFilterBar,
  DEFAULT_ACTIVITIES_FILTERS,
  type ActivitiesFilters,
} from "@/components/opportunities/ActivitiesFilterBar";
import { ActivitiesTable } from "@/components/opportunities/ActivitiesTable";

export const Route = createFileRoute("/activities")({
  head: () => ({
    meta: [
      { title: "Activities — KHARA" },
      {
        name: "description",
        content: "Logged SE activity: hours by month/quarter and by type.",
      },
    ],
  }),
  component: ActivitiesPage,
});

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

function applyFilters(
  activities: Activity[],
  filters: ActivitiesFilters,
): Activity[] {
  const search = filters.search.trim().toLowerCase();
  return activities.filter((a) => {
    if (
      filters.months.length &&
      (!a.activityYearMonth || !filters.months.includes(a.activityYearMonth))
    ) {
      return false;
    }
    if (
      filters.subTypes.length &&
      (!a.subType || !filters.subTypes.includes(a.subType))
    )
      return false;
    if (
      filters.accounts.length &&
      (!a.accountName || !filters.accounts.includes(a.accountName))
    ) {
      return false;
    }
    if (
      filters.whatidTypes.length &&
      (!a.whatidType || !filters.whatidTypes.includes(a.whatidType))
    ) {
      return false;
    }
    if (
      filters.ses.length &&
      (!a.createdByName || !filters.ses.includes(a.createdByName))
    ) {
      return false;
    }
    if (search) {
      const haystack = [a.accountName, a.activityMatchOppName, a.subject]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      if (!haystack.includes(search)) return false;
    }
    return true;
  });
}

const MONTH_LABEL = (yyyymm: string) => {
  const y = yyyymm.slice(0, 4);
  const m = yyyymm.slice(4, 6);
  const d = new Date(Number(y), Number(m) - 1, 1);
  return d.toLocaleString("en-US", { month: "short", year: "2-digit" });
};

// Format a "YYYYQQ" key (e.g. "2026Q1") as "YYYY QQ" (e.g. "2026 Q1").
const QUARTER_LABEL = (yyyyq: string) => yyyyq.replace(/(\d{4})(Q\d)/, "$1 $2");

type HoursGroupBy = "month" | "quarter";

function buildHoursChartData(activities: Activity[], groupBy: HoursGroupBy) {
  const totals = new Map<string, number>();
  activities.forEach((a) => {
    const key =
      groupBy === "month" ? a.activityYearMonth : a.activityYearQuarter;
    if (!key) return;
    totals.set(key, (totals.get(key) ?? 0) + a.durationHours);
  });
  return Array.from(totals.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, hours]) => ({
      key,
      label: groupBy === "month" ? MONTH_LABEL(key) : QUARTER_LABEL(key),
      hours: Math.round(hours * 10) / 10,
    }));
}

function buildTypeChartData(activities: Activity[]) {
  const totals = new Map<string, number>();
  activities.forEach((a) => {
    const key = a.type ?? "Unknown";
    totals.set(key, (totals.get(key) ?? 0) + a.durationHours);
  });
  return Array.from(totals.entries())
    .map(([type, hours]) => ({ type, hours: Math.round(hours * 10) / 10 }))
    .sort((a, b) => b.hours - a.hours);
}

function buildSubTypeChartData(activities: Activity[]) {
  const totals = new Map<string, number>();
  activities.forEach((a) => {
    const key = a.subType ?? "Unknown";
    totals.set(key, (totals.get(key) ?? 0) + a.durationHours);
  });
  return Array.from(totals.entries())
    .map(([subType, hours]) => ({
      subType,
      hours: Math.round(hours * 10) / 10,
    }))
    .sort((a, b) => b.hours - a.hours);
}

type SeActivityTotalsRow = { se: string; hours: number; count: number };
type SeActivityTotalsSortKey = "se" | "hours" | "count";

const SE_ACTIVITY_TOTALS_COLUMNS: {
  key: SeActivityTotalsSortKey;
  label: string;
  align?: "right";
}[] = [
  { key: "se", label: "SE" },
  { key: "hours", label: "Hours", align: "right" },
  { key: "count", label: "Activities", align: "right" },
];

function buildSeActivityTotals(activities: Activity[]): SeActivityTotalsRow[] {
  const bySe = new Map<string, SeActivityTotalsRow>();
  activities.forEach((a) => {
    const se = a.createdByName ?? "Unassigned";
    const row = bySe.get(se) ?? { se, hours: 0, count: 0 };
    row.hours += a.durationHours;
    row.count += 1;
    bySe.set(se, row);
  });
  return Array.from(bySe.values());
}

function SeActivityTotalsTable({ activities }: { activities: Activity[] }) {
  const [sortKey, setSortKey] = useState<SeActivityTotalsSortKey>("hours");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  const rows = useMemo(() => {
    const list = buildSeActivityTotals(activities);
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
  }, [activities, sortKey, sortDir]);

  const toggleSort = (key: SeActivityTotalsSortKey) => {
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
        <h2 className="text-sm font-semibold text-zd-dark">
          Activity Totals by SE
        </h2>
        <span className="text-[11px] text-zd-teal/60 font-mono">
          {rows.length} {rows.length === 1 ? "SE" : "SEs"}
        </span>
      </div>
      <div className="h-72 overflow-auto">
        <table className="w-full text-sm">
          <thead className="bg-zd-bg/50 border-b border-zd-border sticky top-0">
            <tr className="text-left text-[10px] font-bold text-zd-teal/60 uppercase tracking-wider">
              {SE_ACTIVITY_TOTALS_COLUMNS.map((col) => {
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
                      }`}
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
                  colSpan={SE_ACTIVITY_TOTALS_COLUMNS.length}
                  className="px-4 py-8 text-center text-zd-teal/50"
                >
                  No activities match the current filters.
                </td>
              </tr>
            ) : (
              rows.map((row) => (
                <tr key={row.se}>
                  <td className="px-4 py-2 font-medium text-zd-dark">
                    {row.se}
                  </td>
                  <td className="px-4 py-2 text-right font-mono text-zd-dark">
                    {row.hours.toFixed(1)}
                  </td>
                  <td className="px-4 py-2 text-right font-mono text-zd-teal/90">
                    {row.count}
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

function ActivitiesPage() {
  const [filters, setFilters] = useState<ActivitiesFilters>(
    DEFAULT_ACTIVITIES_FILTERS,
  );
  const [hoursGroupBy, setHoursGroupBy] = useState<HoursGroupBy>("month");
  const [groupByOpen, setGroupByOpen] = useState(false);
  const isManager = useIsManager();

  const { data, isError, error } = useQuery({
    queryKey: ["activities"],
    queryFn: fetchActivities,
    retry: false,
  });
  const activities = data?.activities ?? [];

  const filtered = useMemo(
    () => applyFilters(activities, filters),
    [activities, filters],
  );

  const kpis = useMemo(() => {
    const totalHours = filtered.reduce((s, a) => s + a.durationHours, 0);
    const count = filtered.length;
    const avgHours = count > 0 ? totalHours / count : 0;
    return { totalHours, count, avgHours };
  }, [filtered]);

  const hoursChartData = useMemo(
    () => buildHoursChartData(filtered, hoursGroupBy),
    [filtered, hoursGroupBy],
  );

  const typeChartData = useMemo(() => buildTypeChartData(filtered), [filtered]);

  const subTypeChartData = useMemo(
    () => buildSubTypeChartData(filtered),
    [filtered],
  );

  if (isError) {
    return (
      <div className="bg-zd-bg font-sans text-zd-dark selection:bg-zd-green/20 min-h-screen">
        <AppNav />
        <main className="p-6">
          <div className="bg-white border border-red-200 rounded p-8 text-center text-sm text-red-600">
            Failed to load activities: {error.message}
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
        <ActivitiesFilterBar
          filters={filters}
          onChange={setFilters}
          activities={activities}
          isManager={isManager}
        />

        <div className="grid grid-cols-3 gap-4">
          <KpiCard label="Total Activities" value={String(kpis.count)} />
          <KpiCard
            label="Total Hours"
            value={kpis.totalHours.toFixed(1)}
            accent
            delay={60}
          />
          <KpiCard
            label="Avg Hours / Activity"
            value={kpis.avgHours.toFixed(1)}
            delay={120}
          />
        </div>

        <div
          className={`grid gap-4 ${isManager ? "grid-cols-3" : "grid-cols-2"}`}
        >
          <div className="bg-white border border-zd-border rounded p-4">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-semibold text-zd-dark">
                Hours Logged
              </h2>
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
                      {hoursGroupBy === "month" ? "Month" : "Quarter"}
                      <ChevronDown className="size-3" />
                    </button>
                  </PopoverTrigger>
                  <PopoverContent align="end" className="w-32 p-1">
                    {(["month", "quarter"] as const).map((opt) => {
                      const active = opt === hoursGroupBy;
                      return (
                        <button
                          key={opt}
                          type="button"
                          onClick={() => {
                            setHoursGroupBy(opt);
                            setGroupByOpen(false);
                          }}
                          className={`w-full flex items-center justify-between gap-2 px-2 py-1.5 text-sm rounded hover:bg-zd-bg ${
                            active
                              ? "text-zd-dark font-semibold"
                              : "text-zd-teal/80"
                          }`}
                        >
                          <span>{opt === "month" ? "Month" : "Quarter"}</span>
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
            <div className="h-72 w-full">
              {hoursChartData.length === 0 ? (
                <div className="h-full flex items-center justify-center text-sm text-zd-teal/50">
                  No data for current filters.
                </div>
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={hoursChartData}
                    margin={{ top: 8, right: 16, left: 8, bottom: 8 }}
                  >
                    <CartesianGrid
                      strokeDasharray="3 3"
                      stroke="#e5e7eb"
                      vertical={false}
                    />
                    <XAxis
                      dataKey="label"
                      tick={{ fontSize: 11, fill: "#5b7a89" }}
                      axisLine={{ stroke: "#e5e7eb" }}
                      tickLine={false}
                    />
                    <YAxis
                      tick={{ fontSize: 11, fill: "#5b7a89" }}
                      axisLine={{ stroke: "#e5e7eb" }}
                      tickLine={false}
                    />
                    <Tooltip
                      cursor={{ fill: "rgba(43,182,115,0.08)" }}
                      formatter={(value: number) => [
                        `${value.toFixed(1)} hrs`,
                        "Hours",
                      ]}
                    />
                    <Bar
                      dataKey="hours"
                      fill={STACK_COLORS[0]}
                      isAnimationActive={false}
                    />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </div>
          </div>

          <div className="bg-white border border-zd-border rounded p-4">
            <h2 className="text-sm font-semibold text-zd-dark mb-3">
              Activity by Type
            </h2>
            <div className="h-72 w-full">
              {typeChartData.length === 0 ? (
                <div className="h-full flex items-center justify-center text-sm text-zd-teal/50">
                  No data for current filters.
                </div>
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={typeChartData}
                      dataKey="hours"
                      nameKey="type"
                      cx="50%"
                      cy="50%"
                      outerRadius={90}
                      isAnimationActive={false}
                    >
                      {typeChartData.map((entry, idx) => (
                        <Cell
                          key={entry.type}
                          fill={STACK_COLORS[idx % STACK_COLORS.length]}
                        />
                      ))}
                    </Pie>
                    <Tooltip
                      formatter={(value: number) => [
                        `${value.toFixed(1)} hrs`,
                        "Hours",
                      ]}
                    />
                    <Legend
                      verticalAlign="bottom"
                      wrapperStyle={{
                        fontSize: 11,
                        color: "#5b7a89",
                        paddingTop: 12,
                      }}
                    />
                  </PieChart>
                </ResponsiveContainer>
              )}
            </div>
          </div>

          {isManager && <SeActivityTotalsTable activities={filtered} />}
        </div>

        <div className="bg-white border border-zd-border rounded p-4">
          <h2 className="text-sm font-semibold text-zd-dark mb-3">
            Activity by Sub-Type
          </h2>
          <div className="h-96 w-full">
            {subTypeChartData.length === 0 ? (
              <div className="h-full flex items-center justify-center text-sm text-zd-teal/50">
                No data for current filters.
              </div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={subTypeChartData}
                  margin={{ top: 8, right: 16, left: 8, bottom: 72 }}
                >
                  <CartesianGrid
                    strokeDasharray="3 3"
                    stroke="#e5e7eb"
                    vertical={false}
                  />
                  <XAxis
                    dataKey="subType"
                    tick={{ fontSize: 11, fill: "#5b7a89" }}
                    axisLine={{ stroke: "#e5e7eb" }}
                    tickLine={false}
                    angle={-40}
                    textAnchor="end"
                    interval={0}
                    height={80}
                  />
                  <YAxis
                    tick={{ fontSize: 11, fill: "#5b7a89" }}
                    axisLine={{ stroke: "#e5e7eb" }}
                    tickLine={false}
                  />
                  <Tooltip
                    cursor={{ fill: "rgba(43,182,115,0.08)" }}
                    formatter={(value: number) => [
                      `${value.toFixed(1)} hrs`,
                      "Hours",
                    ]}
                  />
                  <Bar
                    dataKey="hours"
                    fill={STACK_COLORS[0]}
                    isAnimationActive={false}
                  />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>

        <ActivitiesTable activities={filtered} isManager={isManager} />
      </main>
    </div>
  );
}
