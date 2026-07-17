import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState, useEffect } from "react";
import { X, ChevronDown, Check } from "lucide-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import { OPPORTUNITIES } from "@/lib/opportunities";
import { OpportunityListItem } from "@/components/opportunities/OpportunityListItem";
import { OpportunityDetail } from "@/components/opportunities/OpportunityDetail";
import { AppNav } from "@/components/opportunities/AppNav";
import {
  OppScopeOnboardingDialog,
  type OppScopeSettings,
} from "@/components/opportunities/OppScopeOnboardingDialog";
import {
  fetchUserPreference,
  saveUserPreference,
} from "@/lib/api/user-preferences";
import { fetchOpportunities, ScUserNotFoundError } from "@/lib/api/sc-opportunities";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  FilterBar,
  DEFAULT_FILTERS,
  type Filters,
} from "@/components/opportunities/FilterBar";

type SortOption = "daysSince" | "amount" | "closeDate";

const SORT_LABELS: Record<SortOption, string> = {
  daysSince: "Days Since Update",
  amount: "ARR",
  closeDate: "Close Date",
};


export const Route = createFileRoute("/opportunities")({
  head: () => ({
    meta: [
      { title: "Opportunities — SE Opp Rigor" },
      {
        name: "description",
        content:
          "Review, filter, and dive into your sales opportunity pipeline with D-Score health signals.",
      },
      { property: "og:title", content: "Opportunities — SE Opp Rigor" },
      {
        property: "og:description",
        content:
          "Review, filter, and dive into your sales opportunity pipeline with D-Score health signals.",
      },
    ],
  }),
  component: OpportunitiesPage,
});

// Fetch hidden opportunity IDs
async function fetchHiddenOpportunities() {
  const response = await fetch('/api/hidden-opportunities', {
    credentials: 'include',
  });

  if (!response.ok) {
    throw new Error('Failed to fetch hidden opportunities');
  }

  const data = await response.json();
  return data.hiddenOpportunityIds;
}

// Client-side filtering
function applyFilters(opportunities: typeof OPPORTUNITIES, filters: Filters) {
  return opportunities.filter((opp) => {
    // Search filter
    if (filters.search) {
      const searchLower = filters.search.toLowerCase();
      const matchesSearch =
        opp.name.toLowerCase().includes(searchLower) ||
        opp.account.toLowerCase().includes(searchLower) ||
        opp.owner.toLowerCase().includes(searchLower);
      if (!matchesSearch) return false;
    }

    // Stage filter
    if (filters.stages.length > 0 && !filters.stages.includes(opp.stage)) {
      return false;
    }

    // Owner filter
    if (filters.owner && opp.owner !== filters.owner) {
      return false;
    }

    // Close month filter
    if (filters.closeMonths.length > 0) {
      const oppMonth = opp.closeDate.slice(0, 7);
      if (!filters.closeMonths.includes(oppMonth)) return false;
    }

    // Days since update filter
    if (filters.daysSinceMax !== "") {
      const maxDays = Number(filters.daysSinceMax);
      if (!isNaN(maxDays) && opp.lastUpdateDate) {
        const daysSince = Math.floor(
          (Date.now() - new Date(opp.lastUpdateDate + "T00:00:00").getTime()) / 86_400_000
        );
        if (daysSince > maxDays) return false;
      }
    }

    // ARR minimum filter
    if (filters.arrMin !== "") {
      const minArr = Number(filters.arrMin);
      if (!isNaN(minArr) && opp.amount < minArr) return false;
    }

    return true;
  });
}

