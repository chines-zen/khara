import { useEffect, useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { Settings, RefreshCw, AlertTriangle } from "lucide-react";
import {
  useQuery,
  useQueryClient,
  useMutation,
  useIsMutating,
} from "@tanstack/react-query";
import { usePreferredName, useTimezone } from "@/lib/preferences";
import { fetchOpportunities } from "@/lib/api/sc-opportunities";
import { fetchActivities } from "@/lib/api/activities";
import {
  DATA_SYNC_PENDING_QUERY_KEY,
  fetchDataSyncPending,
  setDataSyncPending,
} from "@/lib/api/data-sync-pending";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { fetchHiddenOpportunities } from "@/lib/api/hidden-opportunities";
import { fetchUserPreference } from "@/lib/api/user-preferences";
import { useActivitiesEnabled } from "@/hooks/use-activities-enabled";
import {
  buildPunchList,
  DEFAULT_PUNCH_LIST_SETTINGS,
  type PunchListSettings,
} from "@/lib/punch-list";

// Keyed on the QueryClient (which lives in __root and outlives AppNav), so the
// in-flight state survives AppNav unmounting/remounting when the user navigates
// between tabs mid-sync. A component-local useState would reset on remount.
const REFRESH_MUTATION_KEY = ["appNavRefresh"];

function formatLastRefreshed(iso: string | undefined, timezone: string) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "—";
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  }).formatToParts(d);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${get("month")}/${get("day")} ${get("hour")}:${get("minute")} ${get("dayPeriod").toUpperCase()}`;
}

export function AppNav() {
  const linkBase = "px-[15px] py-[5px] text-[15px] font-medium";
  const preferredName = usePreferredName();
  const timezone = useTimezone();
  const activitiesEnabled = useActivitiesEnabled();
  const queryClient = useQueryClient();
  const [punchListSettings, setPunchListSettings] = useState<PunchListSettings>(
    DEFAULT_PUNCH_LIST_SETTINGS,
  );

  useEffect(() => {
    fetchUserPreference<PunchListSettings>("punchListSettings").then(
      (saved) => {
        if (saved)
          setPunchListSettings({ ...DEFAULT_PUNCH_LIST_SETTINGS, ...saved });
      },
    );
  }, []);

  // retry: false must match every other observer of this key (the dashboard and
  // opportunities pages). Mismatched retry settings on a shared key resolve by
  // observer registration order, and each retry of a failed fetch re-enters the
  // Snowflake connect path — which in EXTERNALBROWSER mode is a new SSO tab.
  const { data, dataUpdatedAt } = useQuery({
    queryKey: ["opportunities"],
    queryFn: fetchOpportunities,
    retry: false,
  });
  const lastRefreshed = formatLastRefreshed(data?.metadata?.cachedAt, timezone);

  const { data: hiddenIds = [] } = useQuery({
    queryKey: ["hiddenOpportunities"],
    queryFn: fetchHiddenOpportunities,
  });

  const { data: syncPending = false } = useQuery({
    queryKey: DATA_SYNC_PENDING_QUERY_KEY,
    queryFn: fetchDataSyncPending,
  });

  // A scope change flags data as needing a re-sync (amber warning). The manual
  // Refresh button clears it, but a fresh sync also happens whenever the
  // opportunities query pulls from Snowflake on a cache miss (e.g. the user just
  // visits the opp page after changing scope). When that resolves as a real pull
  // (metadata.cached === false), clear the warning too so it doesn't linger and
  // confuse the user into thinking their data is still stale. Keyed on
  // dataUpdatedAt so it only fires when a fetch actually resolves.
  useEffect(() => {
    if (syncPending && data?.metadata?.cached === false) {
      setDataSyncPending(false).then(() => {
        queryClient.invalidateQueries({
          queryKey: DATA_SYNC_PENDING_QUERY_KEY,
        });
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dataUpdatedAt, syncPending]);

  const punchListCount = useMemo(
    () =>
      buildPunchList(data?.opportunities ?? [], hiddenIds, punchListSettings)
        .length,
    [data?.opportunities, hiddenIds, punchListSettings],
  );

  // The mutation state lives on the QueryClient, so isRefreshing reflects any
  // in-flight sync even after this AppNav instance remounts on tab navigation.
  const isRefreshing = useIsMutating({ mutationKey: REFRESH_MUTATION_KEY }) > 0;

  const { mutate: handleRefresh } = useMutation({
    mutationKey: REFRESH_MUTATION_KEY,
    mutationFn: async () => {
      // Opps: drop the cache blob so it's fully re-pulled (they change daily).
      // Activities: force a resync now (incremental for known SEs, full backfill
      // for any newly-scoped ones) - keeps watermarks, unlike DELETE .../cache.
      // D-Score: no list-level query; invalidate so the next opp-open refetches
      // through the (now incremental) per-opp sync path.
      await Promise.all([
        fetch("/api/opportunities/my-sc-opps/cache", {
          method: "DELETE",
          credentials: "include",
        }),
        activitiesEnabled
          ? fetchActivities({ force: true }).catch(() => undefined)
          : Promise.resolve(),
      ]);
      // Data now matches current settings - clear the "needs re-sync" warning.
      await setDataSyncPending(false);
      await Promise.all([
        queryClient.refetchQueries({ queryKey: ["opportunities"] }),
        queryClient.invalidateQueries({ queryKey: ["activities"] }),
        queryClient.invalidateQueries({ queryKey: ["dispassionateReviews"] }),
        queryClient.invalidateQueries({
          queryKey: DATA_SYNC_PENDING_QUERY_KEY,
        }),
      ]);
    },
  });

  return (
    <nav className="h-[60px] bg-zd-dark flex items-center px-5 justify-between sticky top-0 z-50">
      <div className="flex items-center gap-[30px]">
        <div className="h-[30px] px-[7.5px] bg-zd-green rounded-sm flex items-center justify-center font-bold text-zd-dark text-[11px] italic tracking-tight">
          KHARA
        </div>
        <div className="flex gap-[5px]">
          <Link
            to="/"
            activeOptions={{ exact: true }}
            className={`${linkBase} text-white/70 hover:text-white`}
            activeProps={{
              className: `${linkBase} text-white border-b-2 border-zd-green`,
            }}
          >
            Dashboard
          </Link>
          <Link
            to="/opportunities"
            className={`${linkBase} text-white/70 hover:text-white`}
            activeProps={{
              className: `${linkBase} text-white border-b-2 border-zd-green`,
            }}
          >
            Opportunities
          </Link>
          <Link
            to="/punch-list"
            className={`${linkBase} text-white/70 hover:text-white`}
            activeProps={{
              className: `${linkBase} text-white border-b-2 border-zd-green`,
            }}
          >
            Punch List{punchListCount > 0 ? ` (${punchListCount})` : ""}
          </Link>
          {activitiesEnabled && (
            <Link
              to="/activities"
              className={`${linkBase} text-white/70 hover:text-white`}
              activeProps={{
                className: `${linkBase} text-white border-b-2 border-zd-green`,
              }}
            >
              Activities
            </Link>
          )}
        </div>
      </div>
      <div className="flex items-center gap-[15px]">
        <div className="flex items-center gap-[8px]">
          {syncPending && (
            <TooltipProvider delayDuration={0}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <span
                    aria-label="Re-sync data to see changes."
                    className="flex items-center text-amber-400"
                  >
                    <AlertTriangle className="size-4" />
                  </span>
                </TooltipTrigger>
                <TooltipContent side="bottom">
                  Re-sync data to see changes.
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          )}
          <span
            className="text-white/50 text-[12px] font-mono leading-tight flex flex-col items-end"
            title="Last refreshed"
          >
            <span>Last Data Sync</span>
            <span>{lastRefreshed}</span>
          </span>
        </div>
        <button
          type="button"
          onClick={() => handleRefresh()}
          disabled={isRefreshing}
          aria-label="Refresh Data"
          title="Refresh Data"
          className="text-white/70 hover:text-white transition-colors disabled:opacity-50"
        >
          <RefreshCw
            className={`size-5 ${isRefreshing ? "animate-spin" : ""}`}
          />
        </button>
        <Link
          to="/settings"
          aria-label="Settings"
          className="text-white/70 hover:text-white transition-colors"
          activeProps={{ className: "text-zd-green" }}
        >
          <Settings className="size-5" />
        </Link>
        <span className="text-white/80 text-[15px] font-medium">
          {preferredName ? `Hi, ${preferredName}!` : "Hi there!"}
        </span>
      </div>
    </nav>
  );
}
