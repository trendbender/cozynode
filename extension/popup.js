import { CHECK_URL, addServer, getState, normalizeSite, parseLink, removeServer } from "./lib.js";

const $ = (id) => document.getElementById(id);
const t = (key, sub) => chrome.i18n.getMessage(key, sub) || key;

document.querySelectorAll("[data-i18n]").forEach((el) => (el.textContent = t(el.dataset.i18n)));

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

  $("sitesBox").hidden = state.mode !== "sites";
  const ul = $("sites");
  ul.replaceChildren();
  for (const s of state.sites) {
    const li = document.createElement("li");
    li.textContent = s;
    const x = document.createElement("button");
    x.textContent = "×";
    x.title = t("remove");
    x.onclick = () => saveSites(state.sites.filter((v) => v !== s));
    li.append(x);
    ul.append(li);
  }
  const btn = $("addCurrent");
  btn.hidden = !currentSite || state.sites.includes(currentSite);
  btn.textContent = t("addCurrent", currentSite);
}

async function saveSites(sites) {
  await chrome.storage.local.set({ sites: [...new Set(sites)].sort() });
  render();
}

async function check() {
  const where = $("where");
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
    await chrome.storage.local.set({ lastError: t("errNetwork") });
  }
  render();
}

$("connect").onclick = async () => {
  const server = parseLink($("link").value);
  if (!server) {
    $("setupError").hidden = false;
    $("setupError").textContent = t("errLink");
    return;
  }
  await addServer(server);
  adding = false;
  $("link").value = "";
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
