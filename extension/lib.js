// Shared helpers for the service worker and the popup.

// Host used for the "where am I" check; always routed through the proxy.
export const CHECK_URL = "https://www.cloudflare.com/cdn-cgi/trace";
export const CHECK_HOST = "www.cloudflare.com";

export const DEFAULTS = {
  servers: [], // [{id, host, port, username, password, name}]
  activeId: "",
  server: null, // 0.1.x single server, migrated into servers on read
  enabled: false,
  mode: "all", // "all" | "sites"
  sites: [],
  siteServer: {}, // {"example.com": serverId | DIRECT}; a missing entry means the active server
  lastError: "",
};

export const DIRECT = "direct";

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
const LOCAL_NETS = [["127.0.0.0", "255.0.0.0"], ["10.0.0.0", "255.0.0.0"], ["172.16.0.0", "255.240.0.0"], ["192.168.0.0", "255.255.0.0"]];

const target = (server) => `HTTPS ${proxyHost(server)}:${server.port}`;

// PAC result for every listed site: its own server, DIRECT, or the active server.
export function siteRoutes(state) {
  const routes = {};
  for (const site of state.sites) {
    const pick = state.siteServer[site];
    const server = state.servers.find((v) => v.id === pick) || state.server;
    routes[site] = pick === DIRECT ? "DIRECT" : target(server);
  }
  return routes;
}

export function buildProxyConfig(state) {
  const { server, mode } = state;
  const routes = siteRoutes(state);
  const fallback = mode === "sites" ? "DIRECT" : target(server);
  if (mode !== "sites" && Object.values(routes).every((r) => r === fallback)) {
    return {
      mode: "fixed_servers",
      rules: {
        singleProxy: { scheme: "https", host: server.host, port: server.port },
        bypassList: LOCAL_BYPASS,
      },
    };
  }
  // The most specific listed domain wins: a.example.com before example.com.
  const pac = `var CHECK = ${JSON.stringify(CHECK_HOST)}, ACTIVE = ${JSON.stringify(target(server))};
var ROUTES = ${JSON.stringify(routes)}, FALLBACK = ${JSON.stringify(fallback)};
var LOCAL = ${JSON.stringify(LOCAL_NETS)};
function FindProxyForURL(url, host) {
  host = host.toLowerCase();
  if (host === CHECK) return ACTIVE;
  for (var d = host; d; d = d.indexOf(".") < 0 ? "" : d.slice(d.indexOf(".") + 1)) {
    if (Object.prototype.hasOwnProperty.call(ROUTES, d)) return ROUTES[d];
  }
  if (FALLBACK === "DIRECT" || isPlainHostName(host) || host === "localhost" || host === "::1") return "DIRECT";
  if (/^\\d+\\.\\d+\\.\\d+\\.\\d+$/.test(host)) {
    for (var i = 0; i < LOCAL.length; i++) if (isInNet(host, LOCAL[i][0], LOCAL[i][1])) return "DIRECT";
  }
  return FALLBACK;
}`;
  return { mode: "pac_script", pacScript: { data: pac, mandatory: true } };
}

export const serverId = (s) => `${s.username}@${s.host}:${s.port}`;

// True when another extension (a second CozyNode, FoxyProxy...) holds Chrome's proxy setting.
export async function proxyConflict() {
  const { levelOfControl } = await chrome.proxy.settings.get({});
  return levelOfControl === "controlled_by_other_extensions";
}

// state.server is the active entry of state.servers (null when there is none)
export async function getState() {
  const s = { ...DEFAULTS, ...(await chrome.storage.local.get(DEFAULTS)) };
  if (s.server && !s.servers.length) {
    const migrated = { ...s.server, id: serverId(s.server) };
    s.servers = [migrated];
    s.activeId = migrated.id;
    await chrome.storage.local.set({ servers: s.servers, activeId: s.activeId, server: null });
  }
  s.server = s.servers.find((v) => v.id === s.activeId) || s.servers[0] || null;
  return s;
}

// Adds a server or refreshes the same login on the same host, and makes it active.
export async function addServer(server) {
  const { servers } = await getState();
  const entry = { ...server, id: serverId(server) };
  const rest = servers.filter((v) => v.id !== entry.id);
  await chrome.storage.local.set({ servers: [...rest, entry], activeId: entry.id, enabled: true, lastError: "" });
}

