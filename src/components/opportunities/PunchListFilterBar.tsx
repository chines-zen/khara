import { useMemo, useState } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Checkbox } from "@/components/ui/checkbox";
import type { Opportunity } from "@/lib/opportunities";

export type PunchListFilters = {
  ses: string[]; // [] = all
};

export const DEFAULT_PUNCH_LIST_FILTERS: PunchListFilters = {
  ses: [],
};

type Props = {
  filters: PunchListFilters;
  onChange: (f: PunchListFilters) => void;
  opportunities: Opportunity[];
  isManager: boolean;
};

export function PunchListFilterBar({ filters, onChange, opportunities, isManager }: Props) {
  const [seOpen, setSeOpen] = useState(false);

  const availableSEs = useMemo(() => {
    const set = new Set<string>();
    opportunities.forEach((o) => {
      if (o.nameOfSc) set.add(o.nameOfSc);
    });
    return Array.from(set).sort();
  }, [opportunities]);

  const toggleSe = (s: string) => {
    const next = filters.ses.includes(s)
      ? filters.ses.filter((x) => x !== s)
      : [...filters.ses, s];
    onChange({ ...filters, ses: next });
  };

  const seLabel =
    filters.ses.length === 0
      ? "All SEs"
      : filters.ses.length === 1
        ? filters.ses[0]
        : `${filters.ses.length} SEs`;

  if (!isManager) return null;

  return (
    <div className="bg-white border border-zd-border rounded p-4 flex items-end gap-3">
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
                  onClick={() => onChange({ ...filters, ses: [] })}
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
    </div>
  );
}
