import { fetchUserPreference } from "@/lib/api/user-preferences";
import type { Me } from "@/lib/api/me";
import type { OppScopeSettings } from "@/lib/fiscal-quarter";

export const MANAGER_SCOPE_GATE_QUERY_KEY = ["managerScopeGate"] as const;

// A manager needs first-time scope setup when they have no Sales Engineers
// configured — without them the first data sync has nothing meaningful to pull.
// Takes `me` from the shared ["me"] query rather than re-fetching it, so the
// gate doesn't add another /api/me round trip on mount.
export async function fetchManagerNeedsScopeSetup(
  me: Me | null,
): Promise<boolean> {
  if (!me?.isManager) return false;

  const savedScope =
    await fetchUserPreference<OppScopeSettings>("oppScopeSettings");
  return !savedScope?.scEmails?.length;
}
