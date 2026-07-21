import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { AppNav } from "@/components/opportunities/AppNav";

async function fetchHealth() {
  const response = await fetch("/api/health", { credentials: "include" });
  if (!response.ok) throw new Error("Failed to fetch health");
  return response.json();
}

async function fetchStats() {
  const response = await fetch("/api/stats", { credentials: "include" });
  if (!response.ok) throw new Error("Failed to fetch stats");
  return response.json();
}

export const Route = createFileRoute("/admin")({
  head: () => ({
    meta: [
      { title: "Admin — KHARA" },
      { name: "description", content: "System health and statistics" },
    ],
  }),
  component: AdminPage,
});

function AdminPage() {
  const {
    data: health,
    isLoading: healthLoading,
    refetch: refetchHealth,
  } = useQuery({
    queryKey: ["snowflake-health"],
    queryFn: fetchHealth,
    refetchInterval: 30000, // Refresh every 30 seconds
  });

  const {
    data: stats,
    isLoading: statsLoading,
    refetch: refetchStats,
  } = useQuery({
    queryKey: ["table-stats"],
    queryFn: fetchStats,
    refetchInterval: 60000, // Refresh every minute
  });

  const isHealthy = health?.snowflake?.status === "connected";

  return (
    <div className="min-h-screen bg-zd-bg font-sans text-zd-dark">
      <AppNav />
      <main className="max-w-[1440px] mx-auto p-6 space-y-6">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold">System Admin</h1>
        </div>

        {/* Health Check Card */}
        <div className="bg-white border border-zd-border rounded-lg p-6 shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold">Snowflake Connection</h2>
            <button
              onClick={() => refetchHealth()}
              className="text-sm text-zd-teal hover:text-zd-dark transition-colors"
            >
              Refresh
            </button>
          </div>

          {healthLoading ? (
            <div className="text-sm text-zd-teal/50">
              Checking connection...
            </div>
          ) : (
            <div className="space-y-3">
              <div className="flex items-center gap-3">
                <div
                  className={`w-3 h-3 rounded-full ${
                    isHealthy ? "bg-green-500" : "bg-red-500"
                  }`}
                />
                <span className="font-semibold">
                  {isHealthy ? "Connected" : "Connection Failed"}
                </span>
              </div>

              {health?.snowflake?.serverUpdatedAt && (
                <div className="text-sm">
                  <span className="text-zd-teal/60">Server Updated:</span>{" "}
                  <code className="bg-zd-bg px-2 py-1 rounded">
                    {health.snowflake.serverUpdatedAt}
                  </code>
                </div>
              )}

              {health?.appUpdatedAt && (
                <div className="text-sm">
                  <span className="text-zd-teal/60">App Updated:</span>{" "}
                  <code className="bg-zd-bg px-2 py-1 rounded">
                    {new Date(health.appUpdatedAt).toLocaleString()}
                  </code>
                </div>
              )}

              {health?.timestamp && (
                <div className="text-sm">
                  <span className="text-zd-teal/60">Checked At:</span>{" "}
                  <code className="bg-zd-bg px-2 py-1 rounded">
                    {health.timestamp}
                  </code>
                </div>
              )}

              {health?.snowflake?.lastError && (
                <div className="text-sm text-red-600 bg-red-50 p-3 rounded">
                  <strong>Error:</strong> {health.snowflake.lastError}
                </div>
              )}

              <div className="text-sm">
                <span className="text-zd-teal/60">PostgreSQL:</span>{" "}
                <code className="bg-zd-bg px-2 py-1 rounded">
                  {health?.postgresql?.status ?? "unknown"}
                </code>
              </div>
            </div>
          )}
        </div>

        {/* Statistics Card */}
        <div className="bg-white border border-zd-border rounded-lg p-6 shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold">Database Statistics</h2>
            <button
              onClick={() => refetchStats()}
              className="text-sm text-zd-teal hover:text-zd-dark transition-colors"
            >
              Refresh
            </button>
          </div>

          {statsLoading ? (
            <div className="text-sm text-zd-teal/50">Loading statistics...</div>
          ) : stats ? (
            <div className="grid grid-cols-2 gap-4">
              <div className="bg-zd-bg/50 p-4 rounded">
                <div className="text-sm text-zd-teal/60 mb-1">
                  Total Opportunities
                </div>
                <div className="text-2xl font-bold">
                  {stats.totalOpportunities.toLocaleString()}
                </div>
              </div>
              <div className="bg-zd-bg/50 p-4 rounded">
                <div className="text-sm text-zd-teal/60 mb-1">
                  Pipeline Value
                </div>
                <div className="text-2xl font-bold">
                  ${(stats.totalPipelineValue / 1000000).toFixed(2)}M
                </div>
              </div>
              <div className="bg-zd-bg/50 p-4 rounded">
                <div className="text-sm text-zd-teal/60 mb-1">
                  Total Stages
                </div>
                <div className="text-2xl font-bold">{stats.totalStages}</div>
              </div>
              <div className="bg-zd-bg/50 p-4 rounded">
                <div className="text-sm text-zd-teal/60 mb-1">
                  Total Owners
                </div>
                <div className="text-2xl font-bold">{stats.totalOwners}</div>
              </div>
            </div>
          ) : (
            <div className="text-sm text-red-600">
              Failed to load statistics
            </div>
          )}
        </div>

        {/* Environment Info */}
        <div className="bg-white border border-zd-border rounded-lg p-6 shadow-sm">
          <h2 className="text-lg font-semibold mb-4">Environment</h2>
          <div className="space-y-2 text-sm font-mono">
            <div className="flex justify-between">
              <span className="text-zd-teal/60">Node ENV:</span>
              <span>{import.meta.env.MODE}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-zd-teal/60">Build Time:</span>
              <span>{new Date().toISOString()}</span>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
