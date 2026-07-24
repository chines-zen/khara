import {
  fetchUserPreference,
  saveUserPreference,
} from "@/lib/api/user-preferences";

// Persisted flag: set when a user changes scope-affecting settings (SE emails,
// ARR threshold, or close-date/fiscal-year) and cleared once they re-sync data.
// Stored as a user preference so the warning survives reloads until a real sync.
const PREFERENCE_KEY = "dataSyncPending";

export const DATA_SYNC_PENDING_QUERY_KEY = ["dataSyncPending"] as const;

export async function fetchDataSyncPending(): Promise<boolean> {
  const value = await fetchUserPreference<boolean>(PREFERENCE_KEY);
  return value === true;
}

export async function setDataSyncPending(pending: boolean): Promise<void> {
  await saveUserPreference(PREFERENCE_KEY, pending);
}
