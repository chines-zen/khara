import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { Settings, RefreshCw } from "lucide-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { usePreferredName } from "@/lib/preferences";
import { fetchOpportunities } from "@/lib/api/sc-opportunities";

function formatLastRefreshed(iso: string | undefined) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "—";
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const min = String(d.getMinutes()).padStart(2, "0");
  return `${mm}/${dd} ${hh}:${min}`;
}

export function AppNav() {
  const linkBase = "px-3 py-1 text-xs font-medium";
  const preferredName = usePreferredName();
  const queryClient = useQueryClient();
  const [isRefreshing, setIsRefreshing] = useState(false);

  // Observes the shared ["opportunities"] cache populated by whichever page is mounted;
  // enabled: false means this never fetches on its own.
  const { data } = useQuery({
    queryKey: ["opportunities"],
    queryFn: fetchOpportunities,
    enabled: false,
  });
  const lastRefreshed = formatLastRefreshed(data?.metadata?.cachedAt);

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
    <nav className="h-12 bg-zd-dark flex items-center px-4 justify-between sticky top-0 z-50">
      <div className="flex items-center gap-6">
        <div className="h-6 px-1.5 bg-zd-green rounded-sm flex items-center justify-center font-bold text-zd-dark text-[9px] italic tracking-tight">
          KHARA
        </div>
        <div className="flex gap-1">
          <Link
            to="/opportunities"
            className={`${linkBase} text-white/70 hover:text-white`}
            activeProps={{ className: `${linkBase} text-white border-b-2 border-zd-green` }}
          >
            Opportunities
          </Link>
          <Link
            to="/"
            activeOptions={{ exact: true }}
            className={`${linkBase} text-white/70 hover:text-white`}
            activeProps={{ className: `${linkBase} text-white border-b-2 border-zd-green` }}
          >
            Dashboard
          </Link>
        </div>
      </div>
      <div className="flex items-center gap-3">
        <span className="text-white/50 text-[11px] font-mono" title="Last refreshed">
          {lastRefreshed}
        </span>
        <button
          type="button"
          onClick={handleRefresh}
          disabled={isRefreshing}
          aria-label="Refresh Data"
          title="Refresh Data"
          className="text-white/70 hover:text-white transition-colors disabled:opacity-50"
        >
          <RefreshCw className={`size-4 ${isRefreshing ? "animate-spin" : ""}`} />
        </button>
        <Link
          to="/settings"
          aria-label="Settings"
          className="text-white/70 hover:text-white transition-colors"
          activeProps={{ className: "text-zd-green" }}
        >
          <Settings className="size-4" />
        </Link>
        <span className="text-white/80 text-xs font-medium">
          {preferredName ? `Hi, ${preferredName}!` : "Hi there!"}
        </span>

      </div>
    </nav>
  );
}
