import assert from "node:assert/strict";
import { toSetDetails } from "./cookies.js";

const base = { name: "sessionKey", value: "v", path: "/", secure: true, httpOnly: true, sameSite: "lax" };

const domainCookie = toSetDetails({
  ...base,
  domain: ".claude.ai",
  hostOnly: false,
  session: false,
  expirationDate: 2e9,
});
assert.equal(domainCookie.url, "https://claude.ai/");
assert.equal(domainCookie.domain, ".claude.ai");
assert.equal(domainCookie.expirationDate, 2e9);

const hostOnlySession = toSetDetails({ ...base, name: "__Host-x", domain: "claude.ai", hostOnly: true, session: true });
assert.equal("domain" in hostOnlySession, false);
assert.equal("expirationDate" in hostOnlySession, false);

console.log("ok");
