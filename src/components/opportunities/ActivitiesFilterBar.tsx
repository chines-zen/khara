import { useMemo, useState } from "react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Checkbox } from "@/components/ui/checkbox";
import { type Activity } from "@/lib/api/activities";

export type ActivitiesFilters = {
  search: string;
  months: string[]; // activityYearMonth, e.g. "202607"
  subTypes: string[]; // selecting a Type checks all its Sub-Types
  accounts: string[];
  whatidTypes: string[];
  ses: string[]; // createdByName; manager-only filter
};

export const DEFAULT_ACTIVITIES_FILTERS: ActivitiesFilters = {
  search: "",
  months: [],
  subTypes: [],
  accounts: [],
  whatidTypes: [],
  ses: [],
};

type Props = {
  filters: ActivitiesFilters;
  onChange: (f: ActivitiesFilters) => void;
  activities: Activity[];
  isManager: boolean;
};

const MONTH_LABEL = (yyyymm: string) => {
  const y = yyyymm.slice(0, 4);
  const m = yyyymm.slice(4, 6);
  const d = new Date(Number(y), Number(m) - 1, 1);
  return d.toLocaleString("en-US", { month: "short", year: "numeric" });
};

// The Type filter groups every sub-type into exactly one of two buckets:
// "Meeting" (the fixed list below) and "Other" (everything else). Matching is
// case/punctuation-insensitive so minor formatting differences in the source
// data still resolve to the right bucket.
const MEETING_SUB_TYPES = [
  "Account check-in",
  "Business review",
  "Discovery",
  "Exec connect",
  "Innovation day",
  "Negotiations",
  "Proposal review",
  "Rapid business assessment",
  "Renewal strategy",
  "Solution demo presentation",
  "Technical evaluation",
];

const normalizeSubType = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

const MEETING_SUB_TYPE_SET = new Set(MEETING_SUB_TYPES.map(normalizeSubType));

const isMeetingSubType = (subType: string) =>
  MEETING_SUB_TYPE_SET.has(normalizeSubType(subType));

function useMultiSelect<T extends keyof ActivitiesFilters>(
  filters: ActivitiesFilters,
  onChange: (f: ActivitiesFilters) => void,
  key: T,
) {
  const values = filters[key] as unknown as string[];
  const toggle = (value: string) => {
    const next = values.includes(value)
      ? values.filter((v) => v !== value)
      : [...values, value];
    onChange({ ...filters, [key]: next });
  };
  const clear = () => onChange({ ...filters, [key]: [] });
  return { values, toggle, clear };
}

