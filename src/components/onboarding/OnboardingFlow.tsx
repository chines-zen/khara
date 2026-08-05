import * as React from "react";
import { useEffect, useMemo, useState } from "react";
import { Check, Plus, X } from "lucide-react";
import type { Me } from "@/lib/api/me";
import { DataSyncProgressDialog } from "@/components/opportunities/AppNav";
import {
  completeOnboarding,
  validateAndSaveOnboardingScope,
  type OnboardingEmailResult,
  type OnboardingScopeType,
} from "@/lib/api/onboarding";
import { syncSnowflakeData } from "@/lib/api/snowflake-data-sync";

type Props = {
  me: Me | null;
  emailSetup: boolean;
  onEmailSave: (email: string) => Promise<void>;
  onFinished: () => Promise<void>;
};

type Phase = "email" | "scope" | "sync";

export function OnboardingFlow({
  me,
  emailSetup,
  onEmailSave,
  onFinished,
}: Props) {
  const [phase, setPhase] = useState<Phase>(emailSetup ? "email" : "scope");
  const [email, setEmail] = useState("");
  const [scopeEmail, setScopeEmail] = useState("");
  const [scopeEmailError, setScopeEmailError] = useState<string | null>(null);
  const [emails, setEmails] = useState<string[]>([]);
  const [results, setResults] = useState<OnboardingEmailResult[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (emailSetup) setPhase("email");
    else if (me)
      setPhase((current) => (current === "email" ? "scope" : current));
  }, [emailSetup, me]);

  const scopeType: OnboardingScopeType = me?.isManager
    ? "se"
    : "blind-spot-owner";
  const scopeTitle = me?.isManager
    ? "Enter the emails of SEs on your team"
    : "Enter the emails of AEs you work with";
  const preferredName = me?.name?.trim().split(/\s+/)[0] || "there";
  const scopeDescription = me?.isManager
    ? "Hit enter after each email. We’ll check each person before your first sync."
    : "Hit enter after each email. We’ll use these AEs to find Blind Spots.";
  const scopeLabel = me?.isManager ? "SE email" : "AE email";

  const foundCount = useMemo(
    () => results.filter((result) => result.found).length,
    [results],
  );
  const canValidate = emails.length > 0 && !busy;
  const canSync = foundCount > 0 && results.length > 0 && !busy;

  const addEmail = () => {
    const next = scopeEmail.trim().toLowerCase();
    if (next.includes("@")) {
      setScopeEmailError(
        "Enter the handle only — you don't need to type @zendesk.com.",
      );
      return;
    }
    if (!next || emails.includes(`${next}@zendesk.com`)) {
      setScopeEmail("");
      setScopeEmailError(null);
      return;
    }
    setEmails((current) => [...current, `${next}@zendesk.com`]);
    setScopeEmail("");
    setScopeEmailError(null);
    setResults([]);
    setError(null);
  };

  const removeEmail = (emailToRemove: string) => {
    setEmails((current) => current.filter((email) => email !== emailToRemove));
    setResults((current) =>
      current.filter((result) => result.email !== emailToRemove),
    );
  };

  const handleEmailSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    const normalizedEmail = email.trim().toLowerCase();
    if (!/^[^@\s]+@zendesk\.com$/.test(normalizedEmail)) {
      setError("Please enter your Zendesk email to continue");
      return;
    }

    setBusy(true);
    setError(null);
    try {
      await onEmailSave(normalizedEmail);
      setPhase("scope");
    } catch (saveError) {
      setError(
        saveError instanceof Error
          ? saveError.message
          : "Failed to connect to Snowflake",
      );
    } finally {
      setBusy(false);
    }
  };

  const handleValidate = async () => {
    setBusy(true);
    setError(null);
    try {
      const response = await validateAndSaveOnboardingScope(scopeType, emails);
      setResults(response.results);
      if (response.savedEmails.length === 0) {
        setError(
          "No valid users were found. Correct the emails and try again.",
        );
      }
    } catch (validationError) {
      setError(
        validationError instanceof Error
          ? validationError.message
          : "Failed to validate emails",
      );
    } finally {
      setBusy(false);
    }
  };

  const handleSync = async () => {
    setBusy(true);
    setPhase("sync");
    setError(null);
    try {
      await syncSnowflakeData();
      await completeOnboarding();
      await onFinished();
    } catch (syncError) {
      setPhase("scope");
      setError(
        syncError instanceof Error
          ? syncError.message
          : "Initial data sync failed",
      );
    } finally {
      setBusy(false);
    }
  };

  if (phase === "sync") {
    return <DataSyncProgressDialog open finishing={false} />;
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-zd-dark/70 px-4">
      <div className="w-full max-w-lg rounded-lg border border-zd-border bg-white p-6 shadow-2xl">
        {phase === "email" && (
          <>
            <h1 className="text-xl font-semibold text-zd-dark">
              Welcome to KHARA
            </h1>
            <p className="mt-2 text-sm text-zd-teal/70">
              Enter your email below to get started.
              <br />
              You will need to be on the VPN to continue.
            </p>
            <form onSubmit={handleEmailSubmit} className="mt-6 space-y-4">
              <label className="block text-[10px] font-bold uppercase tracking-wider text-zd-teal/60">
                Email
                <input
                  autoFocus
                  required
                  type="email"
                  value={email}
                  onChange={(event) => {
                    setEmail(event.target.value);
                    setError(null);
                  }}
                  placeholder="you@zendesk.com"
                  className="mt-1 w-full rounded border border-zd-border px-3 py-2 text-sm text-zd-dark outline-none focus:border-zd-green focus:ring-1 focus:ring-zd-green"
                />
              </label>
              {busy && (
                <StatusLine>
                  Waiting for Snowflake sign-in in your browser…
                </StatusLine>
              )}
              {error && <ErrorLine>{error}</ErrorLine>}
              <div className="flex justify-end">
                <button
                  type="submit"
                  disabled={busy || !email.trim()}
                  className="rounded bg-zd-green px-4 py-2 text-xs font-bold uppercase tracking-wider text-zd-dark disabled:opacity-50"
                >
                  {busy ? "Connecting…" : "Continue"}
                </button>
              </div>
            </form>
          </>
        )}

        {phase === "scope" && (
          <>
            <p className="text-xl font-semibold text-zd-dark">
              Hi {preferredName}!
            </p>
            <h1 className="text-sm font-semibold text-zd-dark">{scopeTitle}</h1>
            <p className="mt-2 text-sm text-zd-teal/70">{scopeDescription}</p>
            <div className="mt-6 space-y-4">
              <label className="block text-[10px] font-bold uppercase tracking-wider text-zd-teal/60">
                {scopeLabel}
                <div className="mt-1 flex items-stretch gap-2">
                  <input
                    autoFocus
                    type="text"
                    value={scopeEmail}
                    onChange={(event) => {
                      const next = event.target.value;
                      setScopeEmail(next);
                      setScopeEmailError(
                        next.includes("@")
                          ? "Enter the handle only — you don't need to type @zendesk.com."
                          : null,
                      );
                    }}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.preventDefault();
                        addEmail();
                      }
                    }}
                    placeholder="name"
                    className="min-w-0 flex-1 rounded border border-zd-border px-3 py-2 text-sm text-zd-dark outline-none focus:border-zd-green focus:ring-1 focus:ring-zd-green"
                  />
                  <span className="flex items-center rounded border border-zd-border bg-zd-bg px-3 text-sm text-zd-teal/70">
                    @zendesk.com
                  </span>
                  <button
                    type="button"
                    onClick={addEmail}
                    className="rounded border border-zd-border px-3 text-zd-teal hover:border-zd-green hover:text-zd-dark"
                    aria-label="Add email"
                  >
                    <Plus className="size-4" />
                  </button>
                </div>
                {scopeEmailError && (
                  <div className="mt-1 text-xs text-red-600">
                    {scopeEmailError}
                  </div>
                )}
              </label>

              {emails.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {emails.map((chip) => (
                    <span
                      key={chip}
                      className="inline-flex items-center gap-1 rounded-full bg-zd-bg px-3 py-1 text-xs text-zd-dark"
                    >
                      {chip}
                      <button
                        type="button"
                        onClick={() => removeEmail(chip)}
                        aria-label={`Remove ${chip}`}
                      >
                        <X className="size-3 text-zd-teal/70" />
                      </button>
                    </span>
                  ))}
                </div>
              )}

              {results.length > 0 && (
                <div className="space-y-2 rounded border border-zd-border bg-zd-bg/40 p-3">
                  {results.map((result) => (
                    <div
                      key={result.email}
                      className="flex items-start gap-2 text-sm"
                    >
                      {result.found ? (
                        <Check className="mt-0.5 size-4 shrink-0 text-zd-green" />
                      ) : (
                        <X className="mt-0.5 size-4 shrink-0 text-red-600" />
                      )}
                      <div>
                        <div className="font-medium text-zd-dark">
                          {result.found ? result.fullName : "No user found"}
                        </div>
                        <div className="text-xs text-zd-teal/70">
                          {result.email}
                        </div>
                        {!result.found && (
                          <div className="mt-0.5 text-xs text-red-600">
                            This could be because the email was entered
                            incorrectly or the user has not yet been ingested
                            into Snowflake.
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {busy && <StatusLine>Checking Snowflake users…</StatusLine>}
              {phase === "scope" && error && <ErrorLine>{error}</ErrorLine>}
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={handleValidate}
                  disabled={!canValidate}
                  className="rounded border border-zd-border px-4 py-2 text-xs font-bold uppercase tracking-wider text-zd-dark disabled:opacity-50"
                >
                  {busy ? "Checking…" : "Done"}
                </button>
                {canSync && (
                  <button
                    type="button"
                    onClick={handleSync}
                    disabled={busy}
                    className="rounded bg-zd-green px-4 py-2 text-xs font-bold uppercase tracking-wider text-zd-dark disabled:opacity-50"
                  >
                    Run initial data sync
                  </button>
                )}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function StatusLine({ children }: { children: React.ReactNode }) {
  return <p className="text-xs text-zd-teal/70">{children}</p>;
}

function ErrorLine({ children }: { children: React.ReactNode }) {
  return <p className="text-xs text-red-600">{children}</p>;
}
