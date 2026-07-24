// Content script for zendesk.lightning.force.com. Detects Opportunity record
// pages (Lightning is a SPA, so the URL changes without full page loads),
// reads that opp's Punch List reasons from chrome.storage.local, and renders a
// small floating panel listing the criteria the opp met.
//
// NOTE: content scripts loaded via manifest can't use ES `import`, so the
// constants below mirror extension/src/common.js — keep them in sync.

const STORAGE_PREFIX = "punchlist:";
const OPP_URL_REGEX = /\/lightning\/r\/Opportunity\/([a-zA-Z0-9]{15,18})\//;
const HOST_ID = "punchlist-sfdc-panel-host";

const PANEL_CSS = `
  :host { all: initial; }
  .card {
    position: fixed;
    bottom: 20px;
    right: 20px;
    z-index: 2147483647;
    width: 320px;
    max-height: 60vh;
    overflow: auto;
    background: #fff;
    border: 1px solid #d8dcde;
    border-radius: 8px;
    box-shadow: 0 6px 24px rgba(0, 0, 0, 0.16);
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    color: #2f3941;
  }
  .header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    padding: 10px 12px;
    border-bottom: 1px solid #ededed;
    background: #f8f9f9;
    border-radius: 8px 8px 0 0;
  }
  .title { font-size: 12px; font-weight: 700; letter-spacing: 0.02em; }
  .count {
    font-size: 10px;
    font-weight: 700;
    color: #17494d;
    background: #d5f0e3;
    border-radius: 10px;
    padding: 1px 7px;
  }
  .close {
    border: none;
    background: none;
    cursor: pointer;
    font-size: 16px;
    line-height: 1;
    color: #68737d;
    padding: 0 2px;
  }
  .close:hover { color: #2f3941; }
  .body { padding: 12px; }
  .chips { display: flex; flex-wrap: wrap; gap: 6px; }
  .chip {
    display: inline-block;
    font-size: 10px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.03em;
    color: #49545c;
    background: #f8f9f9;
    border: 1px solid #d8dcde;
    border-radius: 4px;
    padding: 3px 7px;
  }
  .empty { font-size: 12px; color: #68737d; }
`;

let lastUrl = null;
let lastOppId = null;

function extractOppId(url) {
  const m = OPP_URL_REGEX.exec(url);
  return m ? m[1] : null;
}

function removePanel() {
  document.getElementById(HOST_ID)?.remove();
}

function ensureShadow() {
  let host = document.getElementById(HOST_ID);
  if (host && host.shadowRoot) return host.shadowRoot;
  removePanel();
  host = document.createElement("div");
  host.id = HOST_ID;
  const shadow = host.attachShadow({ mode: "open" });
  const style = document.createElement("style");
  style.textContent = PANEL_CSS;
  shadow.appendChild(style);
  document.body.appendChild(host);
  return shadow;
}

function renderPanel(reasons) {
  const shadow = ensureShadow();
  // Clear previous body (keep the <style>).
  shadow.querySelector(".card")?.remove();

  const card = document.createElement("div");
  card.className = "card";

  const header = document.createElement("div");
  header.className = "header";

  const title = document.createElement("span");
  title.className = "title";
  title.textContent = "Punch List — needs attention";

  const right = document.createElement("div");
  right.style.display = "flex";
  right.style.alignItems = "center";
  right.style.gap = "8px";

  if (reasons.length) {
    const count = document.createElement("span");
    count.className = "count";
    count.textContent = String(reasons.length);
    right.appendChild(count);
  }

  const close = document.createElement("button");
  close.className = "close";
  close.textContent = "×";
  close.title = "Dismiss";
  close.addEventListener("click", removePanel);
  right.appendChild(close);

  header.appendChild(title);
  header.appendChild(right);

  const body = document.createElement("div");
  body.className = "body";

  if (reasons.length) {
    const chips = document.createElement("div");
    chips.className = "chips";
    for (const reason of reasons) {
      const chip = document.createElement("span");
      chip.className = "chip";
      chip.textContent = reason;
      chips.appendChild(chip);
    }
    body.appendChild(chips);
  } else {
    const empty = document.createElement("div");
    empty.className = "empty";
    empty.textContent = "No open Punch List items for this opportunity.";
    body.appendChild(empty);
  }

  card.appendChild(header);
  card.appendChild(body);
  shadow.appendChild(card);
}

// Look up an opp's reasons and render/tear down the panel accordingly.
function update(oppId) {
  if (!oppId) {
    removePanel();
    return;
  }
  chrome.storage.local.get(STORAGE_PREFIX + oppId, (result) => {
    const entry = result[STORAGE_PREFIX + oppId];
    if (!entry) {
      // Opp opened outside the app (no pushed data) — stay silent, no noise.
      removePanel();
      return;
    }
    renderPanel(Array.isArray(entry.reasons) ? entry.reasons : []);
  });
}

function onUrlMaybeChanged() {
  const url = location.href;
  if (url === lastUrl) return;
  lastUrl = url;
  lastOppId = extractOppId(url);
  update(lastOppId);
}

// Lightning navigates without full page loads. Poll + popstate covers it.
setInterval(onUrlMaybeChanged, 500);
window.addEventListener("popstate", onUrlMaybeChanged);

// Data may arrive just after navigation (Open All race) — refresh on write.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local" || !lastOppId) return;
  if (Object.prototype.hasOwnProperty.call(changes, STORAGE_PREFIX + lastOppId)) {
    update(lastOppId);
  }
});

onUrlMaybeChanged();
