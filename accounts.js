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

// A one-off DNR rule that swaps the Cookie header for requests whose URL starts with `prefix` (it carries a
// random nonce), only from the given tab (-1: the extension itself). Requests made with credentials: "omit"
// also keep the response's Set-Cookie out of the cookie jar, so the signed-in account is untouched.
async function addCookieRule(prefix, cookies, tabId) {
  const id = nextRuleId++;
  await chrome.declarativeNetRequest.updateSessionRules({
    addRules: [
      {
        id,
        priority: 1,
        action: {
          type: "modifyHeaders",
          requestHeaders: [{ header: "cookie", operation: "set", value: cookieHeader(cookies) }],
        },
        condition: { urlFilter: `|${prefix}`, tabIds: [tabId], resourceTypes: ["xmlhttprequest", "other"] },
      },
    ],
  });
  setTimeout(() => removeRules([id]), 20000);
  return id;
}

const removeRules = (ids) => chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds: ids }).catch(() => {});

// Which account a saved session belongs to and its organizations (the one it last used first), asked from
// the extension itself.
async function accountOf(cookies) {
  const url = `https://claude.ai/api/account?cs=${crypto.randomUUID()}`;
  const id = await addCookieRule(url, cookies, -1);
  try {
    const r = await fetch(url, { credentials: "omit", cache: "no-store" });
    const a = parseJson(await r.text());
    const last = cookies.find((c) => c.name === "lastActiveOrg")?.value;
    const orgs = (a?.memberships ?? []).map((m) => m.organization?.uuid).filter(Boolean);
    orgs.sort((x, y) => (y === last) - (x === last));
    return { status: r.status, email: a?.email_address ?? null, orgs };
  } catch {
    return { status: 0, email: null, orgs: [] };
  } finally {
    await removeRules([id]);
  }
}

function parseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

// Step 1 of finding an artifact's account. The artifact tab's content script makes the /api/frame requests,
// as claude.ai's own page does; this arms one cookie-swap rule per other saved account and hands back URL
// prefixes and each account's organizations (never cookies). /api/frame needs ?org=, like the page sends.
export async function prepareProbe(artifactId, tabId) {
  const uuid = artifactUuid(artifactId);
  const { profiles, active, owners } = await load();
  const cached = owners[artifactId];
  if (cached && cached !== active && profiles[cached]) return { owner: cached, checked: [cached] };
  const others = Object.keys(profiles).filter((k) => k !== active);
  if (!uuid || !others.length) return { owner: null, checked: [] };
  const probes = await Promise.all(
    others.map(async (key) => {
      const acct = await accountOf(profiles[key].cookies);
      const prefix = `https://claude.ai/api/frame/${uuid}?cs=${crypto.randomUUID()}`;
      // The page asks this when the artifact won't open, to offer "View invitation" for one shared with you.
      const invitePrefix = `https://claude.ai/api/frame/invitation/by-artifact/${uuid}?cs=${crypto.randomUUID()}`;
      const ruleIds = await Promise.all(
        [prefix, invitePrefix].map((u) => addCookieRule(u, profiles[key].cookies, tabId)),
      );
      return { key, prefix, invitePrefix, orgs: acct.orgs, ruleIds };
    }),
  );
  return { probes };
}

// Step 2: the content script's results. 200 means that account can open the artifact; failing that, an
// account with a pending invitation to it is the one to switch to.
export async function finishProbe(artifactId, results) {
  await removeRules(results.flatMap((r) => r.ruleIds ?? []));
  const { profiles, expired } = await load();
  const known = results.filter((r) => profiles[r.key]);
  const owner = known.find((r) => r.status === 200)?.key ?? null;
  if (owner) {
    await remember(artifactId, owner);
    return { owner, checked: known.map((r) => r.key), diagnostics: [] };
  }
  // Not cached: once accepted, the artifact opens there and the next visit caches it as usual.
  const invitee = known.find((r) => r.invited)?.key;
  if (invitee) return { owner: invitee, invited: true, checked: known.map((r) => r.key), diagnostics: [] };
  const diagnostics = await Promise.all(
    known.map(async (r) => {
      const acct = await accountOf(profiles[r.key].cookies);
      const d = {
        key: r.key,
        frame: r.status,
        challenged: r.challenged,
        reason: parseJson(r.body)?.reason ?? parseJson(r.body)?.error?.type ?? null,
        account: acct.status,
        seenAs: acct.email,
      };
      console.warn("Claude Switcher probe", d, r.body);
      return d;
    }),
  );
  const nowExpired = diagnostics.filter((d) => d.account === 401).map((d) => d.key);
  const fine = diagnostics.filter((d) => d.account === 200).map((d) => d.key);
  await chrome.storage.local.set({
    expired: [...new Set([...expired.filter((k) => !fine.includes(k)), ...nowExpired])],
  });
  return { owner: null, checked: known.map((r) => r.key), diagnostics };
}

export async function cachedOwner(artifactId) {
  const { profiles, active, owners } = await load();
  const k = owners[artifactId];
  return k && k !== active && profiles[k] ? k : null;
}
