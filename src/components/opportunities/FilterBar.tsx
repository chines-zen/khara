import { useMemo, useState } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Checkbox } from "@/components/ui/checkbox";
import type { Opportunity, Stage } from "@/lib/opportunities";

export type Filters = {
  search: string;
  stages: string[];
  owner: string; // "" = all
  se: string; // "" = all; manager-only filter
  closeMonths: string[]; // yyyy-mm
  daysSinceMax: string; // "" = no filter; otherwise max days since last update
  arrMin: string; // "" = no filter; otherwise minimum ARR amount
};

export const DEFAULT_FILTERS: Filters = {
  search: "",
  stages: [],
  owner: "",
  se: "",
  closeMonths: [],
  daysSinceMax: "",
  arrMin: "",
};

type Props = {
  filters: Filters;
  onChange: (f: Filters) => void;
  opportunities: Opportunity[];
  isManager: boolean;
};

const MONTH_LABEL = (key: string) => {
  const [y, m] = key.split("-");
  const d = new Date(Number(y), Number(m) - 1, 1);
  return d.toLocaleString("en-US", { month: "short", year: "numeric" });
};

export function FilterBar({ filters, onChange, opportunities, isManager }: Props) {
  const update = <K extends keyof Filters>(key: K, value: Filters[K]) =>
    onChange({ ...filters, [key]: value });

  // Derive available owners from data
  const availableOwners = useMemo(() => {
    const set = new Set<string>();
    opportunities.forEach((o) => {
      if (o.owner) set.add(o.owner);
    });
    return Array.from(set).sort();
  }, [opportunities]);

  // Derive available SEs from data (manager-only filter)
  const availableSEs = useMemo(() => {
    const set = new Set<string>();
    opportunities.forEach((o) => {
      if (o.nameOfSc) set.add(o.nameOfSc);
    });
    return Array.from(set).sort();
  }, [opportunities]);

  // Derive available stages from data
  const availableStages = useMemo(() => {
    const set = new Set<string>();
    opportunities.forEach((o) => {
      if (o.stage) set.add(o.stage);
    });
    return Array.from(set).sort();
  }, [opportunities]);

  const toggleStage = (s: string) => {
    const next = filters.stages.includes(s)
      ? filters.stages.filter((x) => x !== s)
      : [...filters.stages, s];
    update("stages", next);
  };

  const monthOptions = useMemo(() => {
    const set = new Set<string>();
    opportunities.forEach((o) => set.add(o.closeDate.slice(0, 7)));
    return Array.from(set).sort();
  }, [opportunities]);

  const toggleMonth = (m: string) => {
    const next = filters.closeMonths.includes(m)
      ? filters.closeMonths.filter((x) => x !== m)
      : [...filters.closeMonths, m];
    update("closeMonths", next);
  };

  const [monthOpen, setMonthOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);

  const monthLabel =
    filters.closeMonths.length === 0
      ? "All months"
      : filters.closeMonths.length === 1
        ? MONTH_LABEL(filters.closeMonths[0])
        : `${filters.closeMonths.length} months`;

  // Count active filters
  const activeFiltersCount = [
    filters.search,
    filters.owner,
    filters.se,
    ...filters.stages,
    ...filters.closeMonths,
    filters.daysSinceMax,
    filters.arrMin
  ].filter(Boolean).length;

  return (
    <div className="bg-white border border-zd-border rounded overflow-hidden">
      <button
        type="button"
        onClick={() => setCollapsed(!collapsed)}
        className="w-full px-4 py-2 flex items-center justify-between bg-zd-bg/50 hover:bg-zd-bg transition-colors"
      >
        <span className="text-xs font-bold text-zd-teal/70 uppercase tracking-wider">
          Filters ({activeFiltersCount} active)
        </span>
        {collapsed ? <ChevronDown className="size-4 text-zd-teal/60" /> : <ChevronUp className="size-4 text-zd-teal/60" />}
      </button>
      {!collapsed && (
        <div className="p-4 space-y-3">
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex-1 min-w-[220px]">
          <label className="block text-[10px] font-bold text-zd-teal/50 uppercase tracking-wider mb-1">
            Search
          </label>
          <input
            type="text"
            value={filters.search}
            onChange={(e) => update("search", e.target.value)}
            placeholder="Opportunity, account or AE…"
            className="w-full bg-white border border-zd-border rounded px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-zd-green focus:border-zd-green placeholder:text-zd-teal/40"
          />
        </div>

        <div>
          <label className="block text-[10px] font-bold text-zd-teal/50 uppercase tracking-wider mb-1">
            AE
          </label>
          <select
            value={filters.owner}
            onChange={(e) => update("owner", e.target.value)}
            className="bg-white border border-zd-border rounded px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-zd-green focus:border-zd-green"
          >
            <option value="">All AEs</option>
            {availableOwners.map((o) => (
              <option key={o} value={o}>
                {o}
              </option>
            ))}
          </select>
        </div>

        {isManager && (
          <div>
            <label className="block text-[10px] font-bold text-zd-teal/50 uppercase tracking-wider mb-1">
              SE
            </label>
            <select
              value={filters.se}
              onChange={(e) => update("se", e.target.value)}
              className="bg-white border border-zd-border rounded px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-zd-green focus:border-zd-green"
            >
              <option value="">All SEs</option>
              {availableSEs.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </div>
        )}

        <div>
          <label className="block text-[10px] font-bold text-zd-teal/50 uppercase tracking-wider mb-1">
            Close Date
          </label>
          <Popover open={monthOpen} onOpenChange={setMonthOpen}>
            <PopoverTrigger asChild>
              <button
                type="button"
                className="min-w-[160px] bg-white border border-zd-border rounded px-3 py-1.5 text-sm text-left flex items-center justify-between gap-2 focus:outline-none focus:ring-1 focus:ring-zd-green focus:border-zd-green"
              >
                <span className={filters.closeMonths.length ? "text-zd-dark" : "text-zd-teal/60"}>
                  {monthLabel}
                </span>
                <span className="text-zd-teal/40 text-xs">▾</span>
              </button>
            </PopoverTrigger>
            <PopoverContent align="start" className="w-56 p-2 max-h-72 overflow-y-auto">
              <div className="flex items-center justify-between px-1 pb-2 mb-1 border-b border-zd-border">
                <span className="text-[10px] font-bold text-zd-teal/60 uppercase tracking-wider">
                  Months
                </span>
                {filters.closeMonths.length > 0 && (
                  <button
                    type="button"
                    onClick={() => update("closeMonths", [])}
                    className="text-[10px] font-bold text-zd-teal hover:text-zd-dark"
                  >
                    CLEAR
                  </button>
                )}
              </div>
              <div className="space-y-1">
                {monthOptions.map((m) => {
                  const checked = filters.closeMonths.includes(m);
                  return (
                    <label
                      key={m}
                      className="flex items-center gap-2 px-1 py-1 rounded text-sm cursor-pointer hover:bg-zd-bg"
                    >
                      <Checkbox
                        checked={checked}
                        onCheckedChange={() => toggleMonth(m)}
                      />
                      <span>{MONTH_LABEL(m)}</span>
                    </label>
                  );
                })}
              </div>
            </PopoverContent>
          </Popover>
        </div>

        <div>
          <label className="block text-[10px] font-bold text-zd-teal/50 uppercase tracking-wider mb-1">
            Days Since Last Update
          </label>
          <div className="flex items-center gap-1">
            <input
              type="number"
              min={0}
              value={filters.daysSinceMax}
              onChange={(e) => update("daysSinceMax", e.target.value)}
              placeholder="Any"
              className="w-20 bg-white border border-zd-border rounded px-2 py-1.5 text-sm font-mono placeholder:text-zd-teal/40"
            />
            <span className="text-xs text-zd-teal/50">days</span>
          </div>
        </div>

        <div>
          <label className="block text-[10px] font-bold text-zd-teal/50 uppercase tracking-wider mb-1">
            ARR Minimum
          </label>
          <div className="flex items-center gap-1">
            <input
              type="number"
              min={0}
              value={filters.arrMin}
              onChange={(e) => update("arrMin", e.target.value)}
              placeholder="Any"
              className="w-24 bg-white border border-zd-border rounded px-2 py-1.5 text-sm font-mono placeholder:text-zd-teal/40"
            />
            <span className="text-xs text-zd-teal/50">$</span>
          </div>
        </div>

        <button
          type="button"
          onClick={() => onChange(DEFAULT_FILTERS)}
          className="px-3 py-1.5 text-xs font-bold text-zd-teal hover:text-zd-dark transition-colors"
        >
          RESET
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[10px] font-bold text-zd-teal/50 uppercase tracking-wider mr-1">
          Stage
        </span>
        {availableStages.map((s) => {
          const active = filters.stages.includes(s);
          return (
            <button
              key={s}
              type="button"
              onClick={() => toggleStage(s)}
              className={`text-[11px] px-2.5 py-1 rounded-full border transition-colors ${
                active
                  ? "bg-zd-teal text-white border-zd-teal"
                  : "bg-white text-zd-teal/70 border-zd-border hover:border-zd-teal"
              }`}
            >
              {s}
            </button>
          );
        })}
      </div>
      </div>
      )}
    </div>
  );
}
