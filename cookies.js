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
