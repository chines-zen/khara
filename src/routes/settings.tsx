import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { AppNav } from "@/components/opportunities/AppNav";
import { PREFERRED_NAME_QUERY_KEY } from "@/lib/preferences";
import {
  fetchUserPreference,
  saveUserPreference,
} from "@/lib/api/user-preferences";
import { getDefaultCloseDateRange } from "@/lib/fiscal-quarter";
import {
  DEFAULT_ARR_THRESHOLD,
  type OppScopeSettings,
} from "@/components/opportunities/OppScopeOnboardingDialog";

export const Route = createFileRoute("/settings")({
  head: () => ({
    meta: [
      { title: "Settings — SE Opp Rigor" },
      { name: "description", content: "Manage your personal preferences." },
    ],
  }),
  component: SettingsPage,
});

function SettingsPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [dateFormat, setDateFormat] = useState("mm/dd/yyyy");
  const [preferredName, setPreferredNameState] = useState("");
  const [saved, setSaved] = useState(false);

  const recommendedRange = getDefaultCloseDateRange();
  const [arrThreshold, setArrThreshold] = useState(String(DEFAULT_ARR_THRESHOLD));
  const [useRecommendedRange, setUseRecommendedRange] = useState(true);
  const [closeDateFrom, setCloseDateFrom] = useState(recommendedRange.from);
  const [closeDateTo, setCloseDateTo] = useState(recommendedRange.to);
  const [scopeSaved, setScopeSaved] = useState(false);

  const [devMode, setDevMode] = useState(false);
  const [devEmail, setDevEmail] = useState("");
  const [devEmailSwitched, setDevEmailSwitched] = useState(false);

  useEffect(() => {
    fetchUserPreference<string>("preferredName").then((savedName) => {
      if (savedName) setPreferredNameState(savedName);
    });
    fetchUserPreference<string>("dateFormat").then((savedFormat) => {
      if (savedFormat) setDateFormat(savedFormat);
    });
  }, []);

  useEffect(() => {
    fetchUserPreference<OppScopeSettings>("oppScopeSettings").then((savedScope) => {
      if (!savedScope) return;
      setArrThreshold(String(savedScope.arrThreshold));
      if (savedScope.closeDateFrom && savedScope.closeDateTo) {
        setUseRecommendedRange(false);
        setCloseDateFrom(savedScope.closeDateFrom);
        setCloseDateTo(savedScope.closeDateTo);
      } else {
        setUseRecommendedRange(true);
      }
    });
  }, []);

  useEffect(() => {
    fetch("/api/health", { credentials: "include" })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => setDevMode(Boolean(data?.devMode)))
      .catch(() => setDevMode(false));
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    await saveUserPreference("preferredName", preferredName.trim());
    await saveUserPreference("dateFormat", dateFormat.trim());
    queryClient.invalidateQueries({ queryKey: PREFERRED_NAME_QUERY_KEY });
    setSaved(true);
    setTimeout(() => {
      router.history.back();
    }, 250);
  };

  const handleScopeSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const settings: OppScopeSettings = {
      arrThreshold: Number(arrThreshold) || DEFAULT_ARR_THRESHOLD,
      closeDateFrom: useRecommendedRange ? null : closeDateFrom,
      closeDateTo: useRecommendedRange ? null : closeDateTo,
    };
    await saveUserPreference("oppScopeSettings", settings);
    await fetch("/api/opportunities/my-sc-opps/cache", {
      method: "DELETE",
      credentials: "include",
    });
    queryClient.invalidateQueries({ queryKey: ["opportunities"] });
    setScopeSaved(true);
    setTimeout(() => setScopeSaved(false), 2000);
  };

  const handleDevEmailSwitch = async (e: React.FormEvent) => {
    e.preventDefault();
    await fetch("/api/dev/session-email", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ email: devEmail.trim() }),
    });
    queryClient.invalidateQueries({ queryKey: ["opportunities"] });
    setDevEmailSwitched(true);
    setTimeout(() => setDevEmailSwitched(false), 2000);
  };

  return (
    <div className="min-h-screen bg-zd-bg font-sans text-zd-dark selection:bg-zd-green/20">
      <AppNav />
      <main className="max-w-[720px] mx-auto p-6 space-y-6">
        <h1 className="text-lg font-semibold text-zd-dark">Settings</h1>

        <form
          onSubmit={handleSubmit}
          className="bg-white border border-zd-border rounded p-6 space-y-5"
        >
          <div>
            <label className="block text-[10px] font-bold text-zd-teal/60 uppercase tracking-wider mb-1">
              Preferred Name
            </label>
            <input
              type="text"
              value={preferredName}
              onChange={(e) => setPreferredNameState(e.target.value)}
              placeholder="How should we address you?"
              className="w-full bg-white border border-zd-border rounded px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-zd-green focus:border-zd-green placeholder:text-zd-teal/40"
            />
          </div>

          <div>
            <label className="block text-[10px] font-bold text-zd-teal/60 uppercase tracking-wider mb-1">
              Date Formatting
            </label>
            <input
              type="text"
              value={dateFormat}
              onChange={(e) => setDateFormat(e.target.value)}
              placeholder="e.g. mm/dd/yyyy"
              className="w-full bg-white border border-zd-border rounded px-3 py-2 text-sm font-mono focus:outline-none focus:ring-1 focus:ring-zd-green focus:border-zd-green placeholder:text-zd-teal/40"
            />
            <p className="mt-2 text-[11px] text-zd-teal/70">
              Please enter the format you use when adding SC notes in Salesforce. This is necessary to accurately calculate update periods. <br />Example: mm/dd/yyyy, mm.dd.yy, etc
            </p>
          </div>

          <div className="pt-2 flex items-center justify-end gap-3">
            {saved && (
              <span className="text-xs text-zd-green font-semibold">Saved</span>
            )}
            <button
              type="submit"
              className="px-4 py-2 text-xs font-bold uppercase tracking-wider bg-zd-green text-zd-dark rounded hover:opacity-90 transition-opacity"
            >
              Save
            </button>
          </div>
        </form>

        <form
          onSubmit={handleScopeSubmit}
          className="bg-white border border-zd-border rounded p-6 space-y-5"
        >
          <h2 className="text-sm font-semibold text-zd-dark">Opportunity Scope</h2>

          <div>
            <label className="block text-[10px] font-bold text-zd-teal/60 uppercase tracking-wider mb-1">
              ARR Minimum
            </label>
            <div className="flex items-center gap-1 max-w-[200px]">
              <span className="text-sm text-zd-teal/50">$</span>
              <input
                type="number"
                min={0}
                value={arrThreshold}
                onChange={(e) => setArrThreshold(e.target.value)}
                className="w-full bg-white border border-zd-border rounded px-3 py-2 text-sm font-mono focus:outline-none focus:ring-1 focus:ring-zd-green focus:border-zd-green"
              />
            </div>
          </div>

          <div>
            <label className="block text-[10px] font-bold text-zd-teal/60 uppercase tracking-wider mb-1">
              Close Date Range
            </label>

            <label className="flex items-center gap-2 text-sm cursor-pointer mb-2">
              <input
                type="checkbox"
                checked={useRecommendedRange}
                onChange={(e) => setUseRecommendedRange(e.target.checked)}
                className="w-3.5 h-3.5 cursor-pointer"
              />
              <span>
                Use recommended range ({recommendedRange.from} to {recommendedRange.to})
              </span>
            </label>

            {!useRecommendedRange && (
              <div className="flex items-center gap-2">
                <input
                  type="date"
                  value={closeDateFrom}
                  onChange={(e) => setCloseDateFrom(e.target.value)}
                  className="flex-1 bg-white border border-zd-border rounded px-3 py-2 text-sm font-mono focus:outline-none focus:ring-1 focus:ring-zd-green focus:border-zd-green"
                />
                <span className="text-zd-teal/50 text-xs">to</span>
                <input
                  type="date"
                  value={closeDateTo}
                  onChange={(e) => setCloseDateTo(e.target.value)}
                  className="flex-1 bg-white border border-zd-border rounded px-3 py-2 text-sm font-mono focus:outline-none focus:ring-1 focus:ring-zd-green focus:border-zd-green"
                />
              </div>
            )}
          </div>

          <div className="pt-2 flex items-center justify-end gap-3">
            {scopeSaved && (
              <span className="text-xs text-zd-green font-semibold">Saved</span>
            )}
            <button
              type="submit"
              className="px-4 py-2 text-xs font-bold uppercase tracking-wider bg-zd-green text-zd-dark rounded hover:opacity-90 transition-opacity"
            >
              Save
            </button>
          </div>
        </form>

        {devMode && (
          <form
            onSubmit={handleDevEmailSwitch}
            className="bg-white border border-amber-400 rounded p-6 space-y-3"
          >
            <h2 className="text-sm font-semibold text-zd-dark">
              Dev Mode: Switch Test Email
            </h2>
            <p className="text-[11px] text-zd-teal/70">
              Server is running with DEV_MODE=true. Enter an email to test as a
              different SC without real Pomerium auth — this is the email used
              to look up whose opportunities to pull.
            </p>
            <div className="flex items-center gap-2">
              <input
                type="email"
                value={devEmail}
                onChange={(e) => setDevEmail(e.target.value)}
                placeholder="sc@example.com"
                className="flex-1 bg-white border border-zd-border rounded px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-zd-green focus:border-zd-green placeholder:text-zd-teal/40"
              />
              <button
                type="submit"
                className="px-4 py-2 text-xs font-bold uppercase tracking-wider bg-zd-dark text-white rounded hover:opacity-90 transition-opacity"
              >
                Switch
              </button>
            </div>
            {devEmailSwitched && (
              <p className="text-xs text-zd-green font-semibold">
                Switched. Reload the Opportunities page to see the new scope.
              </p>
            )}
          </form>
        )}
      </main>
    </div>
  );
}
