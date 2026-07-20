import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ExternalLink } from "lucide-react";

import { AppNav } from "@/components/opportunities/AppNav";
import { fetchOpportunities } from "@/lib/api/sc-opportunities";
import { fetchUserPreference } from "@/lib/api/user-preferences";
import { fetchHiddenOpportunities } from "@/lib/api/hidden-opportunities";
import { sfRecordUrl } from "@/lib/sfdc";
import {
  buildPunchList,
  DEFAULT_PUNCH_LIST_SETTINGS,
  type PunchListSettings,
} from "@/lib/punch-list";

export const Route = createFileRoute("/punch-list")({
  head: () => ({
    meta: [
      { title: "Punch List — KHARA" },
      {
        name: "description",
        content: "Opportunities that need attention based on your hygiene criteria.",
      },
    ],
  }),
  component: PunchListPage,
});

function PunchListPage() {
  const [settings, setSettings] = useState<PunchListSettings>(DEFAULT_PUNCH_LIST_SETTINGS);

  useEffect(() => {
    fetchUserPreference<PunchListSettings>("punchListSettings").then((saved) => {
      if (saved) setSettings({ ...DEFAULT_PUNCH_LIST_SETTINGS, ...saved });
    });
  }, []);

  const { data: loaderOpportunities, isError, error: opportunitiesError } = useQuery({
    queryKey: ["opportunities"],
    queryFn: fetchOpportunities,
    retry: false,
  });
  const opportunities = loaderOpportunities?.opportunities ?? [];

  const { data: hiddenIds = [] } = useQuery({
    queryKey: ["hiddenOpportunities"],
    queryFn: fetchHiddenOpportunities,
  });

  const rows = useMemo(
    () => buildPunchList(opportunities, hiddenIds, settings),
    [opportunities, hiddenIds, settings],
  );

  const handleOpenAll = () => {
    rows.forEach((row) => window.open(sfRecordUrl(row.opp.id), "_blank", "noopener"));
  };

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
      <main className="p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h1 className="text-lg font-semibold text-zd-dark">Punch List</h1>
          <button
            type="button"
            onClick={handleOpenAll}
            disabled={rows.length === 0}
            className="px-4 py-2 text-xs font-bold uppercase tracking-wider bg-zd-green text-zd-dark rounded hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Open All in SFDC
          </button>
        </div>

        <div className="bg-white border border-zd-border rounded overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-zd-bg/50 border-b border-zd-border">
                <tr className="text-left text-[10px] font-bold text-zd-teal/60 uppercase tracking-wider">
                  <th className="px-4 py-2">Opp</th>
                  <th className="px-4 py-2">To Do</th>
                  <th className="px-4 py-2"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zd-border">
                {rows.length === 0 ? (
                  <tr>
                    <td colSpan={3} className="px-4 py-8 text-center text-zd-teal/50">
                      No opportunities match your Punch List criteria.
                    </td>
                  </tr>
                ) : (
                  rows.map(({ opp, reasons }) => (
                    <tr key={opp.id} className="hover:bg-zd-bg/60 transition-colors">
                      <td className="px-4 py-2 font-medium">
                        <Link
                          to="/opportunities"
                          search={{ oppId: opp.id }}
                          className="text-zd-dark hover:text-zd-green hover:underline"
                        >
                          {opp.name}
                        </Link>
                      </td>
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
                          className="inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider bg-zd-bg text-zd-teal/80 border border-zd-border rounded hover:text-zd-dark hover:border-zd-teal/40 transition-colors"
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
