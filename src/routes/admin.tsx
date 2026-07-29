import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
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

async function fetchAiBackend() {
  const response = await fetch("/api/config/ai-backend", {
    credentials: "include",
  });
  if (!response.ok) throw new Error("Failed to fetch AI backend");
  return response.json();
}

async function clearClaudeToken() {
  const response = await fetch("/api/config/claude-token", {
    method: "DELETE",
    credentials: "include",
  });
  if (!response.ok) throw new Error("Failed to clear token");
  return response.json();
}

const CLOSE_DATE_PRESET_LABELS: Record<string, string> = {
  current_quarter: "Current fiscal quarter",
  current_and_next_quarter: "Current + next fiscal quarter",
  fiscal_year: "Full fiscal year",
  custom: "Custom range",
};

type LastSyncScope = {
  arrThreshold?: number | null;
  closeDatePreset?: string | null;
  closeDateFrom?: string | null;
  closeDateTo?: string | null;
  scEmails?: string[] | null;
};

function formatArr(value?: number | null) {
  if (value == null) return "—";
  return `$${value.toLocaleString()}`;
}

function formatCloseWindow(scope: LastSyncScope) {
  const presetLabel = scope.closeDatePreset
    ? (CLOSE_DATE_PRESET_LABELS[scope.closeDatePreset] ?? scope.closeDatePreset)
    : null;
  const range =
    scope.closeDateFrom && scope.closeDateTo
      ? `${scope.closeDateFrom} → ${scope.closeDateTo}`
      : null;

  if (presetLabel && range) return `${presetLabel} (${range})`;
  return presetLabel ?? range ?? "—";
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
  const queryClient = useQueryClient();

  const { data: health, isLoading: healthLoading } = useQuery({
    queryKey: ["app-health"],
    queryFn: fetchHealth,
    refetchInterval: 30000, // Refresh every 30 seconds
  });

  const { data: stats, isLoading: statsLoading } = useQuery({
    queryKey: ["table-stats"],
    queryFn: fetchStats,
    refetchInterval: 60000, // Refresh every minute
  });

  // The AI Backend card exists for local dev only — its Clear Token button
  // writes to .env, which isn't present/writable in a real deployment. Gate the
  // whole thing (query + card) on devMode, which the health endpoint reports.
  const devMode = Boolean(health?.devMode);

  const aiBackendKey = ["ai-backend"];
  const { data: aiBackend, isLoading: aiBackendLoading } = useQuery({
    queryKey: aiBackendKey,
    queryFn: fetchAiBackend,
    enabled: devMode,
  });

  const clearToken = useMutation({
    mutationFn: clearClaudeToken,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: aiBackendKey });
      queryClient.invalidateQueries({ queryKey: ["app-health"] });
    },
  });

  const scope: LastSyncScope | null = health?.lastSyncScope ?? null;
  const scEmails = scope?.scEmails ?? [];
  const postgresConnected = stats?.postgresql?.status === "connected";

  return (
    <div className="min-h-screen bg-zd-bg font-sans text-zd-dark">
      <AppNav />
      <main className="max-w-[1440px] mx-auto p-6 space-y-6">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold">Diagnostics</h1>
        </div>

        {/* Snowflake Data Card */}
        <div className="bg-white border border-zd-border rounded-lg p-6 shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold">Snowflake Data</h2>
          </div>

          {healthLoading ? (
            <div className="text-sm text-zd-teal/50">Loading…</div>
          ) : (
            <div className="space-y-3">
              <div className="text-sm">
                <span className="text-zd-teal/60 font-semibold">Last Data Sync:</span>{" "}
                <code className="bg-zd-bg px-2 py-1 rounded">
                  {health?.appUpdatedAt
                    ? new Date(health.appUpdatedAt).toLocaleString()
                    : "Never synced"}
                </code>
                <p className="mt-2 text-xs text-zd-teal/60">
                  <i>Note: This reflects the last time the app logged into Snowflake
                  and doesn't reflect when SFDC data was replicated into
                  Snowflake.</i>
                </p>
              </div>

              {/* Scope of the latest successful sync */}
              <div className="border-t border-zd-border pt-3">
                <div className="text-sm text-zd-teal/60 font-semibold mb-2">
                  Sync Scope:
                </div>
                <dl className="grid grid-cols-1 sm:grid-cols-[140px_1fr] gap-x-4 gap-y-2 text-sm">
                  <dt className="text-zd-teal/60 font-semibold">SEs:</dt>
                  <dd>
                    {scEmails.length > 0 ? (
                      <div className="flex flex-wrap gap-1.5">
                        {scEmails.map((email) => (
                          <span
                            key={email}
                            className="bg-zd-bg px-2 py-0.5 rounded text-xs"
                          >
                            {email}
                          </span>
                        ))}
                      </div>
                    ) : (
                      <span className="text-zd-teal/60">Own opportunities</span>
                    )}
                  </dd>

                  <dt className="text-zd-teal/60 font-semibold">ARR Threshold:</dt>
                  <dd className="text-zd-teal/60">{formatArr(scope?.arrThreshold)}</dd>

                  <dt className="text-zd-teal/60 font-semibold">Close Date:</dt>
                  <dd className="text-zd-teal/60">{scope ? formatCloseWindow(scope) : "—"}</dd>
                </dl>
              </div>
            </div>
          )}
        </div>

        {/* Database Statistics Card (PostgreSQL) */}
        <div className="bg-white border border-zd-border rounded-lg p-6 shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-3">
              <h2 className="text-lg font-semibold">Database Statistics</h2>
              {stats && (
                <span className="flex items-center gap-1.5 text-sm">
                  <span
                    className={`w-2.5 h-2.5 rounded-full ${
                      postgresConnected ? "bg-green-500" : "bg-red-500"
                    }`}
                  />
                  <span className="text-zd-teal/60">
                    PostgreSQL{" "}
                    {postgresConnected ? "connected" : "disconnected"}
                  </span>
                </span>
              )}
            </div>
          </div>

          {statsLoading ? (
            <div className="text-sm text-zd-teal/50">Loading statistics...</div>
          ) : stats ? (
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              <div className="bg-zd-bg/50 p-4 rounded">
                <div className="text-sm text-zd-teal/60 mb-1">
                  Opportunities
                </div>
                <div className="text-2xl font-bold">
                  {(stats.totalOpportunities ?? 0).toLocaleString()}
                </div>
              </div>
              <div className="bg-zd-bg/50 p-4 rounded">
                <div className="text-sm text-zd-teal/60 mb-1">D-Scores</div>
                <div className="text-2xl font-bold">
                  {(stats.totalDScores ?? 0).toLocaleString()}
                </div>
              </div>
              <div className="bg-zd-bg/50 p-4 rounded">
                <div className="text-sm text-zd-teal/60 mb-1">Activities</div>
                <div className="text-2xl font-bold">
                  {(stats.totalActivities ?? 0).toLocaleString()}
                </div>
              </div>
              <div className="bg-zd-bg/50 p-4 rounded">
                <div className="text-sm text-zd-teal/60 mb-1">Summaries</div>
                <div className="text-2xl font-bold">
                  {(stats.totalSummaries ?? 0).toLocaleString()}
                </div>
              </div>
            </div>
          ) : (
            <div className="text-sm text-red-600">
              Failed to load statistics
            </div>
          )}
        </div>

        {/* AI Backend — local dev only (Clear Token writes to .env) */}
        {devMode && (
          <div className="bg-white border border-zd-border rounded-lg p-6 shadow-sm">
            <h2 className="text-lg font-semibold mb-4">AI Backend</h2>

            {aiBackendLoading ? (
              <div className="text-sm text-zd-teal/50">Loading…</div>
            ) : aiBackend ? (
              <div className="space-y-2 text-sm">
                <div className="flex justify-between gap-4">
                  <span className="text-zd-teal/60">Model:</span>
                  <span className="font-mono text-right">
                    {aiBackend.provider ?? aiBackend.model}
                    {aiBackend.provider && aiBackend.model ? (
                      <span className="text-zd-teal/60">
                        {" "}
                        — {aiBackend.model}
                      </span>
                    ) : null}
                  </span>
                </div>
                <div className="flex items-center justify-between gap-4">
                  <span className="text-zd-teal/60">Token:</span>
                  <span className="font-mono">
                    {aiBackend.tokenConfigured ? (
                      aiBackend.tokenPreview
                    ) : (
                      <span className="text-zd-teal/60">Not configured</span>
                    )}
                  </span>
                </div>
                {aiBackend.tokenConfigured && (
                  <div className="pt-2">
                    <button
                      onClick={() => clearToken.mutate()}
                      disabled={clearToken.isPending}
                      className="text-sm text-red-600 hover:text-red-700 transition-colors disabled:opacity-50"
                    >
                      {clearToken.isPending ? "Clearing…" : "Clear Token"}
                    </button>
                    {clearToken.isError && (
                      <span className="ml-3 text-sm text-red-600">
                        Failed to clear token
                      </span>
                    )}
                  </div>
                )}
              </div>
            ) : (
              <div className="text-sm text-red-600">
                Failed to load AI backend info
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
