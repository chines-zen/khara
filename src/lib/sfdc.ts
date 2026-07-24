export const sfRecordUrl = (id: string) =>
  `https://zendesk.lightning.force.com/lightning/r/Opportunity/${id}/view`;

/**
 * Push the current Punch List reasons to the "Punch List in SFDC" Chrome
 * extension so it can show, on the Salesforce record page, which criteria an
 * opportunity met. Keyed by SFDC opportunity id (`opp.id`).
 *
 * This is a fire-and-forget, no-op when the extension isn't installed:
 * `chrome.runtime` is only defined for this origin when the extension declares
 * it in `externally_connectable`, and VITE_PUNCHLIST_EXT_ID must be set to the
 * extension's id. See extension/README.md.
 */
export function notifyExtension(
  entries: { oppId: string; reasons: string[] }[],
): void {
  const extId = import.meta.env.VITE_PUNCHLIST_EXT_ID as string | undefined;
  if (!extId) return;

  const chromeApi = (
    globalThis as {
      chrome?: {
        runtime?: { sendMessage?: (id: string, msg: unknown) => void };
      };
    }
  ).chrome;
  const sendMessage = chromeApi?.runtime?.sendMessage;
  if (typeof sendMessage !== "function") return;

  try {
    sendMessage(extId, {
      type: "PUNCHLIST_DATA",
      ts: Date.now(),
      entries,
    });
  } catch {
    // Extension not installed / not accepting messages — expected, ignore.
  }
}
