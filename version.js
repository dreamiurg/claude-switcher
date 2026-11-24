const LATEST_MANIFEST = "https://raw.githubusercontent.com/dreamiurg/claude-switcher/main/manifest.json";
const DAY = 24 * 60 * 60 * 1000;

export function isNewer(a, b) {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) > (pb[i] || 0);
  }
  return false;
}

// Newest version on GitHub main, checked at most once a day; null when unknown.
export async function latestVersion() {
  const { latest } = await chrome.storage.local.get("latest");
  if (latest && Date.now() - latest.at < DAY) return latest.version;
  try {
    const r = await fetch(LATEST_MANIFEST, { cache: "no-store" });
    if (!r.ok) return latest?.version ?? null;
    const { version } = await r.json();
    await chrome.storage.local.set({ latest: { version, at: Date.now() } });
    return version;
  } catch {
    return latest?.version ?? null;
  }
}
