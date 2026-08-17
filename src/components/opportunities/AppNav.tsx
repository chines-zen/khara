import {
  useEffect,
  useMemo,
  useRef,
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
  CheckCircle2,
  Circle,
  LoaderCircle,
  XCircle,
} from "lucide-react";
import {
  useQuery,
  useQueryClient,
  useMutation,
  useIsMutating,
} from "@tanstack/react-query";
import { usePreferredName, useTimezone } from "@/lib/preferences";
import { useIsManager } from "@/hooks/use-is-manager";
import {
  DataExpiredError,
  fetchOpportunities,
} from "@/lib/api/sc-opportunities";
import {
  syncSnowflakeData,
  type SnowflakeSyncDomainName,
  type SnowflakeSyncRunStatus,
} from "@/lib/api/snowflake-data-sync";
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
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
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
import { fetchBlindSpots } from "@/lib/api/blind-spots";
import { fetchUserPreference } from "@/lib/api/user-preferences";
import {
  buildPunchList,
  DEFAULT_PUNCH_LIST_SETTINGS,
  type PunchListSettings,
} from "@/lib/punch-list";

// Keyed on the QueryClient (which lives in __root and outlives AppNav), so the
// in-flight state survives AppNav unmounting/remounting when the user navigates
// between tabs mid-sync. A component-local useState would reset on remount.
const REFRESH_MUTATION_KEY = ["appNavRefresh"];
const SYNC_DOMAINS: { name: SnowflakeSyncDomainName; label: string }[] = [
  { name: "opportunities", label: "Opportunities" },
  { name: "activities", label: "Activities" },
  { name: "blindSpots", label: "Blind Spots" },
  { name: "dispassionateReviews", label: "D-Scores" },
  { name: "gongCalls", label: "Gong Calls" },
];

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
  const isManager = useIsManager();
  const queryClient = useQueryClient();
  const { data: savedPunchListSettings } = useQuery({
    queryKey: ["punchListSettings"],
    queryFn: () => fetchUserPreference<PunchListSettings>("punchListSettings"),
  });
  const punchListSettings = useMemo(
    () => ({ ...DEFAULT_PUNCH_LIST_SETTINGS, ...savedPunchListSettings }),
    [savedPunchListSettings],
  );

  // retry: false must match every other observer of this key (the dashboard and
  // opportunities pages). Mismatched retry settings on a shared key resolve by
  // observer registration order, and each retry of a failed fetch re-enters the
  // Snowflake connect path — which in EXTERNALBROWSER mode is a new SSO tab.
  const {
    data,
    dataUpdatedAt,
    error: opportunitiesError,
  } = useQuery({
    queryKey: ["opportunities"],
    queryFn: fetchOpportunities,
    retry: false,
  });
  const lastRefreshed = formatLastRefreshed(data?.metadata?.cachedAt, timezone);

  const { data: hiddenIds = [] } = useQuery({
    queryKey: ["hiddenOpportunities"],
    queryFn: fetchHiddenOpportunities,
  });

  const { data: blindSpotsData } = useQuery({
    queryKey: ["blindSpots"],
    queryFn: fetchBlindSpots,
    enabled: !isManager,
    retry: false,
  });

  const { data: syncPending = false } = useQuery({
    queryKey: DATA_SYNC_PENDING_QUERY_KEY,
    queryFn: fetchDataSyncPending,
  });

  // An opportunity cache miss now runs the full unified server sync before it
  // resolves (rather than pulling only opportunities), so this is also a safe
  // point to clear the scope-change warning.
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

  const blindSpotsCount = useMemo(() => {
    if (!blindSpotsData) return 0;
    const reviewedIds = new Set(blindSpotsData.reviewedOpportunityIds ?? []);
    return blindSpotsData.opportunities.filter(
      (opportunity) => !reviewedIds.has(opportunity.id),
    ).length;
  }, [blindSpotsData]);

  // The mutation state lives on the QueryClient, so isRefreshing reflects any
  // in-flight sync even after this AppNav instance remounts on tab navigation.
  const isRefreshing = useIsMutating({ mutationKey: REFRESH_MUTATION_KEY }) > 0;
  const autoSyncAttempted = useRef(false);
  const [isFinishingSync, setIsFinishingSync] = useState(false);
  const [syncStatus, setSyncStatus] = useState<SnowflakeSyncRunStatus | null>(
    null,
  );

  const { mutate: handleRefresh } = useMutation({
    mutationKey: REFRESH_MUTATION_KEY,
    mutationFn: async () => {
      // The server waits until all five Snowflake mirrors have finished before
      // it resolves. That gives these cache-backed UI reads one completed scope
      // instead of refreshing opportunities now and Gong/D-Score data later on
      // a detail page.
      setIsFinishingSync(false);
      setSyncStatus(null);
      await syncSnowflakeData(setSyncStatus);
      setIsFinishingSync(true);
      await new Promise((resolve) => window.setTimeout(resolve, 1000));

      // Data now matches current settings - clear the "needs re-sync" warning.
      await setDataSyncPending(false);
      await Promise.all([
        queryClient.refetchQueries({ queryKey: ["opportunities"] }),
        queryClient.refetchQueries({ queryKey: ["blindSpots"] }),
        queryClient.invalidateQueries({ queryKey: ["activities"] }),
        queryClient.invalidateQueries({ queryKey: ["dispassionateReviews"] }),
        queryClient.invalidateQueries({ queryKey: ["gongCalls"] }),
        queryClient.invalidateQueries({
          queryKey: DATA_SYNC_PENDING_QUERY_KEY,
        }),
      ]);
      setIsFinishingSync(false);
      setSyncStatus(null);
    },
  });

  // An expired cache is reported by the initial opportunities request so the
  // UI can show this same progress modal used by the manual Refresh button.
  // Keep one automatic attempt per mounted app to avoid retry loops when auth
  // or the VPN is unavailable; the user can still click Refresh afterward.
  useEffect(() => {
    if (data) {
      autoSyncAttempted.current = false;
      return;
    }

    if (
      !autoSyncAttempted.current &&
      !isRefreshing &&
      opportunitiesError instanceof DataExpiredError
    ) {
      autoSyncAttempted.current = true;
      handleRefresh();
    }
  }, [data, handleRefresh, isRefreshing, opportunitiesError]);

  return (
    <SidebarProvider
      defaultOpen
      style={{ "--sidebar-width": "10.5rem" } as CSSProperties}
    >
      <AppSidebar
        punchListCount={punchListCount}
        blindSpotsCount={blindSpotsCount}
        isManager={isManager}
      />
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
      <DataSyncProgressDialog
        open={isRefreshing}
        finishing={isFinishingSync}
        status={syncStatus}
      />
    </SidebarProvider>
  );
}