export async function removeServer(id) {
  const { servers, activeId, enabled, siteServer } = await getState();
  const rest = servers.filter((v) => v.id !== id);
  const next = id === activeId ? rest[0]?.id || "" : activeId;
  const routes = Object.fromEntries(Object.entries(siteServer).filter(([, v]) => v !== id));
  await chrome.storage.local.set({ servers: rest, activeId: next, siteServer: routes, enabled: enabled && rest.length > 0, lastError: "" });
}

// Server that asked for proxy auth, matched by host and port; the active one wins a tie.
export function serverFor(state, challenger) {
  const host = String(challenger?.host || "").replace(/^\[|\]$/g, "");
  return [state.server, ...state.servers].find((v) => v && v.host === host && v.port === challenger?.port) || null;
}

// Exported settings are encrypted with a password: PBKDF2-SHA256 -> AES-GCM-256.
// Format: "cozynode-enc:v1:" + base64(salt[16] | iv[12] | ciphertext).
const ENC_PREFIX = "cozynode-enc:v1:";
const PBKDF2_ITERATIONS = 600000;

export const isEncrypted = (raw) => String(raw || "").trim().startsWith(ENC_PREFIX);

const toB64 = (bytes) => btoa(String.fromCharCode(...bytes));
const fromB64 = (text) => Uint8Array.from(atob(text), (c) => c.charCodeAt(0));

async function passwordKey(password, salt) {
  const base = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt, iterations: PBKDF2_ITERATIONS, hash: "SHA-256" },
    base,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

export async function encryptText(text, password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await passwordKey(password, salt);
  const data = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(text)));
  return ENC_PREFIX + toB64(new Uint8Array([...salt, ...iv, ...data]));
}

// Returns the text, or null for a wrong password or damaged input.
export async function decryptText(raw, password) {
  try {
    const bytes = fromB64(String(raw).trim().slice(ENC_PREFIX.length).replace(/\s+/g, ""));
    if (bytes.length < 16 + 12 + 16) return null;
    const key = await passwordKey(password, bytes.slice(0, 16));
    const data = await crypto.subtle.decrypt({ name: "AES-GCM", iv: bytes.slice(16, 28) }, key, bytes.slice(28));
    return new TextDecoder().decode(data);
  } catch {
    return null;
  }
}

// Settings moved between browsers as JSON text (encrypted by the popup); it holds the passwords.
const EXPORT_KEYS = ["servers", "activeId", "mode", "sites", "siteServer"];

export async function exportSettings() {
  const state = await getState();
  const out = { cozynode: 1 };
  for (const k of EXPORT_KEYS) out[k] = state[k];
  return JSON.stringify(out);
}

export function parseSettings(raw) {
  let d;
  try {
    d = JSON.parse(String(raw || "").trim());
  } catch {
    return null;
  }
  if (d?.cozynode !== 1 || !Array.isArray(d.servers)) return null;
  const servers = d.servers
    .filter((v) => v && typeof v.host === "string" && Number.isInteger(v.port) && v.username && v.password)
    .map(({ host, port, username, password, name }) => ({ host, port, username, password, name: name || host }));
  if (!servers.length) return null;
  const sites = (Array.isArray(d.sites) ? d.sites : []).map(normalizeSite).filter(Boolean);
  const siteServer = d.siteServer && typeof d.siteServer === "object" ? d.siteServer : {};
  return { servers, activeId: d.activeId, mode: d.mode === "sites" ? "sites" : "all", sites, siteServer };
}

// Adds imported servers and sites to what is already here.
export async function importSettings(data) {
  const state = await getState();
  const imported = data.servers.map((v) => ({ ...v, id: serverId(v) }));
  const ids = new Set(imported.map((v) => v.id));
  const servers = [...state.servers.filter((v) => !ids.has(v.id)), ...imported];
  const known = new Set([...servers.map((v) => v.id), DIRECT]);
  const routes = Object.fromEntries(Object.entries(data.siteServer).filter(([k, v]) => data.sites.includes(k) && known.has(v)));
  await chrome.storage.local.set({
    servers,
    activeId: ids.has(data.activeId) ? data.activeId : state.activeId || imported[0].id,
    mode: data.mode,
    sites: [...new Set([...state.sites, ...data.sites])].sort(),
    siteServer: { ...state.siteServer, ...routes },
    enabled: true,
    lastError: "",
  });
}