function OpportunitiesPage() {
  const queryClient = useQueryClient();
  const [filters, setFilters] = useState<Filters>(DEFAULT_FILTERS);
  const [showDisclaimer, setShowDisclaimer] = useState(true);
  const [sortBy, setSortBy] = useState<SortOption>("closeDate");
  const [sortOpen, setSortOpen] = useState(false);
  const [showHidden, setShowHidden] = useState(false);
  const [filtersLoaded, setFiltersLoaded] = useState(false);
  const [showOnboarding, setShowOnboarding] = useState(false);

  // Fetch opportunities, scoped server-side by SC identity/close-date/ARR
  const {
    data: loaderOpportunities,
    isLoading,
    isError,
    error: opportunitiesError,
  } = useQuery({
    queryKey: ["opportunities"],
    queryFn: fetchOpportunities,
    retry: false,
  });
  const allOpportunities = loaderOpportunities?.opportunities ?? [];
  const scNotFoundError =
    isError && opportunitiesError instanceof ScUserNotFoundError ? opportunitiesError : null;

  // Fetch hidden opportunity IDs
  const {
    data: hiddenIds = [],
  } = useQuery({
    queryKey: ["hiddenOpportunities"],
    queryFn: fetchHiddenOpportunities,
    staleTime: 5 * 60 * 1000,
    retry: 2,
  });

  // Load saved filters and opp-scope settings from database on mount
  useEffect(() => {
    async function loadSavedFilters() {
      try {
        const savedFilters = await fetchUserPreference<Filters>('opportunityFilters');
        const savedSort = await fetchUserPreference<SortOption>('opportunitySort');
        const savedShowHidden = await fetchUserPreference<boolean>('showHiddenOpportunities');
        const savedScopeSettings = await fetchUserPreference('oppScopeSettings');

        if (savedFilters) {
          setFilters(savedFilters);
        }
        if (savedSort) {
          setSortBy(savedSort);
        }
        if (savedShowHidden !== null) {
          setShowHidden(savedShowHidden);
        }
        if (savedScopeSettings === null) {
          setShowOnboarding(true);
        }
      } catch (error) {
        console.error('Failed to load saved filters:', error);
      } finally {
        setFiltersLoaded(true);
      }
    }

    loadSavedFilters();
  }, []);

  const handleOnboardingSave = async (settings: OppScopeSettings) => {
    await saveUserPreference('oppScopeSettings', settings);
    setShowOnboarding(false);
    await fetch('/api/opportunities/my-sc-opps/cache', {
      method: 'DELETE',
      credentials: 'include',
    });
    queryClient.invalidateQueries({ queryKey: ["opportunities"] });
  };

  // Save filters to database whenever they change (debounced)
  useEffect(() => {
    if (!filtersLoaded) return; // Don't save until initial load is complete

    const timeoutId = setTimeout(() => {
      saveUserPreference('opportunityFilters', filters).catch(console.error);
    }, 1000); // Debounce by 1 second

    return () => clearTimeout(timeoutId);
  }, [filters, filtersLoaded]);

  // Save sort preference whenever it changes
  useEffect(() => {
    if (!filtersLoaded) return;

    saveUserPreference('opportunitySort', sortBy).catch(console.error);
  }, [sortBy, filtersLoaded]);

  // Save showHidden preference whenever it changes
  useEffect(() => {
    if (!filtersLoaded) return;

    saveUserPreference('showHiddenOpportunities', showHidden).catch(console.error);
  }, [showHidden, filtersLoaded]);

  // Apply filters client-side and hide/show hidden opps
  const filtered = useMemo(() => {
    const withFilters = applyFilters(allOpportunities, filters);

    // Filter by hidden state
    if (!showHidden) {
      return withFilters.filter((opp) => !hiddenIds.includes(opp.id));
    }

    return withFilters;
  }, [allOpportunities, filters, hiddenIds, showHidden]);

  const sorted = useMemo(() => {
    const list = [...filtered];
    if (sortBy === "amount") {
      list.sort((a, b) => b.amount - a.amount);
    } else if (sortBy === "closeDate") {
      list.sort((a, b) => a.closeDate.localeCompare(b.closeDate));
    } else {
      // daysSince: nulls first (no sc notes / parsing errors), then oldest update date
      list.sort(
        (a, b) => {
          if (!a.lastUpdateDate && !b.lastUpdateDate) return 0;
          if (!a.lastUpdateDate) return -1; // nulls go to top
          if (!b.lastUpdateDate) return 1;
          return new Date(a.lastUpdateDate).getTime() - new Date(b.lastUpdateDate).getTime();
        }
      );
    }
    return list;
  }, [filtered, sortBy]);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected =
    sorted.find((o) => o.id === selectedId) ?? sorted[0] ?? null;


  if (scNotFoundError) {
    return (
      <div className="min-h-screen bg-zd-bg font-sans text-zd-dark selection:bg-zd-green/20">
        <AppNav />
        <main className="max-w-[1440px] mx-auto p-6">
          <div className="bg-white border border-zd-border rounded p-8 text-center text-sm text-zd-teal/70">
            {scNotFoundError.message}
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-zd-bg font-sans text-zd-dark selection:bg-zd-green/20">
      <AppNav />
      <OppScopeOnboardingDialog open={showOnboarding} onSave={handleOnboardingSave} />
      <main className="max-w-[1440px] mx-auto p-6 space-y-6">
        {showDisclaimer && (
          <div className="flex items-start justify-between gap-3 bg-zd-green/10 border border-zd-green/30 text-zd-dark rounded px-4 py-2.5 text-sm">
            <p>
              <span className="font-semibold">Salesforce Data</span> refreshed every
              24-36 hours. Changes made since then will not be reflected in the
              data set below.
            </p>
            <button
              type="button"
              onClick={() => setShowDisclaimer(false)}
              aria-label="Dismiss disclaimer"
              className="shrink-0 text-zd-teal/70 hover:text-zd-dark transition-colors"
            >
              <X className="size-4" />
            </button>
          </div>
        )}

        <FilterBar filters={filters} onChange={setFilters} opportunities={allOpportunities} />


        <div className="grid grid-cols-10 gap-0 bg-white border border-zd-border rounded overflow-hidden h-[calc(100vh-260px)] min-h-[520px] shadow-sm">
          <div className="col-span-3 border-r border-zd-border flex flex-col h-full min-h-0 min-w-0">
            <div className="border-b border-zd-border bg-zd-bg/50">
              <div className="p-3 flex items-center justify-between">
                <span className="text-[11px] font-bold text-zd-teal/60 uppercase tracking-wider">
                  {isLoading ? (
                    "Loading..."
                  ) : (
                    <>
                      {sorted.length} {sorted.length === 1 ? "result" : "results"}
                    </>
                  )}
                </span>
                <span className="text-[10px] text-zd-teal/40 font-mono">
                  {!isLoading && `of ${allOpportunities.length}`}
                </span>
              </div>
              <div className="px-3 pb-2 flex items-center justify-between text-[11px]">
                <div className="flex items-center gap-1">
                  <span className="font-bold text-zd-teal/60 uppercase tracking-wider">
                    Sort:
                  </span>
                  <Popover open={sortOpen} onOpenChange={setSortOpen}>
                    <PopoverTrigger asChild>
                      <button
                        type="button"
                        className="inline-flex items-center gap-1 text-zd-teal font-semibold hover:text-zd-dark transition-colors"
                      >
                        {SORT_LABELS[sortBy]}
                        <ChevronDown className="size-3" />
                      </button>
                    </PopoverTrigger>
                    <PopoverContent align="start" className="w-48 p-1">
                      {(Object.keys(SORT_LABELS) as SortOption[]).map((opt) => {
                        const active = opt === sortBy;
                        return (
                          <button
                            key={opt}
                            type="button"
                            onClick={() => {
                              setSortBy(opt);
                              setSortOpen(false);
                            }}
                            className={`w-full flex items-center justify-between gap-2 px-2 py-1.5 text-sm rounded hover:bg-zd-bg ${
                              active ? "text-zd-dark font-semibold" : "text-zd-teal/80"
                            }`}
                          >
                            <span>{SORT_LABELS[opt]}</span>
                            {active && <Check className="size-3.5 text-zd-green" />}
                          </button>
                        );
                      })}
                    </PopoverContent>
                  </Popover>
                </div>
                <label className="flex items-center gap-1.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={showHidden}
                    onChange={(e) => setShowHidden(e.target.checked)}
                    className="w-3 h-3 cursor-pointer"
                  />
                  <span className="text-[10px] font-bold text-zd-teal/60 uppercase tracking-wider">
                    Show Hidden
                  </span>
                </label>
              </div>
            </div>
            <div className="flex-1 overflow-y-auto divide-y divide-zd-border">
              {isLoading ? (
                <div className="p-8 text-center text-sm text-zd-teal/50">
                  Loading opportunities...
                </div>
              ) : sorted.length === 0 ? (
                <div className="p-8 text-center text-sm text-zd-teal/50">
                  No opportunities match the current filters.
                </div>
              ) : (
                sorted.map((opp) => (
                  <OpportunityListItem
                    key={opp.id}
                    opp={opp}
                    active={selected?.id === opp.id}
                    onClick={() => setSelectedId(opp.id)}
                    isHidden={hiddenIds.includes(opp.id)}
                  />
                ))
              )}
            </div>
          </div>

          {selected ? (
            <OpportunityDetail opp={selected} isHidden={hiddenIds.includes(selected.id)} />
          ) : (
            <div className="col-span-7 flex items-center justify-center text-sm text-zd-teal/50">
              Select an opportunity to view details.
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
