import { CHECK_URL, DIRECT, addServer, decryptText, encryptText, exportSettings, getState, importSettings, isEncrypted, normalizeSite, parseLink, parseSettings, proxyConflict, removeServer, serverId } from "./lib.js";

const $ = (id) => document.getElementById(id);
const t = (key, sub) => chrome.i18n.getMessage(key, sub) || key;

document.querySelectorAll("[data-i18n]").forEach((el) => (el.textContent = t(el.dataset.i18n)));
document.querySelectorAll("[data-href]").forEach((el) => (el.href = t(el.dataset.href)));
document.querySelectorAll("[data-i18n-ph]").forEach((el) => (el.placeholder = t(el.dataset.i18nPh)));
$("help").title = t("guide");

let currentSite = "";
let adding = false; // setup screen opened from "Add server" while servers exist

async function render() {
  const state = await getState();
  const setup = adding || !state.server;
  $("setup").hidden = !setup;
  $("main").hidden = setup;
  $("cancelAdd").hidden = !state.server;
  if (setup) return;

  const on = state.enabled;
  $("toggle").setAttribute("aria-pressed", String(on));
  $("toggleLabel").textContent = on ? t("stateOn") : t("stateOff");
  const list = $("servers");
  list.replaceChildren();
  for (const s of state.servers) {
    const b = document.createElement("button");
    b.setAttribute("role", "radio");
    b.setAttribute("aria-checked", String(s.id === state.server.id));
    const radio = document.createElement("span");
    radio.className = "radio";
    const name = document.createElement("span");
    name.className = "name";
    name.textContent = s.name;
    const host = document.createElement("span");
    host.className = "muted small";
    host.textContent = `${s.host}:${s.port}`;
    b.append(radio, name, host);
    b.onclick = () => selectServer(s.id);
    const li = document.createElement("li");
    li.append(b);
    list.append(li);
  }
  $("mainError").hidden = !state.lastError;
  $("mainError").textContent = state.lastError;
  document.querySelectorAll("input[name=mode]").forEach((r) => (r.checked = r.value === state.mode));

  // Listed sites go through their own server in both modes; in "all" mode
  // the list holds the exceptions, in "sites" mode the only proxied sites.
  $("sitesBox").hidden = false;
  $("sitesHint").textContent = t(state.mode === "sites" ? "sitesHintOnly" : "sitesHintAll");
  const ul = $("sites");
  ul.replaceChildren();
  for (const s of state.sites) {
    const li = document.createElement("li");
    const name = document.createElement("span");
    name.className = "site";
    name.textContent = s;
    const pick = document.createElement("select");
    pick.title = t("siteServer");
    const options = [["", t("activeServer")], ...state.servers.map((v) => [v.id, v.name]), [DIRECT, t("direct")]];
    for (const [value, label] of options) pick.append(new Option(label, value));
    pick.value = options.some(([v]) => v === state.siteServer[s]) ? state.siteServer[s] : "";
    pick.onchange = () => saveRoute(s, pick.value);
    const x = document.createElement("button");
    x.textContent = "×";
    x.title = t("remove");
    x.onclick = () => saveSites(state.sites.filter((v) => v !== s));
    li.append(name, pick, x);
    ul.append(li);
  }
  const btn = $("addCurrent");
  btn.hidden = !currentSite || state.sites.includes(currentSite);
  btn.textContent = t("addCurrent", currentSite);
}

async function saveSites(sites) {
  const { siteServer } = await getState();
  const routes = Object.fromEntries(Object.entries(siteServer).filter(([k]) => sites.includes(k)));
  await chrome.storage.local.set({ sites: [...new Set(sites)].sort(), siteServer: routes });
  render();
}

async function saveRoute(site, id) {
  const { siteServer } = await getState();
  const routes = { ...siteServer };
  if (id) routes[site] = id;
  else delete routes[site];
  await chrome.storage.local.set({ siteServer: routes });
  render();
}

