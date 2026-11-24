export const DOMAIN = "claude.ai";

// Turns a chrome.cookies.Cookie into chrome.cookies.set() details.
export function toSetDetails(c) {
  const d = {
    url: `https://${c.domain.replace(/^\./, "")}${c.path}`,
    name: c.name,
    value: c.value,
    path: c.path,
    secure: c.secure,
    httpOnly: c.httpOnly,
    sameSite: c.sameSite,
  };
  // Host-only cookies (incl. __Host- ones) must not get a domain, or Chrome makes them domain cookies.
  if (!c.hostOnly) d.domain = c.domain;
  if (!c.session) d.expirationDate = c.expirationDate;
  return d;
}

export const cookieHeader = (cookies) => cookies.map((c) => `${c.name}=${c.value}`).join("; ");

const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

// claude.ai/artifact/<id> uses a base58-encoded UUID; the page loads it from /api/frame/<uuid>.
export function artifactUuid(id) {
  let n = 0n;
  for (const ch of id) {
    const v = B58.indexOf(ch);
    if (v < 0) return null;
    n = n * 58n + BigInt(v);
  }
  const h = n.toString(16).padStart(32, "0");
  if (h.length !== 32) return null;
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

export function artifactIdFromUrl(url) {
  const m = /^https:\/\/claude\.ai\/artifact\/([1-9A-HJ-NP-Za-km-z]+)/.exec(url || "");
  return m ? m[1] : null;
}
