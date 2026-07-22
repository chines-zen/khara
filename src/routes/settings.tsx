import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { AppNav } from "@/components/opportunities/AppNav";
import { PREFERRED_NAME_QUERY_KEY, TIMEZONE_QUERY_KEY } from "@/lib/preferences";
import {
  fetchUserPreference,
  saveUserPreference,
} from "@/lib/api/user-preferences";
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

  const [arrThreshold, setArrThreshold] = useState(String(DEFAULT_ARR_THRESHOLD));
  const [closeDatePreset, setCloseDatePreset] = useState<CloseDatePreset>(DEFAULT_CLOSE_DATE_PRESET);
  const [closeDateFrom, setCloseDateFrom] = useState(""); // only meaningful when closeDatePreset === "custom"
  const [closeDateTo, setCloseDateTo] = useState("");
  const [scopeSaved, setScopeSaved] = useState(false);
  const [isManager, setIsManager] = useState(false);
  const [scEmails, setScEmails] = useState<string[]>([]);
  const [scEmailInput, setScEmailInput] = useState("");
  // Starts true to avoid a flash of the setup banner before the fetch below
  // resolves; only flips to false if there's confirmed to be no saved scope.
  const [hasSavedScopeSettings, setHasSavedScopeSettings] = useState(true);

  const resolvedRange =
    closeDatePreset === "custom"
      ? { from: closeDateFrom, to: closeDateTo }
      : resolveCloseDateRange(closeDatePreset, null, null);

  const [punchListSettings, setPunchListSettings] = useState<PunchListSettings>(
    DEFAULT_PUNCH_LIST_SETTINGS,
  );
  const [punchListSaved, setPunchListSaved] = useState(false);

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
    fetchUserPreference<OppScopeSettings>("oppScopeSettings").then((savedScope) => {
      if (!savedScope) {
        setHasSavedScopeSettings(false);
        return;
      }
      setHasSavedScopeSettings(true);
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
    });
  }, []);

  useEffect(() => {
    fetch("/api/me", { credentials: "include" })
      .then((res) => (res.ok ? res.json() : null))
      .then((me) => setIsManager(Boolean(me?.isManager)))
      .catch(() => setIsManager(false));
  }, []);

  useEffect(() => {
    fetchUserPreference<PunchListSettings>("punchListSettings").then((saved) => {
      if (saved) setPunchListSettings({ ...DEFAULT_PUNCH_LIST_SETTINGS, ...saved });
    });
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    await saveUserPreference("preferredName", preferredName.trim());
    await saveUserPreference("dateFormat", dateFormat.trim());
    await saveUserPreference("timezone", timezone);
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
    setHasSavedScopeSettings(true);
    await fetch("/api/opportunities/my-sc-opps/cache", {
      method: "DELETE",
      credentials: "include",
    });
    queryClient.invalidateQueries({ queryKey: ["opportunities"] });
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

  const handlePunchListSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    await saveUserPreference("punchListSettings", punchListSettings);
    queryClient.invalidateQueries({ queryKey: ["punchListSettings"] });
    setPunchListSaved(true);
    setTimeout(() => setPunchListSaved(false), 2000);
  };

  return (
    <div className="min-h-screen bg-zd-bg font-sans text-zd-dark selection:bg-zd-green/20">
      <AppNav />
      <main className="max-w-[720px] mx-auto p-6 space-y-6">
        <h1 className="text-lg font-semibold text-zd-dark">Settings</h1>

        {!hasSavedScopeSettings && (
          <div className="bg-amber-50 border border-amber-300 text-amber-900 rounded px-4 py-3 text-sm">
            <span className="font-semibold">Set up your Opportunity Scope</span> — fill out
            and save the Opportunity Scope settings below before your first data sync.
          </div>
        )}

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

          <div>
            <label className="block text-[10px] font-bold text-zd-teal/60 uppercase tracking-wider mb-1">
              Timezone
            </label>
            <select
              value={timezone}
              onChange={(e) => setTimezone(e.target.value)}
              className="w-full bg-white border border-zd-border rounded px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-zd-green focus:border-zd-green"
            >
              {TIMEZONE_OPTIONS.some((option) => option.value === timezone) ? null : (
                <option value={timezone}>{timezone}</option>
              )}
              {TIMEZONE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
  
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
                  placeholder="sc@example.com"
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
              onChange={(e) => setCloseDatePreset(e.target.value as CloseDatePreset)}
              className="w-full bg-white border border-zd-border rounded px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-zd-green focus:border-zd-green mb-2"
            >
              <option value="current_quarter">Current Fiscal Quarter</option>
              <option value="current_and_next_quarter">Current + Next Fiscal Quarter</option>
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

        <form
          onSubmit={handlePunchListSubmit}
          className="bg-white border border-zd-border rounded p-6 space-y-5"
        >
          <h2 className="text-sm font-semibold text-zd-dark">Punch List Criteria</h2>
          <p className="text-[11px] text-zd-teal/70">
            Choose which criteria flag an opportunity on your Punch List.
          </p>

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
              <span>No SC notes</span>
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
              <span>No SC engagement type</span>
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
      </main>
    </div>
  );
}
