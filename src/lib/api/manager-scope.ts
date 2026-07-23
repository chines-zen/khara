import { fetchUserPreference } from "@/lib/api/user-preferences";
import type { OppScopeSettings } from "@/lib/fiscal-quarter";

export const MANAGER_SCOPE_GATE_QUERY_KEY = ["managerScopeGate"] as const;

// A manager needs first-time scope setup when they have no Sales Engineers
// configured — without them the first data sync has nothing meaningful to pull.
export async function fetchManagerNeedsScopeSetup(): Promise<boolean> {
  const res = await fetch("/api/me", { credentials: "include" });
  if (!res.ok) return false;
  const me = await res.json().catch(() => null);
  if (!me?.isManager) return false;

  const savedScope =
    await fetchUserPreference<OppScopeSettings>("oppScopeSettings");
  return !savedScope?.scEmails?.length;
}
