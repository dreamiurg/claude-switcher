import { cachedOwner, finishProbe, label, load, prepareProbe, remember, switchTo } from "./accounts.js";

const initials = (l) => (l.name.match(/\b\p{L}/gu) || [l.name[0] || "?"]).slice(0, 2).join("").toUpperCase();

// What the page and popup may see: names and emails, never cookies.
async function present({ owner, invited = false, checked = [], diagnostics = [] }, tabId) {
  const { profiles, active, showEmails } = await load();
  const ownerLabel = owner ? label(profiles, owner) : null;
  if (tabId !== undefined) {
    await chrome.action.setBadgeBackgroundColor({ tabId, color: "#c96442" });
    await chrome.action.setBadgeText({ tabId, text: ownerLabel ? initials(ownerLabel) : "" });
  }
  return {
    owner: ownerLabel,
    invited,
    active: active ? label(profiles, active) : null,
    checked: checked.map((k) => label(profiles, k)),
    showEmails,
    diagnostics: diagnostics.map(({ key, ...d }) => ({ ...d, name: label(profiles, key).name })),
  };
}

async function handle(msg, sender) {
  const tabId = sender.tab?.id;
  switch (msg.type) {
    case "prepare": {
      const r = await prepareProbe(msg.artifactId, tabId);
      return r.probes ? { probes: r.probes } : present(r, tabId);
    }
    case "finish":
      return present(await finishProbe(msg.artifactId, msg.results), tabId);
    case "cached": {
      const owner = await cachedOwner(msg.artifactId);
      return present({ owner, checked: owner ? [owner] : [] });
    }
    case "seen": {
      const { active } = await load();
      if (active) await remember(msg.artifactId, active);
      return {};
    }
    case "switch":
      return { failed: await switchTo(msg.key) };
    default:
      throw new Error(`Unknown message ${msg.type}`);
  }
}

chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  handle(msg, sender).then(reply, (e) => reply({ error: e.message }));
  return true;
});
