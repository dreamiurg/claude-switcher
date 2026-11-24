import { DOMAIN, toSetDetails } from "./cookies.js";

const $ = (id) => document.getElementById(id);
const current = () => chrome.cookies.getAll({ domain: DOMAIN });
const signedIn = async () => (await current()).some((c) => c.name === "sessionKey");
const AVATAR_COLORS = ["#c96442", "#8a6d3b", "#5b7a5a", "#5a6f8f", "#8b5a7a", "#a0603c"];

function status(msg, error = false) {
  $("status").textContent = msg;
  $("status").className = error ? "error" : "";
}

async function load() {
  const { profiles = {}, active = null } = await chrome.storage.local.get(["profiles", "active"]);
  // Profiles saved by v1 were bare cookie arrays keyed by a typed alias.
  for (const [k, p] of Object.entries(profiles)) if (Array.isArray(p)) profiles[k] = { cookies: p };
  return { profiles, active };
}

// Asks claude.ai who the current cookies belong to; null when signed out or the call fails.
async function whoami() {
  if (!(await signedIn())) return null;
  try {
    const r = await fetch("https://claude.ai/api/account", { credentials: "include" });
    if (!r.ok) return null;
    const a = await r.json();
    return a.email_address ? { email: a.email_address, name: a.full_name || a.display_name || "" } : null;
  } catch {
    return null;
  }
}

// Saves the signed-in account's cookies under its email (claude.ai rotates them, so this runs before every switch).
async function saveCurrent() {
  const { profiles, active } = await load();
  const me = await whoami();
  if (!me) {
    // Fall back to the last known key when the account API is unreachable.
    if (active && profiles[active] && (await signedIn())) {
      profiles[active] = { ...profiles[active], cookies: await current() };
      await chrome.storage.local.set({ profiles });
    }
    return active;
  }
  // A v1 alias entry for the same session is replaced by the email-keyed one.
  if (active && active !== me.email && profiles[active] && !profiles[active].email) delete profiles[active];
  profiles[me.email] = { email: me.email, name: me.name, cookies: await current() };
  await chrome.storage.local.set({ profiles, active: me.email });
  return me.email;
}

async function clearCookies() {
  for (const c of await current()) await chrome.cookies.remove({ url: toSetDetails(c).url, name: c.name });
}

async function openClaude(url) {
  const tabs = await chrome.tabs.query({ url: ["https://claude.ai/*", "https://*.claude.ai/*"] });
  if (!tabs.length) return chrome.tabs.create({ url });
  for (const t of tabs) chrome.tabs.update(t.id, { url });
}

async function switchTo(key, li) {
  li.classList.add("busy");
  li.querySelector(".hint").textContent = "Switching…";
  await saveCurrent();
  const { profiles } = await load();
  await clearCookies();
  let failed = 0;
  for (const c of profiles[key].cookies) if (!(await chrome.cookies.set(toSetDetails(c)))) failed++;
  await chrome.storage.local.set({ active: key });
  const now = await saveCurrent();
  await openClaude("https://claude.ai/new");
  await render(now);
  if (failed)
    status(
      `Switched, but ${failed} cookie(s) didn't restore. If claude.ai asks you to sign in, this session expired.`,
      true,
    );
  else status("");
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

const TRASH =
  '<svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2.5 3.5h9M5.5 3.5V2.5h3v1M3.5 3.5l.6 8h5.8l.6-8"/></svg>';

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function accountRow(key, p, isCurrent, rerender) {
  const label = p.email || key;
  const li = el("li", isCurrent ? "current" : "");

  const btn = el("button", "account");
  btn.type = "button";
  btn.disabled = isCurrent;
  btn.setAttribute("aria-label", isCurrent ? `${label}, current account` : `Switch to ${label}`);

  const av = el("span", "avatar", initials(p, key));
  av.style.background = avatarColor(key);
  av.setAttribute("aria-hidden", "true");

  const who = el("span", "who");
  who.append(el("span", "name", p.name || label));
  const secondLine = p.email ? (p.name ? p.email : null) : "Email added on next switch";
  if (secondLine) who.append(el("span", "email", secondLine));

  const tail = isCurrent ? el("span", "badge", "Active") : el("span", "hint", "Switch");
  btn.append(av, who, tail);
  btn.onclick = () => switchTo(key, li).catch((e) => status(e.message, true));
  li.append(btn);

  if (!isCurrent) {
    const del = el("button", "remove");
    del.type = "button";
    del.innerHTML = TRASH;
    del.title = "Forget this account";
    del.setAttribute("aria-label", `Forget ${label}`);
    del.onclick = async () => {
      if (!confirm(`Forget ${label}? You'll need to sign in to it again.`)) return;
      const fresh = await load();
      delete fresh.profiles[key];
      await chrome.storage.local.set({ profiles: fresh.profiles });
      rerender();
    };
    li.append(del);
  }
  return li;
}

async function render(currentKey) {
  const { profiles } = await load();
  const keys = Object.keys(profiles).sort((a, b) =>
    a === currentKey ? -1 : b === currentKey ? 1 : a.localeCompare(b),
  );
  const rows = keys.map((key) => accountRow(key, profiles[key], key === currentKey, () => render(currentKey)));
  if (!rows.length) {
    rows.push(el("li", "empty", "Sign in to claude.ai, then open this again. The account is saved automatically."));
  }
  $("list").replaceChildren(...rows);
}

// Clears cookies locally instead of using claude.ai's Log out, which would kill the saved session on the server.
$("fresh").onclick = async () => {
  await saveCurrent();
  await clearCookies();
  await chrome.storage.local.set({ active: null });
  await openClaude("https://claude.ai/login");
  await render(null);
  status("Sign in on claude.ai, then open this again to save it.");
};

render((await load()).active);
render(await saveCurrent());