async function check() {
  const where = $("where");
  if (await proxyConflict()) {
    where.textContent = "";
    await chrome.storage.local.set({ lastError: t("errConflict") });
    return render();
  }
  where.textContent = t("checking");
  try {
    const r = await fetch(CHECK_URL, { cache: "no-store" });
    const txt = await r.text();
    const ip = txt.match(/^ip=(.+)$/m)?.[1] || "?";
    const loc = txt.match(/^loc=(.+)$/m)?.[1] || "?";
    where.textContent = t("whereAmI", [ip, loc]);
    await chrome.storage.local.set({ lastError: "" });
  } catch {
    where.textContent = "";
    // A rejected login fails the same fetch: keep the background's auth error, it says more.
    await new Promise((r) => setTimeout(r, 300));
    const { lastError } = await getState();
    if (lastError !== t("errAuth")) await chrome.storage.local.set({ lastError: t("errNetwork") });
  }
  render();
}

const setupError = (key) => {
  $("setupError").hidden = false;
  $("setupError").textContent = t(key);
};

// Encrypted settings need the export password: show its field only for them.
$("link").addEventListener("input", () => {
  $("importPass").hidden = !isEncrypted($("link").value);
});

$("connect").onclick = async () => {
  // One or more cozy:// links (one per line), or exported settings
  let raw = $("link").value;
  if (isEncrypted(raw)) {
    const plain = await decryptText(raw, $("importPass").value);
    if (plain === null) return setupError("errDecrypt");
    raw = plain;
  }
  const links = raw.split(/\s+/).filter(Boolean).map(parseLink);
  const settings = links.length && links.every(Boolean) ? null : parseSettings(raw);
  if (!settings && !(links.length && links.every(Boolean))) return setupError("errLink");
  if (settings) await importSettings(settings);
  else {
    for (const server of links) await addServer(server);
    await chrome.storage.local.set({ activeId: serverId(links[0]) });
  }
  adding = false;
  $("link").value = "";
  $("importPass").value = "";
  $("importPass").hidden = true;
  $("setupError").hidden = true;
  await render();
  setTimeout(check, 400);
};

$("addServer").onclick = () => {
  adding = true;
  render();
  $("link").focus();
};

$("cancelAdd").onclick = () => {
  adding = false;
  $("setupError").hidden = true;
  render();
};

async function selectServer(id) {
  const { activeId, enabled } = await getState();
  if (id === activeId && enabled) return;
  $("where").textContent = "";
  await chrome.storage.local.set({ activeId: id, enabled: true, lastError: "" });
  await render();
  setTimeout(check, 400);
}

$("toggle").onclick = async () => {
  const { enabled } = await getState();
  await chrome.storage.local.set({ enabled: !enabled, lastError: "" });
  await render();
  setTimeout(check, 400);
};

document.querySelectorAll("input[name=mode]").forEach((r) =>
  r.addEventListener("change", async () => {
    await chrome.storage.local.set({ mode: r.value });
    render();
  })
);

$("addCurrent").onclick = async () => {
  const { sites } = await getState();
  saveSites([...sites, currentSite]);
};

$("addForm").onsubmit = async (e) => {
  e.preventDefault();
  const site = normalizeSite($("siteInput").value);
  if (!site) return;
  $("siteInput").value = "";
  const { sites } = await getState();
  saveSites([...sites, site]);
};

$("check").onclick = check;

$("export").onclick = () => {
  $("exportBox").hidden = !$("exportBox").hidden;
  $("exported").hidden = true;
  $("exportError").hidden = true;
  if (!$("exportBox").hidden) $("exportPass").focus();
};

// The export always leaves the popup encrypted with the password typed here.
$("exportBox").onsubmit = async (e) => {
  e.preventDefault();
  const password = $("exportPass").value;
  $("exportError").hidden = password.length >= 8;
  $("exportError").textContent = t("errPassShort");
  if (password.length < 8) return;
  await navigator.clipboard.writeText(await encryptText(await exportSettings(), password));
  $("exportPass").value = "";
  $("exportBox").hidden = true;
  $("exported").hidden = false;
};

$("forget").onclick = async () => {
  const { server } = await getState();
  if (!server || !confirm(t("forgetConfirm", server.name))) return;
  await removeServer(server.id);
  $("where").textContent = "";
  render();
};

chrome.tabs.query({ active: true, currentWindow: true }).then(([tab]) => {
  if (tab?.url?.startsWith("http")) currentSite = normalizeSite(tab.url);
  render();
});

getState().then((s) => {
  render();
  if (s.server && s.enabled) check();
});
