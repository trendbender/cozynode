import { CHECK_URL, getState, normalizeSite, parseLink } from "./lib.js";

const $ = (id) => document.getElementById(id);
const t = (key, sub) => chrome.i18n.getMessage(key, sub) || key;

document.querySelectorAll("[data-i18n]").forEach((el) => (el.textContent = t(el.dataset.i18n)));

let currentSite = "";

async function render() {
  const state = await getState();
  $("setup").hidden = !!state.server;
  $("main").hidden = !state.server;
  if (!state.server) return;

  const on = state.enabled;
  $("toggle").setAttribute("aria-pressed", String(on));
  $("toggleLabel").textContent = on ? t("stateOn") : t("stateOff");
  $("serverName").textContent = state.server.name;
  $("serverHost").textContent = `${state.server.host}:${state.server.port}`;
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
  await chrome.storage.local.set({ server, enabled: true, lastError: "" });
  await render();
  setTimeout(check, 400);
};

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
  if (!confirm(t("forgetConfirm"))) return;
  await chrome.storage.local.set({ server: null, enabled: false, lastError: "" });
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
