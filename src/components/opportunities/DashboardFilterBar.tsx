import { useMemo, useState } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Checkbox } from "@/components/ui/checkbox";
import type { Opportunity } from "@/lib/opportunities";

export type DashboardFilters = {
  stages: string[];
  owners: string[];
  ses: string[]; // [] = all; manager-only filter
  closeMonths: string[];
  arrMin: string; // threshold; filter out opps with amount < arrMin
};

export const DEFAULT_DASHBOARD_FILTERS: DashboardFilters = {
  stages: [],
  owners: [],
  ses: [],
  closeMonths: [],
  arrMin: "",
};

type Props = {
  filters: DashboardFilters;
  onChange: (f: DashboardFilters) => void;
  opportunities: Opportunity[];
  isManager: boolean;
};

const MONTH_LABEL = (key: string) => {
  const [y, m] = key.split("-");
  const d = new Date(Number(y), Number(m) - 1, 1);
  return d.toLocaleString("en-US", { month: "short", year: "numeric" });
};

export function DashboardFilterBar({ filters, onChange, opportunities, isManager }: Props) {
  const update = <K extends keyof DashboardFilters>(key: K, value: DashboardFilters[K]) =>
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

  const toggleOwner = (o: string) => {
    const next = filters.owners.includes(o)
      ? filters.owners.filter((x) => x !== o)
      : [...filters.owners, o];
    update("owners", next);
  };

  const toggleSe = (s: string) => {
    const next = filters.ses.includes(s)
      ? filters.ses.filter((x) => x !== s)
      : [...filters.ses, s];
    update("ses", next);
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
  const [ownerOpen, setOwnerOpen] = useState(false);
  const [seOpen, setSeOpen] = useState(false);

  const monthLabel =
    filters.closeMonths.length === 0
      ? "All months"
      : filters.closeMonths.length === 1
        ? MONTH_LABEL(filters.closeMonths[0])
        : `${filters.closeMonths.length} months`;

  const ownerLabel =
    filters.owners.length === 0
      ? "All AEs"
      : filters.owners.length === 1
        ? filters.owners[0]
        : `${filters.owners.length} AEs`;

  const seLabel =
    filters.ses.length === 0
      ? "All SEs"
      : filters.ses.length === 1
        ? filters.ses[0]
        : `${filters.ses.length} SEs`;

  return (
    <div className="bg-white border border-zd-border rounded p-4 space-y-3">
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <label className="block text-[10px] font-bold text-zd-teal/50 uppercase tracking-wider mb-1">
            AE
          </label>
          <Popover open={ownerOpen} onOpenChange={setOwnerOpen}>
            <PopoverTrigger asChild>
              <button
                type="button"
                className="min-w-[160px] bg-white border border-zd-border rounded px-3 py-1.5 text-sm text-left flex items-center justify-between gap-2 focus:outline-none focus:ring-1 focus:ring-zd-green focus:border-zd-green"
              >
                <span className={filters.owners.length ? "text-zd-dark" : "text-zd-teal/60"}>
                  {ownerLabel}
                </span>
                <span className="text-zd-teal/40 text-xs">▾</span>
              </button>
            </PopoverTrigger>
            <PopoverContent align="start" className="w-56 p-2 max-h-72 overflow-y-auto">
              <div className="flex items-center justify-between px-1 pb-2 mb-1 border-b border-zd-border">
                <span className="text-[10px] font-bold text-zd-teal/60 uppercase tracking-wider">
                  AEs
                </span>
                {filters.owners.length > 0 && (
                  <button
                    type="button"
                    onClick={() => update("owners", [])}
                    className="text-[10px] font-bold text-zd-teal hover:text-zd-dark"
                  >
                    CLEAR
                  </button>
                )}
              </div>
              <div className="space-y-1">
                {availableOwners.map((o) => {
                  const checked = filters.owners.includes(o);
                  return (
                    <label
                      key={o}
                      className="flex items-center gap-2 px-1 py-1 rounded text-sm cursor-pointer hover:bg-zd-bg"
                    >
                      <Checkbox checked={checked} onCheckedChange={() => toggleOwner(o)} />
                      <span>{o}</span>
                    </label>
                  );
                })}
              </div>
            </PopoverContent>
          </Popover>
        </div>

        {isManager && (
          <div>
            <label className="block text-[10px] font-bold text-zd-teal/50 uppercase tracking-wider mb-1">
              SE
            </label>
            <Popover open={seOpen} onOpenChange={setSeOpen}>
              <PopoverTrigger asChild>
                <button
                  type="button"
                  className="min-w-[160px] bg-white border border-zd-border rounded px-3 py-1.5 text-sm text-left flex items-center justify-between gap-2 focus:outline-none focus:ring-1 focus:ring-zd-green focus:border-zd-green"
                >
                  <span className={filters.ses.length ? "text-zd-dark" : "text-zd-teal/60"}>
                    {seLabel}
                  </span>
                  <span className="text-zd-teal/40 text-xs">▾</span>
                </button>
              </PopoverTrigger>
              <PopoverContent align="start" className="w-56 p-2 max-h-72 overflow-y-auto">
                <div className="flex items-center justify-between px-1 pb-2 mb-1 border-b border-zd-border">
                  <span className="text-[10px] font-bold text-zd-teal/60 uppercase tracking-wider">
                    SEs
                  </span>
                  {filters.ses.length > 0 && (
                    <button
                      type="button"
                      onClick={() => update("ses", [])}
                      className="text-[10px] font-bold text-zd-teal hover:text-zd-dark"
                    >
                      CLEAR
                    </button>
                  )}
                </div>
                <div className="space-y-1">
                  {availableSEs.map((s) => {
                    const checked = filters.ses.includes(s);
                    return (
                      <label
                        key={s}
                        className="flex items-center gap-2 px-1 py-1 rounded text-sm cursor-pointer hover:bg-zd-bg"
                      >
                        <Checkbox checked={checked} onCheckedChange={() => toggleSe(s)} />
                        <span>{s}</span>
                      </label>
                    );
                  })}
                </div>
              </PopoverContent>
            </Popover>
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
                      <Checkbox checked={checked} onCheckedChange={() => toggleMonth(m)} />
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
            ARR Minimum
          </label>
          <div className="flex items-center gap-1">
            <span className="text-xs text-zd-teal/50">$</span>
            <input
              type="number"
              min={0}
              value={filters.arrMin}
              onChange={(e) => update("arrMin", e.target.value)}
              placeholder="Any"
              className="w-28 bg-white border border-zd-border rounded px-2 py-1.5 text-sm font-mono placeholder:text-zd-teal/40"
            />
          </div>
        </div>

        <button
          type="button"
          onClick={() => onChange(DEFAULT_DASHBOARD_FILTERS)}
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
  );
}
