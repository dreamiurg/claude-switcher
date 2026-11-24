import { artifactUuid, cookieHeader, DOMAIN, toSetDetails } from "./cookies.js";

const CLAUDE_TABS = ["https://claude.ai/*", "https://*.claude.ai/*"];

export const current = () => chrome.cookies.getAll({ domain: DOMAIN });
export const signedIn = async () => (await current()).some((c) => c.name === "sessionKey");

export async function load() {
  const keys = ["profiles", "active", "owners", "expired", "showEmails"];
  const {
    profiles = {},
    active = null,
    owners = {},
    expired = [],
    showEmails = true,
  } = await chrome.storage.local.get(keys);
  // Profiles saved by v1 were bare cookie arrays keyed by a typed alias.
  for (const [k, p] of Object.entries(profiles)) if (Array.isArray(p)) profiles[k] = { cookies: p };
  return { profiles, active, owners, expired, showEmails };
}

// Name and email only: cookies never leave the extension's own pages.
export function label(profiles, key) {
  const p = profiles[key];
  return p ? { key, name: p.name || p.email || key, email: p.email || "" } : null;
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
export async function saveCurrent() {
  const { profiles, active, expired } = await load();
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
  await chrome.storage.local.set({ profiles, active: me.email, expired: expired.filter((k) => k !== me.email) });
  return me.email;
}

async function clearCookies() {
  for (const c of await current()) await chrome.cookies.remove({ url: toSetDetails(c).url, name: c.name });
}

const claudeTabs = () => chrome.tabs.query({ url: CLAUDE_TABS });

export async function switchTo(key) {
  await saveCurrent();
  const { profiles } = await load();
  if (!profiles[key]) throw new Error("That account is no longer saved.");
  await clearCookies();
  let failed = 0;
  for (const c of profiles[key].cookies) if (!(await chrome.cookies.set(toSetDetails(c)))) failed++;
  await chrome.storage.local.set({ active: key });
  await saveCurrent();
  for (const t of await claudeTabs()) chrome.tabs.reload(t.id);
  return failed;
}

// Clears cookies locally instead of using claude.ai's Log out, which would kill the saved session on the server.
export async function addAccount() {
  await saveCurrent();
  await clearCookies();
  await chrome.storage.local.set({ active: null });
  const [tab] = await claudeTabs();
  const url = "https://claude.ai/login";
  if (tab) await chrome.tabs.update(tab.id, { url, active: true });
  else await chrome.tabs.create({ url });
}

export async function forget(key) {
  const { profiles, owners } = await load();
  delete profiles[key];
  for (const [id, k] of Object.entries(owners)) if (k === key) delete owners[id];
  await chrome.storage.local.set({ profiles, owners });
}

export async function remember(artifactId, key) {
  const { owners } = await load();
  if (owners[artifactId] === key) return;
  owners[artifactId] = key;
  // shortcut: the owner cache grows without bound; trim it if it ever reaches thousands of entries.
  await chrome.storage.local.set({ owners });
}

let nextRuleId = Math.floor(Math.random() * 1e6) + 1;

// Requests the artifact with another account's session. A one-off DNR rule swaps the Cookie header on this
// one extension request only (marked URL, no tab); credentials: "omit" keeps the response's Set-Cookie out
// of the browser's cookie jar, so the signed-in account is untouched.
async function statusAs(uuid, cookies) {
  const id = nextRuleId++;
  const url = `https://claude.ai/api/frame/${uuid}?via=user_open&bk=initial&actor=id&vt=1&rw=1&cs=${crypto.randomUUID()}`;
  await chrome.declarativeNetRequest.updateSessionRules({
    addRules: [
      {
        id,
        priority: 1,
        action: {
          type: "modifyHeaders",
          requestHeaders: [{ header: "cookie", operation: "set", value: cookieHeader(cookies) }],
        },
        condition: { urlFilter: `|${url}|`, tabIds: [-1], resourceTypes: ["xmlhttprequest", "other"] },
      },
    ],
  });
  try {
    return (await fetch(url, { credentials: "omit" })).status;
  } catch {
    return 0;
  } finally {
    await chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds: [id] });
  }
}

// Which saved account (other than the active one) can open this artifact.
export async function findOwner(artifactId) {
  const uuid = artifactUuid(artifactId);
  const { profiles, active, owners, expired } = await load();
  const cached = owners[artifactId];
  if (cached && cached !== active && profiles[cached]) return { owner: cached, checked: [cached] };
  const others = Object.keys(profiles).filter((k) => k !== active);
  if (!uuid || !others.length) return { owner: null, checked: [] };

  const results = await Promise.all(others.map(async (k) => [k, await statusAs(uuid, profiles[k].cookies)]));
  const owner = results.find(([, s]) => s === 200)?.[0] ?? null;
  const nowExpired = results.filter(([, s]) => s === 401).map(([k]) => k);
  const stillOk = results.filter(([, s]) => s !== 401).map(([k]) => k);
  await chrome.storage.local.set({
    expired: [...new Set([...expired.filter((k) => !stillOk.includes(k)), ...nowExpired])],
  });
  if (owner) await remember(artifactId, owner);
  return { owner, checked: others };
}
