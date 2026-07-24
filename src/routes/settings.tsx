import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { AppNav } from "@/components/opportunities/AppNav";
import { useDoNotClickActive } from "@/hooks/use-do-not-click-active";
import {
  PREFERRED_NAME_QUERY_KEY,
  TIMEZONE_QUERY_KEY,
} from "@/lib/preferences";
import {
  fetchUserPreference,
  saveUserPreference,
} from "@/lib/api/user-preferences";
import { MANAGER_SCOPE_GATE_QUERY_KEY } from "@/lib/api/manager-scope";
import {
  DATA_SYNC_PENDING_QUERY_KEY,
  setDataSyncPending,
} from "@/lib/api/data-sync-pending";
import {
  DEFAULT_ARR_THRESHOLD,
  DEFAULT_CLOSE_DATE_PRESET,
  resolveCloseDatePreset,
  resolveCloseDateRange,
  type CloseDatePreset,
  type OppScopeSettings,
} from "@/lib/fiscal-quarter";
import {
  DEFAULT_PUNCH_LIST_SETTINGS,
  type PunchListSettings,
} from "@/lib/punch-list";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

const CURIOUS_CLICKERS_ENDPOINT =
  "https://6a61156cda10c59c180960b2.mockapi.io/curiousClickers";

const TIMEZONE_OPTIONS = [
  { value: "America/Los_Angeles", label: "Pacific Time (US & Canada)" },
  { value: "America/Denver", label: "Mountain Time (US & Canada)" },
  { value: "America/Chicago", label: "Central Time (US & Canada)" },
  { value: "America/New_York", label: "Eastern Time (US & Canada)" },
  { value: "America/Sao_Paulo", label: "Brasilia" },
  { value: "UTC", label: "UTC" },
  { value: "Europe/London", label: "London" },
  { value: "Europe/Paris", label: "Paris, Berlin, Madrid" },
  { value: "Europe/Athens", label: "Athens, Helsinki" },
  { value: "Asia/Kolkata", label: "Mumbai, New Delhi" },
  { value: "Asia/Singapore", label: "Singapore" },
  { value: "Asia/Tokyo", label: "Tokyo, Seoul" },
  { value: "Australia/Sydney", label: "Sydney" },
];

const BROWSER_TIMEZONE = Intl.DateTimeFormat().resolvedOptions().timeZone;

// Stable string of the scope fields that affect which data gets synced: SE
// emails (order-insensitive), ARR threshold, and the close-date/fiscal-year
// selection. A change here means the cached data no longer matches settings.
function scopeSignature(settings: OppScopeSettings): string {
  return JSON.stringify({
    scEmails: [...(settings.scEmails ?? [])].sort(),
    arrThreshold: settings.arrThreshold,
    closeDatePreset: settings.closeDatePreset,
    closeDateFrom: settings.closeDateFrom ?? null,
    closeDateTo: settings.closeDateTo ?? null,
  });
}

export const Route = createFileRoute("/settings")({
  head: () => ({
    meta: [
      { title: "Settings — KHARA" },
      { name: "description", content: "Manage your personal preferences." },
    ],
  }),
  component: SettingsPage,
});

function SettingsPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [dateFormat, setDateFormat] = useState("mm/dd/yyyy");
  const [timezone, setTimezone] = useState(BROWSER_TIMEZONE);
  const [preferredName, setPreferredNameState] = useState("");
  const [saved, setSaved] = useState(false);

  const [arrThreshold, setArrThreshold] = useState(
    String(DEFAULT_ARR_THRESHOLD),
  );
  const [closeDatePreset, setCloseDatePreset] = useState<CloseDatePreset>(
    DEFAULT_CLOSE_DATE_PRESET,
  );
  const [closeDateFrom, setCloseDateFrom] = useState(""); // only meaningful when closeDatePreset === "custom"
  const [closeDateTo, setCloseDateTo] = useState("");
  const [scopeSaved, setScopeSaved] = useState(false);
  const [isManager, setIsManager] = useState(false);
  const [scEmails, setScEmails] = useState<string[]>([]);
  const [scEmailInput, setScEmailInput] = useState("");
  // Signature of the scope fields (SE emails, ARR, close-date preset) as last
  // saved, so a save that changes any of them can flag data as needing a re-sync.
  const [savedScopeSignature, setSavedScopeSignature] = useState<string | null>(
    null,
  );

  const resolvedRange =
    closeDatePreset === "custom"
      ? { from: closeDateFrom, to: closeDateTo }
      : resolveCloseDateRange(closeDatePreset, null, null);

  const [punchListSettings, setPunchListSettings] = useState<PunchListSettings>(
    DEFAULT_PUNCH_LIST_SETTINGS,
  );
  const [punchListSaved, setPunchListSaved] = useState(false);
  const [showAdvancedSettings, setShowAdvancedSettings] = useState(false);
  const [userEmail, setUserEmail] = useState("");
  const [userName, setUserName] = useState("");
  const [showHallOfShame, setShowHallOfShame] = useState(false);
  const doNotClickActive = useDoNotClickActive();

  useEffect(() => {
    fetchUserPreference<string>("preferredName").then((savedName) => {
      if (savedName) setPreferredNameState(savedName);
    });
    fetchUserPreference<string>("dateFormat").then((savedFormat) => {
      if (savedFormat) setDateFormat(savedFormat);
    });
    fetchUserPreference<string>("timezone").then((savedTimezone) => {
      if (savedTimezone) setTimezone(savedTimezone);
    });
  }, []);

  useEffect(() => {
    fetchUserPreference<OppScopeSettings>("oppScopeSettings").then(
      (savedScope) => {
        if (!savedScope) {
          return;
        }
        setArrThreshold(String(savedScope.arrThreshold));

        const preset = resolveCloseDatePreset(savedScope);
        setCloseDatePreset(preset);
        if (preset === "custom") {
          setCloseDateFrom(savedScope.closeDateFrom ?? "");
          setCloseDateTo(savedScope.closeDateTo ?? "");
        }

        if (savedScope.scEmails) {
          setScEmails(savedScope.scEmails);
        }

        setSavedScopeSignature(scopeSignature(savedScope));
      },
    );
  }, []);

  useEffect(() => {
    fetch("/api/me", { credentials: "include" })
      .then((res) => (res.ok ? res.json() : null))
      .then((me) => {
        setIsManager(Boolean(me?.isManager));
        setUserEmail(me?.email ?? "");
        setUserName(me?.name ?? "");
      })
      .catch(() => setIsManager(false));
  }, []);

  useEffect(() => {
    if (showAdvancedSettings) {
      window.scrollTo({ top: document.body.scrollHeight, behavior: "smooth" });
    }
  }, [showAdvancedSettings]);

  useEffect(() => {
    fetchUserPreference<PunchListSettings>("punchListSettings").then(
      (saved) => {
        if (saved)
          setPunchListSettings({ ...DEFAULT_PUNCH_LIST_SETTINGS, ...saved });
      },
    );
  }, []);

  // If the scope fields changed since they were last saved, flag that cached
  // data no longer matches settings (shows the re-sync warning in the NavBar).
  // Also updates the baseline so a second save with the same values won't re-flag.
  const flagResyncIfScopeChanged = async (settings: OppScopeSettings) => {
    const nextSignature = scopeSignature(settings);
    if (savedScopeSignature !== null && nextSignature !== savedScopeSignature) {
      await setDataSyncPending(true);
      queryClient.invalidateQueries({ queryKey: DATA_SYNC_PENDING_QUERY_KEY });
    }
    setSavedScopeSignature(nextSignature);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    await saveUserPreference("preferredName", preferredName.trim());
    await saveUserPreference("dateFormat", dateFormat.trim());
    await saveUserPreference("timezone", timezone);
    if (isManager) {
      const settings: OppScopeSettings = {
        arrThreshold: Number(arrThreshold) || DEFAULT_ARR_THRESHOLD,
        closeDatePreset,
        closeDateFrom: closeDatePreset === "custom" ? closeDateFrom : null,
        closeDateTo: closeDatePreset === "custom" ? closeDateTo : null,
        scEmails,
      };
      await saveUserPreference("oppScopeSettings", settings);
      await flagResyncIfScopeChanged(settings);
      await fetch("/api/opportunities/my-sc-opps/cache", {
        method: "DELETE",
        credentials: "include",
      });
      queryClient.invalidateQueries({ queryKey: ["opportunities"] });
      queryClient.invalidateQueries({ queryKey: MANAGER_SCOPE_GATE_QUERY_KEY });
    }
    queryClient.invalidateQueries({ queryKey: PREFERRED_NAME_QUERY_KEY });
    queryClient.invalidateQueries({ queryKey: TIMEZONE_QUERY_KEY });
    setSaved(true);
    setTimeout(() => {
      router.history.back();
    }, 250);
  };

  const handleScopeSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const settings: OppScopeSettings = {
      arrThreshold: Number(arrThreshold) || DEFAULT_ARR_THRESHOLD,
      closeDatePreset,
      closeDateFrom: closeDatePreset === "custom" ? closeDateFrom : null,
      closeDateTo: closeDatePreset === "custom" ? closeDateTo : null,
      scEmails: isManager ? scEmails : [],
    };
    await saveUserPreference("oppScopeSettings", settings);
    await flagResyncIfScopeChanged(settings);
    await fetch("/api/opportunities/my-sc-opps/cache", {
      method: "DELETE",
      credentials: "include",
    });
    queryClient.invalidateQueries({ queryKey: ["opportunities"] });
    queryClient.invalidateQueries({ queryKey: MANAGER_SCOPE_GATE_QUERY_KEY });
    setScopeSaved(true);
    setTimeout(() => setScopeSaved(false), 2000);
  };

  const addScEmail = () => {
    const email = scEmailInput.trim();
    if (!email || scEmails.includes(email)) {
      setScEmailInput("");
      return;
    }
    setScEmails([...scEmails, email]);
    setScEmailInput("");
  };

  const removeScEmail = (email: string) => {
    setScEmails(scEmails.filter((e) => e !== email));
  };

  const handleCuriousClick = () => {
    setShowHallOfShame(true);
    fetch(CURIOUS_CLICKERS_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: userName, email: userEmail }),
    }).catch(() => {});
  };

  const handlePunchListSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    await saveUserPreference("punchListSettings", punchListSettings);
    queryClient.invalidateQueries({ queryKey: ["punchListSettings"] });
    setPunchListSaved(true);
    setTimeout(() => setPunchListSaved(false), 2000);
  };

  const oppScopeForm = (
    <form
      onSubmit={handleScopeSubmit}
      className="bg-white border border-zd-border rounded p-6 space-y-5"
    >
      <div>
        <h2 className="text-sm font-semibold text-zd-dark">
          Opportunity Scope
        </h2>
        <p className="mt-1 text-[11px] text-zd-teal/70">
          Adjust the thresholds for opportunities pulled into the app. Data will
          need to be re-synced when changes are made.
        </p>
      </div>

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

        <select
          value={closeDatePreset}
          onChange={(e) =>
            setCloseDatePreset(e.target.value as CloseDatePreset)
          }
          className="w-full bg-white border border-zd-border rounded px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-zd-green focus:border-zd-green mb-2"
        >
          <option value="current_quarter">Current Fiscal Quarter</option>
          <option value="current_and_next_quarter">
            Current + Next Fiscal Quarter
          </option>
          <option value="fiscal_year">Fiscal Year</option>
          <option value="custom">Custom</option>
        </select>

        {closeDatePreset === "custom" ? (
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
        ) : (
          <p className="text-xs text-zd-teal/70">
            From {resolvedRange.from} to {resolvedRange.to}
          </p>
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
  );

  const punchListForm = (
    <form
      onSubmit={handlePunchListSubmit}
      className="bg-white border border-zd-border rounded p-6 space-y-5"
    >
      <div>
        <h2 className="text-sm font-semibold text-zd-dark">
          Punch List Criteria
        </h2>
        <p className="mt-1 text-[11px] text-zd-teal/70">
          Choose which criteria flag an opportunity on your Punch List.
        </p>
      </div>

      <div className="space-y-3">
        <label className="flex items-center gap-2 text-sm cursor-pointer">
          <input
            type="checkbox"
            checked={punchListSettings.staleNotesEnabled}
            onChange={(e) =>
              setPunchListSettings({
                ...punchListSettings,
                staleNotesEnabled: e.target.checked,
              })
            }
            className="w-3.5 h-3.5 cursor-pointer"
          />
          <span>Notes not updated in</span>
          <input
            type="number"
            min={1}
            value={punchListSettings.staleNotesDays}
            onChange={(e) =>
              setPunchListSettings({
                ...punchListSettings,
                staleNotesDays: Number(e.target.value) || 1,
              })
            }
            className="w-16 bg-white border border-zd-border rounded px-2 py-1 text-sm font-mono focus:outline-none focus:ring-1 focus:ring-zd-green focus:border-zd-green"
          />
          <span>+ days</span>
        </label>

        <label className="flex items-center gap-2 text-sm cursor-pointer">
          <input
            type="checkbox"
            checked={punchListSettings.noScNotesEnabled}
            onChange={(e) =>
              setPunchListSettings({
                ...punchListSettings,
                noScNotesEnabled: e.target.checked,
              })
            }
            className="w-3.5 h-3.5 cursor-pointer"
          />
          <span>No SE notes</span>
        </label>

        <label className="flex items-center gap-2 text-sm cursor-pointer">
          <input
            type="checkbox"
            checked={punchListSettings.noEngagementTypeEnabled}
            onChange={(e) =>
              setPunchListSettings({
                ...punchListSettings,
                noEngagementTypeEnabled: e.target.checked,
              })
            }
            className="w-3.5 h-3.5 cursor-pointer"
          />
          <span>No SE engagement type</span>
        </label>

        <label className="flex items-center gap-2 text-sm cursor-pointer">
          <input
            type="checkbox"
            checked={punchListSettings.staleDScoreEnabled}
            onChange={(e) =>
              setPunchListSettings({
                ...punchListSettings,
                staleDScoreEnabled: e.target.checked,
              })
            }
            className="w-3.5 h-3.5 cursor-pointer"
          />
          <span>D-Score not updated in</span>
          <input
            type="number"
            min={1}
            value={punchListSettings.staleDScoreDays}
            onChange={(e) =>
              setPunchListSettings({
                ...punchListSettings,
                staleDScoreDays: Number(e.target.value) || 1,
              })
            }
            className="w-16 bg-white border border-zd-border rounded px-2 py-1 text-sm font-mono focus:outline-none focus:ring-1 focus:ring-zd-green focus:border-zd-green"
          />
          <span>+ days</span>
        </label>

        <label className="flex items-center gap-2 text-sm cursor-pointer">
          <input
            type="checkbox"
            checked={punchListSettings.dScoreBelowEnabled}
            onChange={(e) =>
              setPunchListSettings({
                ...punchListSettings,
                dScoreBelowEnabled: e.target.checked,
              })
            }
            className="w-3.5 h-3.5 cursor-pointer"
          />
          <span>D-Score is below</span>
          <input
            type="number"
            min={0}
            max={100}
            value={punchListSettings.dScoreBelowThreshold}
            onChange={(e) =>
              setPunchListSettings({
                ...punchListSettings,
                dScoreBelowThreshold: Number(e.target.value) || 0,
              })
            }
            className="w-16 bg-white border border-zd-border rounded px-2 py-1 text-sm font-mono focus:outline-none focus:ring-1 focus:ring-zd-green focus:border-zd-green"
          />
        </label>

        <label className="flex items-center gap-2 text-sm cursor-pointer">
          <input
            type="checkbox"
            checked={punchListSettings.dScoreAboveEnabled}
            onChange={(e) =>
              setPunchListSettings({
                ...punchListSettings,
                dScoreAboveEnabled: e.target.checked,
              })
            }
            className="w-3.5 h-3.5 cursor-pointer"
          />
          <span>D-Score is above</span>
          <input
            type="number"
            min={0}
            max={100}
            value={punchListSettings.dScoreAboveThreshold}
            onChange={(e) =>
              setPunchListSettings({
                ...punchListSettings,
                dScoreAboveThreshold: Number(e.target.value) || 0,
              })
            }
            className="w-16 bg-white border border-zd-border rounded px-2 py-1 text-sm font-mono focus:outline-none focus:ring-1 focus:ring-zd-green focus:border-zd-green"
          />
        </label>

        <label className="flex items-center gap-2 text-sm cursor-pointer">
          <input
            type="checkbox"
            checked={punchListSettings.includeHiddenOpps}
            onChange={(e) =>
              setPunchListSettings({
                ...punchListSettings,
                includeHiddenOpps: e.target.checked,
              })
            }
            className="w-3.5 h-3.5 cursor-pointer"
          />
          <span>Include hidden opps</span>
        </label>

        <label className="flex items-center gap-2 text-sm cursor-pointer">
          <input
            type="checkbox"
            checked={punchListSettings.includeClosedOpps}
            onChange={(e) =>
              setPunchListSettings({
                ...punchListSettings,
                includeClosedOpps: e.target.checked,
              })
            }
            className="w-3.5 h-3.5 cursor-pointer"
          />
          <span>Show closed opps (Won/Lost)</span>
        </label>
      </div>

      <div className="pt-2 flex items-center justify-end gap-3">
        {punchListSaved && (
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
  );

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

          {!isManager && (
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
                Please enter the format you use when adding SC notes in
                Salesforce. This is necessary to accurately calculate update
                periods. <br />
                Example: mm/dd/yyyy, mm.dd.yy, etc
              </p>
            </div>
          )}

          <div>
            <label className="block text-[10px] font-bold text-zd-teal/60 uppercase tracking-wider mb-1">
              Timezone
            </label>
            <select
              value={timezone}
              onChange={(e) => setTimezone(e.target.value)}
              className="w-full bg-white border border-zd-border rounded px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-zd-green focus:border-zd-green"
            >
              {TIMEZONE_OPTIONS.some(
                (option) => option.value === timezone,
              ) ? null : (
                <option value={timezone}>{timezone}</option>
              )}
              {TIMEZONE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>

          {isManager && (
            <div>
              <label className="block text-[10px] font-bold text-zd-teal/60 uppercase tracking-wider mb-1">
                Sales Engineers
              </label>
              <div className="flex items-center gap-2">
                <input
                  type="email"
                  value={scEmailInput}
                  onChange={(e) => setScEmailInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === ",") {
                      e.preventDefault();
                      addScEmail();
                    }
                  }}
                  placeholder="awesome.se@zendesk.com"
                  className="flex-1 bg-white border border-zd-border rounded px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-zd-green focus:border-zd-green placeholder:text-zd-teal/40"
                />
                <button
                  type="button"
                  onClick={addScEmail}
                  disabled={!scEmailInput.trim()}
                  className="px-4 py-2 text-xs font-bold uppercase tracking-wider bg-zd-dark text-white rounded hover:opacity-90 transition-opacity disabled:opacity-50"
                >
                  Add
                </button>
              </div>
              {scEmails.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-2">
                  {scEmails.map((email) => (
                    <span
                      key={email}
                      className="inline-flex items-center gap-1.5 bg-zd-bg border border-zd-border rounded px-2 py-1 text-xs text-zd-dark"
                    >
                      {email}
                      <button
                        type="button"
                        onClick={() => removeScEmail(email)}
                        className="text-zd-teal/60 hover:text-zd-dark"
                      >
                        <X className="size-3" />
                      </button>
                    </span>
                  ))}
                </div>
              )}
              <p className="mt-2 text-[11px] text-zd-teal/70">
                Fetch opportunities for these SEs.
              </p>
            </div>
          )}

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

        {punchListForm}

        <div className="flex items-center justify-between">
          {doNotClickActive ? (
            <button
              type="button"
              onClick={handleCuriousClick}
              className="px-4 py-2 text-xs font-bold uppercase tracking-wider bg-red-600 text-white rounded hover:opacity-90 transition-opacity"
            >
              Do Not Click
            </button>
          ) : (
            <span />
          )}
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => router.navigate({ to: "/admin" })}
              className="px-4 py-2 text-xs font-bold uppercase tracking-wider bg-zd-dark text-white rounded hover:opacity-90 transition-opacity"
            >
              Diagnostics
            </button>
            <button
              type="button"
              onClick={() => setShowAdvancedSettings(!showAdvancedSettings)}
              className="px-4 py-2 text-xs font-bold uppercase tracking-wider bg-zd-green text-zd-dark rounded hover:opacity-90 transition-opacity"
            >
              Advanced Settings
            </button>
          </div>
        </div>

        {showAdvancedSettings && oppScopeForm}
      </main>

      <Dialog open={showHallOfShame} onOpenChange={setShowHallOfShame}>
        <DialogContent className="bg-white border-zd-border text-zd-dark sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-zd-dark">You dirty dog!</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-zd-dark">
            You are a curious one (which is probably why you are a great SE!),
            but you also have earned yourself a place on{" "}
            <a
              href="https://z3nchines.zendesk.com/hc/en-us/p/curious-clickers"
              target="_blank"
              rel="noopener noreferrer"
              className="text-zd-green underline hover:opacity-80"
            >
              Chad's hall of <span className="line-through">shame</span>{" "}
              curiosity
            </a>
            . Congrats!
          </p>
        </DialogContent>
      </Dialog>
    </div>
  );
}
