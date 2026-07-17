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
  const min = String(d.getMinutes()).padStart(2, "0");
  const hours24 = d.getHours();
  const period = hours24 >= 12 ? "PM" : "AM";
  const hh = String(hours24 % 12 || 12).padStart(2, "0");
  return `${mm}/${dd} ${hh}:${min} ${period}`;
}

export function AppNav() {
  const linkBase = "px-[15px] py-[5px] text-[15px] font-medium";
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
    <nav className="h-[60px] bg-zd-dark flex items-center px-5 justify-between sticky top-0 z-50">
      <div className="flex items-center gap-[30px]">
        <div className="h-[30px] px-[7.5px] bg-zd-green rounded-sm flex items-center justify-center font-bold text-zd-dark text-[11px] italic tracking-tight">
          KHARA
        </div>
        <div className="flex gap-[5px]">
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
      <div className="flex items-center gap-[15px]">
        <span className="text-white/50 text-[14px] font-mono" title="Last refreshed">
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
