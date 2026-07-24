// Shared constants for the "Punch List in SFDC" extension.
//
// Imported by the service worker (an ES module). The content script cannot use
// `import` when loaded via manifest content_scripts, so it inlines the same
// values — keep the two in sync (STORAGE_PREFIX, MSG_TYPE, OPP_URL_REGEX, TTL).

// chrome.storage.local key prefix; one entry per opportunity id.
export const STORAGE_PREFIX = "punchlist:";

// Message type the app (src/lib/sfdc.ts notifyExtension) sends.
export const MSG_TYPE = "PUNCHLIST_DATA";

// Origins allowed to push data (must also be in manifest externally_connectable).
export const ALLOWED_ORIGINS = [
  "http://localhost:3000",
  "http://localhost:8080",
];

// Salesforce Lightning Opportunity record URL: capture the 15/18-char id.
export const OPP_URL_REGEX =
  /\/lightning\/r\/Opportunity\/([a-zA-Z0-9]{15,18})\//;

// Drop stored reasons older than this so stale hygiene data doesn't linger.
export const TTL_MS = 12 * 60 * 60 * 1000; // 12h