export function ActivitiesFilterBar({
  filters,
  onChange,
  activities,
  isManager,
}: Props) {
  const update = <K extends keyof ActivitiesFilters>(
    key: K,
    value: ActivitiesFilters[K],
  ) => onChange({ ...filters, [key]: value });

  const availableMonths = useMemo(() => {
    const set = new Set<string>();
    activities.forEach((a) => {
      if (a.activityYearMonth) set.add(a.activityYearMonth);
    });
    return Array.from(set).sort();
  }, [activities]);

  // Sub-Types bucketed into exactly two groups: "Meeting" (the fixed list) and
  // "Other" (everything else). Every sub-type present in the data lands in one
  // and only one group. Groups with no sub-types present are omitted.
  const typeGroups = useMemo(() => {
    const meeting = new Set<string>();
    const other = new Set<string>();
    activities.forEach((a) => {
      if (!a.subType) return;
      (isMeetingSubType(a.subType) ? meeting : other).add(a.subType);
    });
    const groups: { type: string; subTypes: string[] }[] = [];
    if (meeting.size)
      groups.push({ type: "Meeting", subTypes: Array.from(meeting).sort() });
    if (other.size)
      groups.push({ type: "Other", subTypes: Array.from(other).sort() });
    return groups;
  }, [activities]);

  const availableAccounts = useMemo(() => {
    const set = new Set<string>();
    activities.forEach((a) => {
      if (a.accountName) set.add(a.accountName);
    });
    return Array.from(set).sort();
  }, [activities]);

  const availableWhatidTypes = useMemo(() => {
    const set = new Set<string>();
    activities.forEach((a) => {
      if (a.whatidType) set.add(a.whatidType);
    });
    return Array.from(set).sort();
  }, [activities]);

  const availableSes = useMemo(() => {
    const set = new Set<string>();
    activities.forEach((a) => {
      if (a.createdByName) set.add(a.createdByName);
    });
    return Array.from(set).sort();
  }, [activities]);

  const monthFilter = useMultiSelect(filters, onChange, "months");
  const subTypeFilter = useMultiSelect(filters, onChange, "subTypes");
  const accountFilter = useMultiSelect(filters, onChange, "accounts");
  const whatidTypeFilter = useMultiSelect(filters, onChange, "whatidTypes");
  const seFilter = useMultiSelect(filters, onChange, "ses");

  const toggleTypeGroup = (subTypes: string[]) => {
    const allSelected = subTypes.every((st) => filters.subTypes.includes(st));
    const next = allSelected
      ? filters.subTypes.filter((st) => !subTypes.includes(st))
      : Array.from(new Set([...filters.subTypes, ...subTypes]));
    update("subTypes", next);
  };

  const [monthOpen, setMonthOpen] = useState(false);
  const [subTypeOpen, setSubTypeOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const [whatidTypeOpen, setWhatidTypeOpen] = useState(false);
  const [seOpen, setSeOpen] = useState(false);

  const monthLabel =
    filters.months.length === 0
      ? "All months"
      : filters.months.length === 1
        ? MONTH_LABEL(filters.months[0])
        : `${filters.months.length} months`;

  const subTypeLabel =
    filters.subTypes.length === 0
      ? "All types"
      : filters.subTypes.length === 1
        ? filters.subTypes[0]
        : `${filters.subTypes.length} selected`;

  const accountLabel =
    filters.accounts.length === 0
      ? "All accounts"
      : filters.accounts.length === 1
        ? filters.accounts[0]
        : `${filters.accounts.length} accounts`;

  const whatidTypeLabel =
    filters.whatidTypes.length === 0
      ? "All"
      : filters.whatidTypes.length === 1
        ? filters.whatidTypes[0]
        : `${filters.whatidTypes.length} types`;

  const seLabel =
    filters.ses.length === 0
      ? "All SEs"
      : filters.ses.length === 1
        ? filters.ses[0]
        : `${filters.ses.length} SEs`;

  return (
    <div className="bg-white border border-zd-border rounded p-4 space-y-3">
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex-1 min-w-[220px]">
          <label className="block text-[10px] font-bold text-zd-teal/50 uppercase tracking-wider mb-1">
            Search
          </label>
          <input
            type="text"
            value={filters.search}
            onChange={(e) => update("search", e.target.value)}
            placeholder="Account, opportunity or subject…"
            className="w-full bg-white border border-zd-border rounded px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-zd-green focus:border-zd-green placeholder:text-zd-teal/40"
          />
        </div>

        <div>
          <label className="block text-[10px] font-bold text-zd-teal/50 uppercase tracking-wider mb-1">
            Month
          </label>
          <Popover open={monthOpen} onOpenChange={setMonthOpen}>
            <PopoverTrigger asChild>
              <button
                type="button"
                className="min-w-[160px] bg-white border border-zd-border rounded px-3 py-1.5 text-sm text-left flex items-center justify-between gap-2 focus:outline-none focus:ring-1 focus:ring-zd-green focus:border-zd-green"
              >
                <span
                  className={
                    filters.months.length ? "text-zd-dark" : "text-zd-teal/60"
                  }
                >
                  {monthLabel}
                </span>
                <span className="text-zd-teal/40 text-xs">▾</span>
              </button>
            </PopoverTrigger>
            <PopoverContent
              align="start"
              className="w-56 p-2 max-h-72 overflow-y-auto"
            >
              <div className="flex items-center justify-between px-1 pb-2 mb-1 border-b border-zd-border">
                <span className="text-[10px] font-bold text-zd-teal/60 uppercase tracking-wider">
                  Months
                </span>
                {filters.months.length > 0 && (
                  <button
                    type="button"
                    onClick={monthFilter.clear}
                    className="text-[10px] font-bold text-zd-teal hover:text-zd-dark"
                  >
                    CLEAR
                  </button>
                )}
              </div>
              <div className="space-y-1">
                {availableMonths.map((m) => {
                  const checked = filters.months.includes(m);
                  return (
                    <label
                      key={m}
                      className="flex items-center gap-2 px-1 py-1 rounded text-sm cursor-pointer hover:bg-zd-bg"
                    >
                      <Checkbox
                        checked={checked}
                        onCheckedChange={() => monthFilter.toggle(m)}
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
            Type
          </label>
          <Popover open={subTypeOpen} onOpenChange={setSubTypeOpen}>
            <PopoverTrigger asChild>
              <button
                type="button"
                className="min-w-[160px] bg-white border border-zd-border rounded px-3 py-1.5 text-sm text-left flex items-center justify-between gap-2 focus:outline-none focus:ring-1 focus:ring-zd-green focus:border-zd-green"
              >
                <span
                  className={
                    filters.subTypes.length ? "text-zd-dark" : "text-zd-teal/60"
                  }
                >
                  {subTypeLabel}
                </span>
                <span className="text-zd-teal/40 text-xs">▾</span>
              </button>
            </PopoverTrigger>
            <PopoverContent
              align="start"
              className="w-64 p-2 max-h-96 overflow-y-auto"
            >
              <div className="flex items-center justify-between px-1 pb-2 mb-1 border-b border-zd-border">
                <span className="text-[10px] font-bold text-zd-teal/60 uppercase tracking-wider">
                  Type
                </span>
                {filters.subTypes.length > 0 && (
                  <button
                    type="button"
                    onClick={subTypeFilter.clear}
                    className="text-[10px] font-bold text-zd-teal hover:text-zd-dark"
                  >
                    CLEAR
                  </button>
                )}
              </div>
              <div className="space-y-2">
                {typeGroups.map(({ type, subTypes }) => (
                  <div key={type} className="space-y-1">
                    <label className="flex items-center gap-2 px-1 py-1 rounded text-sm cursor-pointer hover:bg-zd-bg font-semibold">
                      <Checkbox
                        checked={subTypes.every((st) =>
                          filters.subTypes.includes(st),
                        )}
                        onCheckedChange={() => toggleTypeGroup(subTypes)}
                      />
                      <span>{type}</span>
                    </label>
                    <div className="ml-4 space-y-1">
                      {subTypes.map((st) => {
                        const checked = filters.subTypes.includes(st);
                        return (
                          <label
                            key={st}
                            className="flex items-center gap-2 px-1 py-1 rounded text-sm cursor-pointer hover:bg-zd-bg"
                          >
                            <Checkbox
                              checked={checked}
                              onCheckedChange={() => subTypeFilter.toggle(st)}
                            />
                            <span>{st}</span>
                          </label>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            </PopoverContent>
          </Popover>
        </div>

        <div>
          <label className="block text-[10px] font-bold text-zd-teal/50 uppercase tracking-wider mb-1">
            Account
          </label>
          <Popover open={accountOpen} onOpenChange={setAccountOpen}>
            <PopoverTrigger asChild>
              <button
                type="button"
                className="min-w-[160px] bg-white border border-zd-border rounded px-3 py-1.5 text-sm text-left flex items-center justify-between gap-2 focus:outline-none focus:ring-1 focus:ring-zd-green focus:border-zd-green"
              >
                <span
                  className={
                    filters.accounts.length ? "text-zd-dark" : "text-zd-teal/60"
                  }
                >
                  {accountLabel}
                </span>
                <span className="text-zd-teal/40 text-xs">▾</span>
              </button>
            </PopoverTrigger>
            <PopoverContent
              align="start"
              className="w-56 p-2 max-h-72 overflow-y-auto"
            >
              <div className="flex items-center justify-between px-1 pb-2 mb-1 border-b border-zd-border">
                <span className="text-[10px] font-bold text-zd-teal/60 uppercase tracking-wider">
                  Accounts
                </span>
                {filters.accounts.length > 0 && (
                  <button
                    type="button"
                    onClick={accountFilter.clear}
                    className="text-[10px] font-bold text-zd-teal hover:text-zd-dark"
                  >
                    CLEAR
                  </button>
                )}
              </div>
              <div className="space-y-1">
                {availableAccounts.map((a) => {
                  const checked = filters.accounts.includes(a);
                  return (
                    <label
                      key={a}
                      className="flex items-center gap-2 px-1 py-1 rounded text-sm cursor-pointer hover:bg-zd-bg"
                    >
                      <Checkbox
                        checked={checked}
                        onCheckedChange={() => accountFilter.toggle(a)}
                      />
                      <span>{a}</span>
                    </label>
                  );
                })}
              </div>
            </PopoverContent>
          </Popover>
        </div>

        <div>
          <label className="block text-[10px] font-bold text-zd-teal/50 uppercase tracking-wider mb-1">
            Linked To
          </label>
          <Popover open={whatidTypeOpen} onOpenChange={setWhatidTypeOpen}>
            <PopoverTrigger asChild>
              <button
                type="button"
                className="min-w-[140px] bg-white border border-zd-border rounded px-3 py-1.5 text-sm text-left flex items-center justify-between gap-2 focus:outline-none focus:ring-1 focus:ring-zd-green focus:border-zd-green"
              >
                <span
                  className={
                    filters.whatidTypes.length
                      ? "text-zd-dark"
                      : "text-zd-teal/60"
                  }
                >
                  {whatidTypeLabel}
                </span>
                <span className="text-zd-teal/40 text-xs">▾</span>
              </button>
            </PopoverTrigger>
            <PopoverContent
              align="start"
              className="w-48 p-2 max-h-72 overflow-y-auto"
            >
              <div className="flex items-center justify-between px-1 pb-2 mb-1 border-b border-zd-border">
                <span className="text-[10px] font-bold text-zd-teal/60 uppercase tracking-wider">
                  Linked To
                </span>
                {filters.whatidTypes.length > 0 && (
                  <button
                    type="button"
                    onClick={whatidTypeFilter.clear}
                    className="text-[10px] font-bold text-zd-teal hover:text-zd-dark"
                  >
                    CLEAR
                  </button>
                )}
              </div>
              <div className="space-y-1">
                {availableWhatidTypes.map((w) => {
                  const checked = filters.whatidTypes.includes(w);
                  return (
                    <label
                      key={w}
                      className="flex items-center gap-2 px-1 py-1 rounded text-sm cursor-pointer hover:bg-zd-bg"
                    >
                      <Checkbox
                        checked={checked}
                        onCheckedChange={() => whatidTypeFilter.toggle(w)}
                      />
                      <span>{w}</span>
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
                  <span
                    className={
                      filters.ses.length ? "text-zd-dark" : "text-zd-teal/60"
                    }
                  >
                    {seLabel}
                  </span>
                  <span className="text-zd-teal/40 text-xs">▾</span>
                </button>
              </PopoverTrigger>
              <PopoverContent
                align="start"
                className="w-56 p-2 max-h-72 overflow-y-auto"
              >
                <div className="flex items-center justify-between px-1 pb-2 mb-1 border-b border-zd-border">
                  <span className="text-[10px] font-bold text-zd-teal/60 uppercase tracking-wider">
                    SEs
                  </span>
                  {filters.ses.length > 0 && (
                    <button
                      type="button"
                      onClick={seFilter.clear}
                      className="text-[10px] font-bold text-zd-teal hover:text-zd-dark"
                    >
                      CLEAR
                    </button>
                  )}
                </div>
                <div className="space-y-1">
                  {availableSes.map((s) => {
                    const checked = filters.ses.includes(s);
                    return (
                      <label
                        key={s}
                        className="flex items-center gap-2 px-1 py-1 rounded text-sm cursor-pointer hover:bg-zd-bg"
                      >
                        <Checkbox
                          checked={checked}
                          onCheckedChange={() => seFilter.toggle(s)}
                        />
                        <span>{s}</span>
                      </label>
                    );
                  })}
                </div>
              </PopoverContent>
            </Popover>
          </div>
        )}

        <button
          type="button"
          onClick={() => onChange(DEFAULT_ACTIVITIES_FILTERS)}
          className="px-3 py-1.5 text-xs font-bold text-zd-teal hover:text-zd-dark transition-colors"
        >
          RESET
        </button>
      </div>
    </div>
  );
}
