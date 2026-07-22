import { useMemo, useState } from "react";
import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";
import { type Activity } from "@/lib/api/activities";

const fmtDate = (iso: string | null) => {
  if (!iso) return "—";
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
};

function relatedTo(a: Activity): string {
  if (a.whatidType === "Opp" && a.activityMatchOppName)
    return a.activityMatchOppName;
  if (a.activityMatchAccountName) return a.activityMatchAccountName;
  return a.accountName ?? "—";
}

type SortKey =
  | "activityDate"
  | "subject"
  | "type"
  | "subType"
  | "durationHours"
  | "relatedTo"
  | "createdByName";
type SortDir = "asc" | "desc";

type Column = { key: SortKey; label: string; align?: "right" };

const BASE_COLUMNS: Column[] = [
  { key: "activityDate", label: "Date" },
  { key: "subject", label: "Subject" },
  { key: "durationHours", label: "Hours", align: "right" },
  { key: "type", label: "Type" },
  { key: "subType", label: "Sub-Type" },
  { key: "relatedTo", label: "Related To" },
];

const SE_COLUMN: Column = { key: "createdByName", label: "SE" };

function sortValue(a: Activity, key: SortKey): string | number {
  if (key === "relatedTo") return relatedTo(a);
  if (key === "durationHours") return a.durationHours;
  return a[key] ?? "";
}

export function ActivitiesTable({
  activities,
  isManager,
}: {
  activities: Activity[];
  isManager: boolean;
}) {
  const [sortKey, setSortKey] = useState<SortKey>("activityDate");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  const columns = useMemo(
    () => (isManager ? [...BASE_COLUMNS, SE_COLUMN] : BASE_COLUMNS),
    [isManager],
  );

  const sorted = useMemo(() => {
    const list = [...activities];
    list.sort((a, b) => {
      const av = sortValue(a, sortKey);
      const bv = sortValue(b, sortKey);
      const cmp =
        typeof av === "number" && typeof bv === "number"
          ? av - bv
          : String(av).localeCompare(String(bv));
      return sortDir === "asc" ? cmp : -cmp;
    });
    return list;
  }, [activities, sortKey, sortDir]);

  const toggleSort = (key: SortKey) => {
    if (key === sortKey) {
      setSortDir(sortDir === "asc" ? "desc" : "asc");
    } else {
      setSortKey(key);
      setSortDir(
        key === "durationHours"
          ? "desc"
          : key === "activityDate"
            ? "desc"
            : "asc",
      );
    }
  };

  const totalHours = useMemo(
    () => activities.reduce((s, a) => s + a.durationHours, 0),
    [activities],
  );

  return (
    <div className="bg-white border border-zd-border rounded overflow-hidden">
      <div className="px-4 py-3 border-b border-zd-border flex items-center justify-between">
        <h2 className="text-sm font-semibold text-zd-dark">Activities</h2>
        <span className="text-[11px] text-zd-teal/60 font-mono">
          {activities.length}{" "}
          {activities.length === 1 ? "activity" : "activities"} ·{" "}
          {totalHours.toFixed(1)} hrs
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
            {sorted.length === 0 ? (
              <tr>
                <td
                  colSpan={columns.length}
                  className="px-4 py-8 text-center text-zd-teal/50"
                >
                  No activities match the current filters.
                </td>
              </tr>
            ) : (
              sorted.map((a) => (
                <tr key={a.id} className="hover:bg-zd-bg/60 transition-colors">
                  <td className="px-4 py-2 font-mono text-zd-teal/80 whitespace-nowrap">
                    {fmtDate(a.activityDate)}
                  </td>
                  <td className="px-4 py-2 font-medium text-zd-dark">
                    {a.subject ?? "—"}
                  </td>
                  <td className="px-4 py-2 text-right font-mono text-zd-dark">
                    {a.durationHours.toFixed(1)}
                  </td>
                  <td className="px-4 py-2 text-zd-teal/90">{a.type ?? "—"}</td>
                  <td className="px-4 py-2 text-zd-teal/90">
                    {a.subType ?? "—"}
                  </td>
                  <td className="px-4 py-2 text-zd-teal/90">{relatedTo(a)}</td>
                  {isManager && (
                    <td className="px-4 py-2 text-zd-teal/90">
                      {a.createdByName ?? "—"}
                    </td>
                  )}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
