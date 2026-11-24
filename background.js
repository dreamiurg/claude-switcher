import { findOwner, label, load, remember, switchTo } from "./accounts.js";

const initials = (l) => (l.name.match(/\b\p{L}/gu) || [l.name[0] || "?"]).slice(0, 2).join("").toUpperCase();

async function probe(artifactId, tabId) {
  const { owner, checked, diagnostics = [] } = await findOwner(artifactId);
  const { profiles, active, showEmails } = await load();
  const ownerLabel = owner ? label(profiles, owner) : null;
  if (tabId !== undefined) {
    await chrome.action.setBadgeBackgroundColor({ tabId, color: "#c96442" });
    await chrome.action.setBadgeText({ tabId, text: ownerLabel ? initials(ownerLabel) : "" });
  }
  return {
    owner: ownerLabel,
    active: active ? label(profiles, active) : null,
    checked: checked.map((k) => label(profiles, k)),
    showEmails,
    diagnostics: diagnostics.map(({ key, frame, account, seenAs }) => ({
      name: label(profiles, key).name,
      frame,
      account,
      seenAs,
    })),
  };
}

async function handle(msg, sender) {
  if (msg.type === "probe") return probe(msg.artifactId, sender.tab?.id);
  if (msg.type === "seen") {
    const { active } = await load();
    if (active) await remember(msg.artifactId, active);
    return {};
  }
  if (msg.type === "switch") return { failed: await switchTo(msg.key) };
  throw new Error(`Unknown message ${msg.type}`);
}

chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  handle(msg, sender).then(reply, (e) => reply({ error: e.message }));
  return true;
});
