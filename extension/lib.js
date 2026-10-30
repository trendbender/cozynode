// Shared helpers for the service worker and the popup.

// Host used for the "where am I" check; always routed through the proxy.
export const CHECK_URL = "https://www.cloudflare.com/cdn-cgi/trace";
export const CHECK_HOST = "www.cloudflare.com";

export const DEFAULTS = {
  server: null, // {host, port, username, password, name}
  enabled: false,
  mode: "all", // "all" | "sites"
  sites: [],
  lastError: "",
};

// Accepts cozy://user:pass@host:port#name and https://user:pass@host:port
export function parseLink(raw) {
  const text = String(raw || "").trim();
  const m = text.match(/^(cozy|https):\/\/([^:@\/\s]+):([^@\/\s]+)@(\[[0-9a-fA-F:]+\]|[^:\/\s#?]+):(\d{1,5})\/?(?:#(.*))?$/);
  if (!m) return null;
  const port = Number(m[5]);
  if (port < 1 || port > 65535) return null;
  const host = m[4].replace(/^\[|\]$/g, "");
  return {
    username: decodeURIComponent(m[2]),
    password: decodeURIComponent(m[3]),
    host,
    port,
    name: m[6] ? decodeURIComponent(m[6]) : host,
  };
}

// "https://www.example.com/x" | "example.com" -> "example.com"
export function normalizeSite(input) {
  let s = String(input || "").trim().toLowerCase();
  if (!s) return "";
  try {
    if (s.includes("://")) s = new URL(s).hostname;
  } catch {
    return "";
  }
  s = s.replace(/^\*\./, "").replace(/^www\./, "").replace(/\/.*$/, "").replace(/:\d+$/, "");
  return /^[a-z0-9.-]+\.[a-z0-9-]{2,}$/.test(s) ? s : "";
}

function proxyHost(server) {
  return server.host.includes(":") ? `[${server.host}]` : server.host;
}

const LOCAL_BYPASS = ["<local>", "localhost", "127.0.0.1", "::1", "10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16"];

export function buildProxyConfig(state) {
  const { server, mode, sites } = state;
  if (mode === "sites") {
    const list = JSON.stringify([...new Set([...sites, CHECK_HOST])]);
    const target = `HTTPS ${proxyHost(server)}:${server.port}`;
    const pac = `var SITES = ${list};
function FindProxyForURL(url, host) {
  host = host.toLowerCase();
  for (var i = 0; i < SITES.length; i++) {
    var d = SITES[i];
    if (host === d || dnsDomainIs(host, "." + d)) return "${target}";
  }
  return "DIRECT";
}`;
    return { mode: "pac_script", pacScript: { data: pac, mandatory: true } };
  }
  return {
    mode: "fixed_servers",
    rules: {
      singleProxy: { scheme: "https", host: server.host, port: server.port },
      bypassList: LOCAL_BYPASS,
    },
  };
}

export async function getState() {
  const s = await chrome.storage.local.get(DEFAULTS);
  return { ...DEFAULTS, ...s };
}
