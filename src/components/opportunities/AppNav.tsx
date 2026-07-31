import {
  useEffect,
  useMemo,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { Link, useRouterState } from "@tanstack/react-router";
import {
  BarChart3,
  CircleHelp,
  Clock3,
  DollarSign,
  FilePenLine,
  Glasses,
  RefreshCw,
  Settings,
  AlertTriangle,
} from "lucide-react";
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
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarTrigger,
  useSidebar,
} from "@/components/ui/sidebar";
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

export function AppNav({ children }: { children?: ReactNode }) {
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
    <SidebarProvider
      defaultOpen
      style={{ "--sidebar-width": "10rem" } as CSSProperties}
    >
      <AppSidebar punchListCount={punchListCount} />
      <div className="flex min-h-svh min-w-0 flex-1 flex-col bg-zd-bg">
        <AppHeader
          preferredName={preferredName}
          lastRefreshed={lastRefreshed}
          syncPending={syncPending}
          isRefreshing={isRefreshing}
          onRefresh={() => handleRefresh()}
        />
        <div className="min-w-0 flex-1">{children}</div>
      </div>
    </SidebarProvider>
  );
}

function AppSidebar({ punchListCount }: { punchListCount: number }) {
  const { state } = useSidebar();
  const pathname = useRouterState({
    select: (state) => state.location.pathname,
  });

  return (
    <Sidebar
      collapsible="icon"
      className="border-zd-dark/20 bg-zd-dark text-white [&_[data-sidebar=menu-button]]:text-white/80 [&_[data-sidebar=menu-button]:hover]:text-[#324C4C] [&_[data-sidebar=menu-button][data-active=true]]:bg-white/10 [&_[data-sidebar=menu-button][data-active=true]]:text-zd-green [&_[data-sidebar=menu-sub-button]]:text-white/70 [&_[data-sidebar=menu-sub-button][data-active=true]]:bg-white/10 [&_[data-sidebar=menu-sub-button][data-active=true]]:text-zd-green [&_[data-sidebar=sidebar]]:bg-zd-dark [&_[data-sidebar=sidebar]]:text-white"
    >
      <SidebarHeader className="h-[60px] shrink-0 justify-center border-b border-white/10 p-2">
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              size="lg"
              className="!p-0 justify-start hover:bg-white/10 hover:text-white group-data-[collapsible=icon]:!size-8 group-data-[collapsible=icon]:!overflow-visible"
            >
              <span className="flex size-8 shrink-0 items-center justify-center rounded-sm bg-zd-green text-[16px] font-bold italic tracking-tight text-zd-dark">
                K
              </span>
              <span className="min-w-0 whitespace-nowrap text-sm font-bold tracking-wide text-white group-data-[collapsible=icon]:hidden">
                KHARA
              </span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton
                  asChild
                  isActive={pathname === "/"}
                  tooltip="Metrics"
                >
                  <Link to="/" activeOptions={{ exact: true }}>
                    <BarChart3 />
                    <span>Metrics</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>

              <SidebarMenuItem>
                <SidebarMenuButton
                  asChild
                  isActive={pathname === "/opportunities"}
                  tooltip="Opportunities"
                >
                  <Link to="/opportunities">
                    <DollarSign />
                    <span>Opportunities</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>

              <SidebarMenuItem>
                <SidebarMenuButton
                  asChild
                  isActive={pathname === "/punch-list"}
                  tooltip="Punch List"
                >
                  <Link to="/punch-list">
                    <FilePenLine />
                    <span className="whitespace-nowrap">
                      Punch List
                      {punchListCount > 0 ? ` (${punchListCount})` : ""}
                    </span>
                    {punchListCount > 0 && state === "collapsed" && (
                      <span
                        aria-hidden="true"
                        className="absolute bottom-1.5 right-1.5 size-2 rounded-full bg-red-500 ring-2 ring-zd-dark"
                      />
                    )}
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>

              <SidebarMenuItem>
                <SidebarMenuButton
                  asChild
                  isActive={pathname === "/blind-spots"}
                  tooltip="Blind Spots"
                >
                  <Link to="/blind-spots">
                    <Glasses />
                    <span>Blind Spots</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>

              <SidebarMenuItem>
                <SidebarMenuButton
                  asChild
                  isActive={pathname === "/activities"}
                  tooltip="Activities"
                >
                  <Link to="/activities">
                    <Clock3 />
                    <span>Activities</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter className="gap-2 border-t border-white/10 p-3">
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              asChild
              isActive={pathname === "/help"}
              tooltip="Help"
            >
              <Link to="/help">
                <CircleHelp />
                <span>Help</span>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
          <SidebarMenuItem>
            <SidebarMenuButton
              asChild
              isActive={pathname === "/settings"}
              tooltip="Settings"
            >
              <Link to="/settings">
                <Settings />
                <span>Settings</span>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
          <SidebarMenuItem>
            <SidebarTrigger
              className="h-8 w-full justify-start gap-2 overflow-hidden rounded-md px-2 text-white/70 hover:bg-white hover:text-zd-dark group-data-[collapsible=icon]:!w-8"
              aria-label="Expand or collapse navigation"
            >
              <CollapseLabel />
            </SidebarTrigger>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  );
}

function CollapseLabel() {
  return <span>Collapse</span>;
}

function AppHeader({
  preferredName,
  lastRefreshed,
  syncPending,
  isRefreshing,
  onRefresh,
}: {
  preferredName: string;
  lastRefreshed: string;
  syncPending: boolean;
  isRefreshing: boolean;
  onRefresh: () => void;
}) {
  const pathname = useRouterState({
    select: (state) => state.location.pathname,
  });
  const title =
    {
      "/": "Metrics",
      "/opportunities": "Opportunities",
      "/punch-list": "Punch List",
      "/blind-spots": "Blind Spots",
      "/activities": "Activities",
      "/help": "Help",
      "/settings": "Settings",
      "/admin": "Diagnostics",
    }[pathname] ?? "KHARA";

  return (
    <header className="sticky top-0 z-40 flex h-[60px] items-center justify-between border-b border-zd-border bg-zd-bg px-4 md:px-6">
      <div className="flex min-w-0 items-center gap-2">
        <SidebarTrigger className="md:hidden" aria-label="Open navigation" />
        <h1 className="truncate text-lg font-semibold text-zd-dark">{title}</h1>
      </div>
      <div className="flex items-center gap-3 md:gap-[15px]">
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
            className="flex flex-col items-end font-mono text-[12px] leading-tight text-zd-teal/70"
            title="Last refreshed"
          >
            <span>Last Data Sync</span>
            <span>{lastRefreshed}</span>
          </span>
        </div>
        <button
          type="button"
          onClick={onRefresh}
          disabled={isRefreshing}
          aria-label="Refresh Data"
          title="Refresh Data"
          className="text-zd-teal/70 transition-colors hover:text-zd-dark disabled:opacity-50"
        >
          <RefreshCw
            className={`size-5 ${isRefreshing ? "animate-spin" : ""}`}
          />
        </button>
        <span className="text-[15px] font-medium text-zd-dark/80">
          {preferredName ? `Hi, ${preferredName}!` : "Hi there!"}
        </span>
      </div>
    </header>
  );
}
