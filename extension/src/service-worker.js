// Service worker: receives Punch List data pushed from the (authenticated) app
// page and persists it to chrome.storage.local, keyed by opportunity id, for
// the content script to read on the matching Salesforce record page.

import {
  STORAGE_PREFIX,
  MSG_TYPE,
  ALLOWED_ORIGINS,
  TTL_MS,
} from "./common.js";

chrome.runtime.onMessageExternal.addListener((message, sender, sendResponse) => {
  // Only accept pushes from the app's known origins and message type.
  if (!sender.origin || !ALLOWED_ORIGINS.includes(sender.origin)) {
    sendResponse({ ok: false, error: "origin not allowed" });
    return;
  }
  if (!message || message.type !== MSG_TYPE || !Array.isArray(message.entries)) {
    sendResponse({ ok: false, error: "bad message" });
    return;
  }

  const ts = typeof message.ts === "number" ? message.ts : Date.now();
  const toStore = {};
  for (const entry of message.entries) {
    if (!entry || typeof entry.oppId !== "string") continue;
    const reasons = Array.isArray(entry.reasons) ? entry.reasons : [];
    toStore[STORAGE_PREFIX + entry.oppId] = { reasons, ts };
  }

  chrome.storage.local.set(toStore, () => {
    pruneExpired();
    sendResponse({ ok: true, stored: Object.keys(toStore).length });
  });

  // Keep the message channel open for the async sendResponse above.
  return true;
});

// Remove entries older than the TTL so a user never sees stale criteria.
function pruneExpired() {
  chrome.storage.local.get(null, (all) => {
    const now = Date.now();
    const stale = [];
    for (const [key, value] of Object.entries(all)) {
      if (!key.startsWith(STORAGE_PREFIX)) continue;
      if (!value || typeof value.ts !== "number" || now - value.ts > TTL_MS) {
        stale.push(key);
      }
    }
    if (stale.length) chrome.storage.local.remove(stale);
  });
}
