import { useEffect, useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { Settings, RefreshCw } from "lucide-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { usePreferredName, useTimezone } from "@/lib/preferences";
import { fetchOpportunities } from "@/lib/api/sc-opportunities";
import { fetchHiddenOpportunities } from "@/lib/api/hidden-opportunities";
import { fetchUserPreference } from "@/lib/api/user-preferences";
import {
  buildPunchList,
  DEFAULT_PUNCH_LIST_SETTINGS,
  type PunchListSettings,
} from "@/lib/punch-list";

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
  const queryClient = useQueryClient();
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [punchListSettings, setPunchListSettings] = useState<PunchListSettings>(
    DEFAULT_PUNCH_LIST_SETTINGS,
  );

  useEffect(() => {
    fetchUserPreference<PunchListSettings>("punchListSettings").then((saved) => {
      if (saved) setPunchListSettings({ ...DEFAULT_PUNCH_LIST_SETTINGS, ...saved });
    });
  }, []);

  // Observes the shared ["opportunities"] cache populated by whichever page is mounted;
  // enabled: false means this never fetches on its own.
  const { data } = useQuery({
    queryKey: ["opportunities"],
    queryFn: fetchOpportunities,
    enabled: false,
  });
  const lastRefreshed = formatLastRefreshed(data?.metadata?.cachedAt, timezone);

  const { data: hiddenIds = [] } = useQuery({
    queryKey: ["hiddenOpportunities"],
    queryFn: fetchHiddenOpportunities,
  });

  const punchListCount = useMemo(
    () => buildPunchList(data?.opportunities ?? [], hiddenIds, punchListSettings).length,
    [data?.opportunities, hiddenIds, punchListSettings],
  );

  const handleRefresh = async () => {
    setIsRefreshing(true);
    try {
      await fetch("/api/opportunities/my-sc-opps/cache", {
        method: "DELETE",
        credentials: "include",
      });
      await queryClient.refetchQueries({ queryKey: ["opportunities"] });
    } finally {
      setIsRefreshing(false);
    }
  };

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
            activeProps={{ className: `${linkBase} text-white border-b-2 border-zd-green` }}
          >
            Dashboard
          </Link>
          <Link
            to="/opportunities"
            className={`${linkBase} text-white/70 hover:text-white`}
            activeProps={{ className: `${linkBase} text-white border-b-2 border-zd-green` }}
          >
            Opportunities
          </Link>
          <Link
            to="/punch-list"
            className={`${linkBase} text-white/70 hover:text-white`}
            activeProps={{ className: `${linkBase} text-white border-b-2 border-zd-green` }}
          >
            Punch List{punchListCount > 0 ? ` (${punchListCount})` : ""}
          </Link>
        </div>
      </div>
      <div className="flex items-center gap-[15px]">
        <span
          className="text-white/50 text-[12px] font-mono leading-tight flex flex-col items-end"
          title="Last refreshed"
        >
          <span>Last Data Sync</span>
          <span>{lastRefreshed}</span>
        </span>
        <button
          type="button"
          onClick={handleRefresh}
          disabled={isRefreshing}
          aria-label="Refresh Data"
          title="Refresh Data"
          className="text-white/70 hover:text-white transition-colors disabled:opacity-50"
        >
          <RefreshCw className={`size-5 ${isRefreshing ? "animate-spin" : ""}`} />
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
