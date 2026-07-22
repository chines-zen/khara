import { useMemo } from "react";
import type { Opportunity } from "@/lib/opportunities";

export type PunchListFilters = {
  se: string; // "" = all
};

export const DEFAULT_PUNCH_LIST_FILTERS: PunchListFilters = {
  se: "",
};

type Props = {
  filters: PunchListFilters;
  onChange: (f: PunchListFilters) => void;
  opportunities: Opportunity[];
  isManager: boolean;
};

export function PunchListFilterBar({ filters, onChange, opportunities, isManager }: Props) {
  const availableSEs = useMemo(() => {
    const set = new Set<string>();
    opportunities.forEach((o) => {
      if (o.nameOfSc) set.add(o.nameOfSc);
    });
    return Array.from(set).sort();
  }, [opportunities]);

  if (!isManager) return null;

  return (
    <div className="bg-white border border-zd-border rounded p-4 flex items-end gap-3">
      <div>
        <label className="block text-[10px] font-bold text-zd-teal/50 uppercase tracking-wider mb-1">
          SE
        </label>
        <select
          value={filters.se}
          onChange={(e) => onChange({ ...filters, se: e.target.value })}
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
    </div>
  );
}
