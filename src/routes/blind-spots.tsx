import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowDown,
  ArrowUp,
  ChevronDown,
  ExternalLink,
} from "lucide-react";
import { fetchBlindSpots, setBlindSpotReviewed } from "@/lib/api/blind-spots";
import { sfRecordUrl } from "@/lib/sfdc";
import { useIsManager } from "@/hooks/use-is-manager";

export const Route = createFileRoute("/blind-spots")({
  head: () => ({
    meta: [
      { title: "Blind Spots — KHARA" },
      {
        name: "description",
        content: "Surface potential gaps in opportunity coverage.",
      },
    ],
  }),
  component: BlindSpotsPage,
});

function BlindSpotsPage() {
  const isManager = useIsManager();
  const queryClient = useQueryClient();
  const { data, isLoading, isError, error } = useQuery({
    queryKey: ["blindSpots"],
    queryFn: fetchBlindSpots,
    enabled: !isManager,
    retry: false,
  });
  const [reviewedIds, setReviewedIds] = useState<Set<string>>(new Set());
  const [reviewedExpanded, setReviewedExpanded] = useState(true);
  const [unreviewedExpanded, setUnreviewedExpanded] = useState(true);
  const [sort, setSort] = useState<{
    column: "name" | "account" | "owner" | "amount" | "stage" | "closeDate";
    direction: "asc" | "desc";
  }>({ column: "name", direction: "asc" });

  useEffect(() => {
    setReviewedIds(new Set(data?.reviewedOpportunityIds ?? []));
  }, [data?.reviewedOpportunityIds]);

  const reviewMutation = useMutation({
    mutationFn: ({
      opportunityId,
      reviewed,
    }: {
      opportunityId: string;
      reviewed: boolean;
    }) => setBlindSpotReviewed(opportunityId, reviewed),
    onMutate: async ({ opportunityId, reviewed }) => {
      const previous = new Set(reviewedIds);
      setReviewedIds((current) => {
        const next = new Set(current);
        if (reviewed) next.add(opportunityId);
        else next.delete(opportunityId);
        return next;
      });
      return { previous };
    },
    onError: (_error, _variables, context) => {
      if (context?.previous) setReviewedIds(context.previous);
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["blindSpots"] });
    },
  });

  const opportunities = useMemo(
    () => data?.opportunities ?? [],
    [data?.opportunities],
  );
  const compareOpportunities = (a: (typeof opportunities)[number], b: (typeof opportunities)[number]) => {
    const aValue = a[sort.column];
    const bValue = b[sort.column];
    let comparison = 0;

    if (sort.column === "amount") {
      comparison = a.amount - b.amount;
    } else if (sort.column === "closeDate") {
      comparison = (a.closeDate ?? "").localeCompare(b.closeDate ?? "");
    } else {
      comparison = String(aValue ?? "").localeCompare(String(bValue ?? ""), undefined, {
        sensitivity: "base",
      });
    }

    return (sort.direction === "asc" ? comparison : -comparison) ||
      a.name.localeCompare(b.name);
  };
  const reviewedOpportunities = useMemo(
    () =>
      opportunities
        .filter((opportunity) => reviewedIds.has(opportunity.id))
        .sort(compareOpportunities),
    [opportunities, reviewedIds, sort],
  );
  const unreviewedOpportunities = useMemo(
    () =>
      opportunities
        .filter((opportunity) => !reviewedIds.has(opportunity.id))
        .sort(compareOpportunities),
    [opportunities, reviewedIds, sort],
  );

  const setSortColumn = (column: typeof sort.column) => {
    setSort((current) =>
      current.column === column
        ? { column, direction: current.direction === "asc" ? "desc" : "asc" }
        : { column, direction: "asc" },
    );
  };

  if (isManager) {
    return (
      <main className="p-6">
        <div className="rounded border border-zd-border bg-white p-8 text-center">
          <h2 className="text-sm font-semibold text-zd-dark">Blind Spots</h2>
          <p className="mt-2 text-sm text-zd-teal/70">
            Blind Spots are available to individual Solution Consultants only.
          </p>
        </div>
      </main>
    );
  }

  if (isLoading) {
    return (
      <main className="p-6">
        <div className="rounded border border-zd-border bg-white p-8 text-center text-sm text-zd-teal/60">
          Loading Blind Spots…
        </div>
      </main>
    );
  }

  if (isError) {
    return (
      <main className="p-6">
        <div className="rounded border border-red-200 bg-white p-8 text-center text-sm text-red-600">
          Failed to load Blind Spots: {error.message}
        </div>
      </main>
    );
  }

  const handleOpenAll = (items: (typeof opportunities)[number][]) => {
    items.forEach((opportunity) =>
      window.open(sfRecordUrl(opportunity.id), "_blank", "noopener"),
    );
  };

  const renderOpportunityRow = (opp: (typeof opportunities)[number]) => (
    <tr key={opp.id} className="hover:bg-zd-bg/60 transition-colors">
      <td className="px-4 py-2 font-medium text-zd-dark">{opp.name}</td>
      <td className="px-4 py-2 text-zd-teal/90">{opp.account}</td>
      <td className="px-4 py-2 text-zd-teal/90">{opp.owner}</td>
      <td className="px-4 py-2 text-right font-mono text-zd-dark">
        ${Math.round(opp.amount).toLocaleString()}
      </td>
      <td className="px-4 py-2 text-zd-teal/90">{opp.stage}</td>
      <td className="px-4 py-2 font-mono text-zd-teal/80 whitespace-nowrap">
        {opp.closeDate
          ? new Date(`${opp.closeDate}T00:00:00`).toLocaleDateString("en-US", {
              month: "short",
              day: "numeric",
              year: "numeric",
            })
          : "—"}
      </td>
      <td className="px-4 py-2 text-center">
        <input
          type="checkbox"
          checked={reviewedIds.has(opp.id)}
          disabled={reviewMutation.isPending}
          onChange={(event) =>
            reviewMutation.mutate({
              opportunityId: opp.id,
              reviewed: event.target.checked,
            })
          }
          aria-label={`Mark ${opp.name} as reviewed`}
          className="size-3.5 cursor-pointer accent-zd-green disabled:cursor-not-allowed disabled:opacity-50"
        />
      </td>
      <td className="px-4 py-2 text-right">
        <a
          href={sfRecordUrl(opp.id)}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex w-[128px] items-center justify-center gap-1 whitespace-nowrap rounded border border-zd-border bg-zd-bg px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-zd-teal/80 transition-colors hover:border-zd-teal/40 hover:text-zd-dark"
        >
          <ExternalLink className="size-3" />
          Open in SFDC
        </a>
      </td>
    </tr>
  );

  const renderPanel = (
    title: string,
    items: (typeof opportunities)[number][],
    expanded: boolean,
    onToggle: () => void,
  ) => (
    <div className="bg-white border border-zd-border rounded overflow-hidden">
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center justify-between bg-zd-dark px-4 py-2 text-left text-xs font-bold uppercase tracking-wider text-white"
      >
        <span>
          {title} ({items.length})
        </span>
        <ChevronDown
          className={`size-4 transition-transform ${expanded ? "rotate-180" : ""}`}
        />
      </button>
      {expanded && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-zd-bg/50 border-b border-zd-border">
              <tr className="text-left text-[10px] font-bold text-zd-teal/60 uppercase tracking-wider">
                {[
                  ["name", "Opp"],
                  ["account", "Account"],
                  ["owner", "AE"],
                  ["amount", "ARR"],
                  ["stage", "Stage"],
                  ["closeDate", "Close Date"],
                ].map(([column, label]) => (
                  <th
                    key={column}
                    className={`px-4 py-2 ${column === "amount" ? "text-right" : ""}`}
                  >
                    <button
                      type="button"
                      onClick={() => setSortColumn(column as typeof sort.column)}
                      className="inline-flex items-center gap-1 hover:text-zd-dark"
                    >
                      {label}
                      {sort.column === column &&
                        (sort.direction === "asc" ? (
                          <ArrowUp className="size-3" />
                        ) : (
                          <ArrowDown className="size-3" />
                        ))}
                    </button>
                  </th>
                ))}
                <th className="px-4 py-2 text-center">Reviewed</th>
                <th className="px-4 py-2 text-right">
                  <button
                    type="button"
                    onClick={() => handleOpenAll(items)}
                    disabled={items.length === 0}
                    className="w-[128px] whitespace-nowrap rounded bg-zd-green px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-zd-dark transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Open All in SFDC
                  </button>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zd-border">
              {items.length === 0 ? (
                <tr>
                  <td
                    colSpan={8}
                    className="px-4 py-8 text-center text-zd-teal/50"
                  >
                    No Blind Spots match your saved scope.
                  </td>
                </tr>
              ) : (
                items.map(renderOpportunityRow)
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );

  return (
    <main className="p-6 space-y-4">
      <p className="text-base text-zd-teal/80">
        {opportunities.length} active opportunities owned by your AEs without an
        SE in SFDC.
      </p>

      {!data?.metadata.configured ? (
        <div className="rounded border border-zd-border bg-white p-8 text-center">
          <h2 className="text-sm font-semibold text-zd-dark">
            Configure your Blind Spots scope
          </h2>
          <p className="mt-2 text-sm text-zd-teal/70">
            Add one or more AE Zendesk email addresses in Settings to populate
            this list.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {renderPanel(
            "Unreviewed",
            unreviewedOpportunities,
            unreviewedExpanded,
            () => setUnreviewedExpanded((open) => !open),
          )}
          {renderPanel(
            "Reviewed",
            reviewedOpportunities,
            reviewedExpanded,
            () => setReviewedExpanded((open) => !open),
          )}
        </div>
      )}
    </main>
  );
}