export function DataSyncProgressDialog({
  open,
  finishing,
  status,
}: {
  open: boolean;
  finishing: boolean;
  status?: SnowflakeSyncRunStatus | null;
}) {
  const isFinalizing = finishing;

  return (
    <AlertDialog open={open}>
      <AlertDialogContent className="max-w-md border-zd-border bg-white p-6 text-zd-dark">
        <AlertDialogHeader>
          <AlertDialogTitle className="text-xl text-zd-dark">
            Syncing your data
          </AlertDialogTitle>
          <AlertDialogDescription className="text-zd-teal/70">
            {isFinalizing
              ? "Finishing the cache update. This may take a moment."
              : "Pulling the latest data from Snowflake."}
          </AlertDialogDescription>
        </AlertDialogHeader>

        <div className="space-y-3 pt-2">
          {SYNC_DOMAINS.map((domain) => {
            const current = status?.domains.find(
              (item) => item.domain === domain.name,
            );
            const state = finishing ? "succeeded" : (current?.status ?? "pending");
            return (
              <div key={domain.name} className="flex items-center gap-2 text-sm">
                  {state === "succeeded" ? (
                    <CheckCircle2 className="size-4 shrink-0 text-zd-green" />
                  ) : state === "failed" ? (
                    <XCircle className="size-4 shrink-0 text-red-600" />
                  ) : state === "running" ? (
                    <LoaderCircle className="size-4 shrink-0 animate-spin text-zd-teal" />
                  ) : (
                    <Circle className="size-4 shrink-0 text-zd-border" />
                  )}
                  <span className={state === "succeeded" ? "text-zd-green" : state === "failed" ? "text-red-600" : state === "running" ? "font-medium text-zd-dark" : "text-zd-teal/50"}>
                    {domain.label}
                  </span>
                  <span className="ml-auto text-xs capitalize text-zd-teal/60">
                    {state}
                  </span>
                </div>
            );
          })}
        </div>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function AppSidebar({
  punchListCount,
  blindSpotsCount,
  isManager,
}: {
  punchListCount: number;
  blindSpotsCount: number;
  isManager: boolean;
}) {
  const { state } = useSidebar();
  const pathname = useRouterState({
    select: (state) => state.location.pathname,
  });

  return (
    <Sidebar
      collapsible="icon"
      className="border-zd-dark/20 bg-zd-dark text-white [&_[data-sidebar=menu-button]]:text-white/80 [&_[data-sidebar=menu-button]:hover]:!text-white [&_[data-sidebar=menu-button]:hover>svg]:!text-white [&_[data-sidebar=menu-button][data-active=true]]:bg-white/10 [&_[data-sidebar=menu-button][data-active=true]]:text-zd-green [&_[data-sidebar=menu-sub-button]]:text-white/70 [&_[data-sidebar=menu-sub-button][data-active=true]]:bg-white/10 [&_[data-sidebar=menu-sub-button][data-active=true]]:text-zd-green [&_[data-sidebar=sidebar]]:bg-zd-dark [&_[data-sidebar=sidebar]]:text-white"
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

              {!isManager && (
                <SidebarMenuItem>
                  <SidebarMenuButton
                    asChild
                    isActive={pathname === "/blind-spots"}
                    tooltip="Blind Spots"
                  >
                    <Link to="/blind-spots">
                      <Glasses />
                      <span className="whitespace-nowrap">
                        Blind Spots
                        {blindSpotsCount > 0 ? ` (${blindSpotsCount})` : ""}
                      </span>
                      {blindSpotsCount > 0 && state === "collapsed" && (
                        <span
                          aria-hidden="true"
                          className="absolute bottom-1.5 right-1.5 size-2 rounded-full bg-red-500 ring-2 ring-zd-dark"
                        />
                      )}
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              )}

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
