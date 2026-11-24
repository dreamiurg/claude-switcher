import assert from "node:assert/strict";
import { artifactIdFromUrl, artifactUuid, cookieHeader, toSetDetails } from "./cookies.js";
import { isNewer } from "./version.js";

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

assert.equal(cookieHeader([base, { name: "lastActiveOrg", value: "o" }]), "sessionKey=v; lastActiveOrg=o");

// Real pair seen on claude.ai: the artifact URL id and the UUID its page requests from /api/frame.
assert.equal(artifactUuid("7sQjS6M1btyvQv93VWrpvN"), "37a0a544-7b2c-4c70-8df5-ceeb8073df2b");
assert.equal(artifactUuid("0OIl"), null);
assert.equal(artifactIdFromUrl("https://claude.ai/artifact/7sQjS6M1btyvQv93VWrpvN#x"), "7sQjS6M1btyvQv93VWrpvN");
assert.equal(artifactIdFromUrl("https://claude.ai/new"), null);

assert.equal(isNewer("1.10.0", "1.9.3"), true);
assert.equal(isNewer("1.1.0", "1.1.0"), false);
assert.equal(isNewer("1.0.9", "1.1"), false);

console.log("ok");
