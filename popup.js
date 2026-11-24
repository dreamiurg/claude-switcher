import { addAccount, forget, load, saveCurrent } from "./accounts.js";
import { artifactIdFromUrl } from "./cookies.js";
import { isNewer, latestVersion } from "./version.js";

const $ = (id) => document.getElementById(id);
const AVATAR_COLORS = ["#c96442", "#8a6d3b", "#5b7a5a", "#5a6f8f", "#8b5a7a", "#a0603c"];
const TRASH =
  '<svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2.5 3.5h9M5.5 3.5V2.5h3v1M3.5 3.5l.6 8h5.8l.6-8"/></svg>';

const send = (msg) => chrome.runtime.sendMessage(msg);

function status(msg, error = false) {
  $("status").textContent = msg;
  $("status").className = error ? "error" : "";
}

function initials(p, key) {
  const src = (p.name || p.email || key).trim();
  const parts = src.split(/[\s@._-]+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "?") + (p.name ? (parts[1]?.[0] ?? "") : "")).toUpperCase();
}

function avatarColor(key) {
  let h = 0;
  for (const ch of key) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return AVATAR_COLORS[h % AVATAR_COLORS.length];
}

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function avatar(key, p) {
  const av = el("span", "avatar", initials(p, key));
  av.style.background = avatarColor(key);
  av.setAttribute("aria-hidden", "true");
  return av;
}

function who(key, p, fallback) {
  const w = el("span", "who");
  w.append(el("span", "name", p.name || p.email || key));
  const second = p.email ? (p.name ? p.email : null) : fallback;
  if (second) w.append(el("span", "email", second));
  return w;
}

// Switching runs in the service worker, so it finishes even if this popup closes as the tabs reload.
async function switchTo(key, button) {
  button.disabled = true;
  const res = await send({ type: "switch", key });
  if (res?.error) return status(res.error, true);
  if (res?.failed) {
    status(
      `Switched, but ${res.failed} cookie(s) didn't restore. If claude.ai asks you to sign in, sign in again.`,
      true,
    );
  }
  render(await saveCurrent());
}

function accountRow(key, p, state, rerender) {
  const label = p.email || key;
  const li = el("li", state.isCurrent ? "current" : "");
  const btn = el("button", "account");
  btn.type = "button";
  btn.disabled = state.isCurrent;
  btn.setAttribute("aria-label", state.isCurrent ? `${label}, current account` : `Switch to ${label}`);

  let tail;
  if (state.isCurrent) tail = el("span", "badge", "Active");
  else if (state.expired) tail = el("span", "expired", "Sign in again");
  else tail = el("span", "hint", "Switch");
  btn.append(avatar(key, p), who(key, p, "Email added on next switch"), tail);
  btn.onclick = () => {
    li.classList.add("busy");
    if (tail.className === "hint") tail.textContent = "Switching…";
    switchTo(key, btn).catch((e) => status(e.message, true));
  };
  li.append(btn);

  if (!state.isCurrent) {
    const del = el("button", "remove");
    del.type = "button";
    del.innerHTML = TRASH;
    del.title = "Forget this account";
    del.setAttribute("aria-label", `Forget ${label}`);
    del.onclick = async () => {
      if (del.dataset.armed) {
        await forget(key);
        return rerender();
      }
      del.dataset.armed = "1";
      del.title = "Click again to forget";
      status(`Click the trash icon again to forget ${label}.`);
    };
    li.append(del);
  }
  return li;
}

async function render(currentKey) {
  const { profiles, expired, showEmails } = await load();
  document.body.classList.toggle("hide-emails", !showEmails);
  $("show-emails").checked = showEmails;
  const keys = Object.keys(profiles).sort((a, b) =>
    a === currentKey ? -1 : b === currentKey ? 1 : a.localeCompare(b),
  );
  const rows = keys.map((key) =>
    accountRow(key, profiles[key], { isCurrent: key === currentKey, expired: expired.includes(key) }, () =>
      render(currentKey),
    ),
  );
  if (!rows.length) {
    rows.push(el("li", "empty", "Sign in to claude.ai, then open this again. The account is saved automatically."));
  }
  $("list").replaceChildren(...rows);
}

// On an artifact page that the signed-in account can't open, offer the account that can.
async function suggest() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const artifactId = artifactIdFromUrl(tab?.url);
  if (!artifactId || !/^(Page not found|Sign in)/.test(tab.title || "")) return;
  const r = await send({ type: "cached", artifactId });
  if (!r?.owner) return;
  const { profiles } = await load();
  const p = profiles[r.owner.key];
  const go = el("button", "go", "Open");
  go.type = "button";
  go.onclick = () => switchTo(r.owner.key, go).catch((e) => status(e.message, true));
  $("suggest-row").replaceChildren(avatar(r.owner.key, p), who(r.owner.key, p, "Opens this page there"), go);
  $("suggest").hidden = false;
}

async function showVersion() {
  const mine = chrome.runtime.getManifest().version;
  $("version").textContent = `v${mine}`;
  const latest = await latestVersion();
  if (!latest || !isNewer(latest, mine)) return;
  const a = el("a", "", `Update to v${latest}`);
  a.id = "update";
  a.href = "https://github.com/dreamiurg/claude-switcher#update";
  a.target = "_blank";
  a.title = "git pull in the extension's folder, then reload it in chrome://extensions";
  $("version").replaceChildren(a);
}

$("fresh").onclick = async () => {
  await addAccount();
  await render(null);
  status("Sign in on claude.ai, then open this again to save it.");
};

$("show-emails").onchange = async (e) => {
  await chrome.storage.local.set({ showEmails: e.target.checked });
  document.body.classList.toggle("hide-emails", !e.target.checked);
};

render((await load()).active);
render(await saveCurrent());
suggest();
showVersion();
