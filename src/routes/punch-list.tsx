import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ExternalLink } from "lucide-react";

import { fetchOpportunities } from "@/lib/api/sc-opportunities";
import { fetchUserPreference } from "@/lib/api/user-preferences";
import { fetchHiddenOpportunities } from "@/lib/api/hidden-opportunities";
import { sfRecordUrl, notifyExtension } from "@/lib/sfdc";
import { useIsManager } from "@/hooks/use-is-manager";
import {
  buildPunchList,
  DEFAULT_PUNCH_LIST_SETTINGS,
  type PunchListSettings,
} from "@/lib/punch-list";
import {
  PunchListFilterBar,
  DEFAULT_PUNCH_LIST_FILTERS,
  type PunchListFilters,
} from "@/components/opportunities/PunchListFilterBar";

export const Route = createFileRoute("/punch-list")({
  head: () => ({
    meta: [
      { title: "Punch List — KHARA" },
      {
        name: "description",
        content:
          "Opportunities that need attention based on your hygiene criteria.",
      },
    ],
  }),
  component: PunchListPage,
});

function PunchListPage() {
  const [settings, setSettings] = useState<PunchListSettings>(
    DEFAULT_PUNCH_LIST_SETTINGS,
  );
  const [seFilters, setSeFilters] = useState<PunchListFilters>(
    DEFAULT_PUNCH_LIST_FILTERS,
  );
  const isManager = useIsManager();

  useEffect(() => {
    fetchUserPreference<PunchListSettings>("punchListSettings").then(
      (saved) => {
        if (saved) setSettings({ ...DEFAULT_PUNCH_LIST_SETTINGS, ...saved });
      },
    );
  }, []);

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

  const { data: hiddenIds = [] } = useQuery({
    queryKey: ["hiddenOpportunities"],
    queryFn: fetchHiddenOpportunities,
  });

  const scopedOpportunities = useMemo(
    () =>
      seFilters.ses.length > 0
        ? opportunities.filter(
            (o) => o.nameOfSc && seFilters.ses.includes(o.nameOfSc),
          )
        : opportunities,
    [opportunities, seFilters],
  );

  const rows = useMemo(
    () => buildPunchList(scopedOpportunities, hiddenIds, settings),
    [scopedOpportunities, hiddenIds, settings],
  );

  // Keep the "Punch List in SFDC" extension supplied with the current list so
  // any opp opened in SFDC (single link or Open All) can surface its criteria.
  useEffect(() => {
    notifyExtension(rows.map((r) => ({ oppId: r.opp.id, reasons: r.reasons })));
  }, [rows]);

  const handleOpenAll = () => {
    // Stage the full list before opening tabs so every spawned tab finds its data.
    notifyExtension(rows.map((r) => ({ oppId: r.opp.id, reasons: r.reasons })));
    rows.forEach((row) =>
      window.open(sfRecordUrl(row.opp.id), "_blank", "noopener"),
    );
  };

  if (isError) {
    return (
      <div className="bg-zd-bg font-sans text-zd-dark selection:bg-zd-green/20 min-h-screen">
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
      <main className="p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h1 className="text-lg font-semibold text-zd-dark">Punch List</h1>
        </div>

        <PunchListFilterBar
          filters={seFilters}
          onChange={setSeFilters}
          opportunities={opportunities}
          isManager={isManager}
        />

        <div className="bg-white border border-zd-border rounded overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-zd-bg/50 border-b border-zd-border">
                <tr className="text-left text-[10px] font-bold text-zd-teal/60 uppercase tracking-wider">
                  <th className="px-4 py-2">Opp</th>
                  {isManager && <th className="px-4 py-2">SE</th>}
                  <th className="px-4 py-2">To Do</th>
                  <th className="px-4 py-2 text-right">
                    <button
                      type="button"
                      onClick={handleOpenAll}
                      disabled={rows.length === 0}
                      className="w-[128px] whitespace-nowrap rounded bg-zd-green px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-zd-dark transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      Open All in SFDC
                    </button>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zd-border">
                {rows.length === 0 ? (
                  <tr>
                    <td
                      colSpan={isManager ? 4 : 3}
                      className="px-4 py-8 text-center text-zd-teal/50"
                    >
                      No opportunities match your Punch List criteria.
                    </td>
                  </tr>
                ) : (
                  rows.map(({ opp, reasons }) => (
                    <tr
                      key={opp.id}
                      className="hover:bg-zd-bg/60 transition-colors"
                    >
                      <td className="px-4 py-2 font-medium">
                        <Link
                          to="/opportunities"
                          search={{ oppId: opp.id }}
                          className="text-zd-dark hover:text-zd-green hover:underline"
                        >
                          {opp.name}
                        </Link>
                      </td>
                      {isManager && (
                        <td className="px-4 py-2 text-zd-teal/80">
                          {opp.nameOfSc ?? "Not Assigned"}
                        </td>
                      )}
                      <td className="px-4 py-2">
                        <div className="flex flex-wrap gap-1">
                          {reasons.map((reason) => (
                            <span
                              key={reason}
                              className="inline-block px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider bg-zd-bg text-zd-teal/80 border border-zd-border rounded"
                            >
                              {reason}
                            </span>
                          ))}
                        </div>
                      </td>
                      <td className="px-4 py-2 text-right">
                        <a
                          href={sfRecordUrl(opp.id)}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={() =>
                            notifyExtension([{ oppId: opp.id, reasons }])
                          }
                          className="inline-flex w-[128px] items-center justify-center gap-1 whitespace-nowrap rounded border border-zd-border bg-zd-bg px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-zd-teal/80 transition-colors hover:border-zd-teal/40 hover:text-zd-dark"
                        >
                          <ExternalLink className="size-3" />
                          Open in SFDC
                        </a>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </main>
    </div>
  );
}
