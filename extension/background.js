import { buildProxyConfig, getState } from "./lib.js";

// Proxy auth: answer only challenges from our own proxy, and give up after
// two attempts per request so a wrong password cannot loop forever.
const attempts = new Map();

chrome.webRequest.onAuthRequired.addListener(
  (details, callback) => {
    if (!details.isProxy) return callback({});
    getState().then((state) => {
      const s = state.server;
      if (!state.enabled || !s || details.challenger?.host !== s.host) return callback({});
      const n = (attempts.get(details.requestId) || 0) + 1;
      attempts.set(details.requestId, n);
      if (n > 2) {
        setError(chrome.i18n.getMessage("errAuth"));
        return callback({ cancel: true });
      }
      callback({ authCredentials: { username: s.username, password: s.password } });
    });
  },
  { urls: ["<all_urls>"] },
  ["asyncBlocking"]
);

const forget = (d) => attempts.delete(d.requestId);
chrome.webRequest.onCompleted.addListener(forget, { urls: ["<all_urls>"] });
chrome.webRequest.onErrorOccurred.addListener(forget, { urls: ["<all_urls>"] });

// Single failed requests (dead ad domains, closed ports) are normal behind a
// proxy, so they are only logged; the popup's connection check decides
// whether the server itself is down.
chrome.proxy.onProxyError.addListener((e) => console.debug("proxy error", e.error, e.details));

async function setError(msg) {
  await chrome.storage.local.set({ lastError: msg || "" });
  paint();
}

async function apply() {
  const state = await getState();
  const on = state.enabled && state.server;
  if (on) {
    await chrome.proxy.settings.set({ value: buildProxyConfig(state), scope: "regular" });
    // keep WebRTC from leaking the real IP while the proxy is on
    await chrome.privacy.network.webRTCIPHandlingPolicy.set({ value: "disable_non_proxied_udp" });
  } else {
    await chrome.proxy.settings.clear({ scope: "regular" });
    await chrome.privacy.network.webRTCIPHandlingPolicy.clear({});
  }
  await paint();
}

async function paint() {
  const state = await getState();
  const on = state.enabled && state.server;
  const icon = on ? "on" : "off";
  await chrome.action.setIcon({ path: { 16: `icons/${icon}16.png`, 32: `icons/${icon}32.png` } });
  const badge = state.lastError && on ? "!" : on && state.mode === "sites" ? "·" : "";
  await chrome.action.setBadgeText({ text: badge });
  await chrome.action.setBadgeBackgroundColor({ color: state.lastError ? "#d33" : "#2b8a5a" });
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;
  if (changes.enabled || changes.server || changes.mode || changes.sites) apply();
  else if (changes.lastError) paint();
});

chrome.runtime.onStartup.addListener(apply);
chrome.runtime.onInstalled.addListener(apply);
