// Runs on claude.ai. On an artifact page that says "Page not found" (or asks to sign in), asks the
// extension which saved account can open it and offers a one-click switch.
(() => {
  const ID = /^\/artifact\/([1-9A-HJ-NP-Za-km-z]+)/;
  const STYLE = `
    :host { all: initial; }
    .card { position: fixed; left: 50%; bottom: 24px; transform: translateX(-50%); z-index: 2147483647;
      width: min(460px, calc(100vw - 32px)); box-sizing: border-box; display: flex; align-items: center; gap: 12px;
      padding: 12px 12px 12px 14px; border-radius: 12px; border: 1px solid #e8e5dc; background: #fff; color: #1f1e1d;
      font: 13px/1.4 -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
      box-shadow: 0 1px 2px rgb(31 30 29 / 6%), 0 8px 24px rgb(31 30 29 / 10%);
      animation: in 220ms cubic-bezier(.2,.8,.2,1); }
    @keyframes in { from { opacity: 0; transform: translate(-50%, 8px); } }
    @media (prefers-reduced-motion: reduce) { .card, .spin { animation: none; } }
    .t { flex: 1; min-width: 0; }
    .t strong { display: block; font-size: 14px; }
    .t span { display: block; overflow-wrap: anywhere; }
    .t span, .em { color: #6b6862; font-weight: 400; }
    .av { flex: none; width: 32px; height: 32px; border-radius: 50%; display: grid; place-items: center;
      background: #c96442; color: #fff; font-weight: 600; font-size: 12px; }
    .spin { flex: none; width: 16px; height: 16px; border-radius: 50%; border: 2px solid #e8e5dc;
      border-top-color: #c96442; animation: spin 0.9s linear infinite; }
    @keyframes spin { to { transform: rotate(360deg); } }
    button { flex: none; border: 0; border-radius: 8px; padding: 7px 12px; cursor: pointer; white-space: nowrap;
      font: 600 13px -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif; }
    .go { background: #c96442; color: #fff; }
    .go:disabled { opacity: 0.7; cursor: default; }
    .x { background: transparent; color: #6b6862; padding: 4px 6px; font-size: 16px; line-height: 1; }
    button:focus-visible { outline: 2px solid #c96442; outline-offset: 2px; }
    @media (prefers-color-scheme: dark) {
      .card { background: #30302e; color: #f0eee6; border-color: #3d3c39; }
      .t span, .em, .x { color: #a6a39b; }
      .spin { border-color: #3d3c39; border-top-color: #d97757; }
    }`;

  let host = null;
  let seenPath = "";

  const send = (msg) =>
    new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage(msg, (r) => resolve(chrome.runtime.lastError ? null : r));
      } catch {
        resolve(null); // extension was reloaded; this old content script is orphaned
      }
    });

  const el = (tag, cls, text) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text) n.textContent = text;
    return n;
  };

  function show(...children) {
    if (!host) {
      host = el("div");
      host.attachShadow({ mode: "open" });
      document.documentElement.append(host);
    }
    const card = el("div", "card");
    card.setAttribute("role", "status");
    const close = el("button", "x", "×");
    close.type = "button";
    close.setAttribute("aria-label", "Dismiss");
    close.onclick = hide;
    card.append(...children, close);
    const style = el("style");
    style.textContent = STYLE;
    host.shadowRoot.replaceChildren(style, card);
  }

  function hide() {
    host?.remove();
    host = null;
  }

  const initials = (l) => (l.name.match(/\b\p{L}/gu) || [l.name[0] || "?"]).slice(0, 2).join("").toUpperCase();

  function foundCard(r) {
    const t = el("div", "t");
    t.append(el("strong", "", `This artifact is in ${r.owner.name}`));
    if (r.showEmails && r.owner.email && r.owner.email !== r.owner.name) t.append(el("span", "", r.owner.email));
    if (r.active) t.append(el("span", "", `You're on ${r.active.name}`));
    const go = el("button", "go", "Open there");
    go.type = "button";
    go.onclick = async () => {
      go.disabled = true;
      go.textContent = "Switching…";
      const res = await send({ type: "switch", key: r.owner.key });
      if (!res || res.error) {
        go.disabled = false;
        go.textContent = "Try again";
      }
    };
    show(el("div", "av", initials(r.owner)), t, go);
  }

  function describe(d) {
    const parts = [`artifact ${d.frame}${d.reason ? ` (${d.reason})` : ""}`];
    if (d.challenged) parts.push("blocked by Cloudflare check");
    parts.push(d.seenAs ? `signed in as ${d.seenAs}` : `account check ${d.account}`);
    return `${d.name}: ${parts.join(", ")}`;
  }

  function missingCard(r) {
    const t = el("div", "t");
    t.append(el("strong", "", "Not in your other accounts"));
    for (const d of r.diagnostics || []) t.append(el("span", "", describe(d)));
    if (!r.diagnostics?.length) t.append(el("span", "", `Checked ${r.checked.map((l) => l.name).join(", ")}.`));
    show(t);
    setTimeout(hide, 20000);
  }

  const FRAME_HEADERS = { "X-Frame-CP": "go", "X-Frame-Platform": "web" };

  const json = (text) => {
    try {
      return JSON.parse(text);
    } catch {
      return null;
    }
  };

  // Asks for the artifact the way claude.ai's artifact page does, from this page so the request is same-origin.
  // The extension swaps in another account's cookies for this one URL; "omit" keeps this page's own cookies out.
  // Like the page, it names an organization (?org=), tries the account's others on 401, and on a 403
  // "org_mismatch" retries with the owner_org the server names.
  async function frameGet(prefix, org) {
    const r = await fetch(`${prefix}${org ? `&org=${encodeURIComponent(org)}` : ""}&bk=probe`, {
      credentials: "omit",
      cache: "no-store",
      headers: FRAME_HEADERS,
    });
    const body = (await r.text()).slice(0, 300);
    return { status: r.status, body, challenged: r.headers.get("cf-mitigated") === "challenge" };
  }

  // 401: this organization can't see it, try the next. 403 org_mismatch: the server names the owner's.
  async function frameStatus(prefix, orgs) {
    let last = null;
    for (const org of orgs.length ? orgs : [null]) {
      last = await frameGet(prefix, org);
      const owner = last.status === 403 && json(last.body)?.owner_org;
      if (typeof owner === "string") return frameGet(prefix, owner);
      if (last.status !== 401) break;
    }
    return last;
  }

  async function probe(artifactId) {
    const t = el("div", "t");
    t.append(el("strong", "", "Checking your other accounts…"));
    show(el("div", "spin"), t);
    let r = await send({ type: "prepare", artifactId });
    if (r?.probes) {
      const results = await Promise.all(
        r.probes.map(async (p) => ({
          key: p.key,
          ruleId: p.ruleId,
          ...(await frameStatus(p.prefix, p.orgs || []).catch((e) => ({ status: 0, body: String(e) }))),
        })),
      );
      r = await send({ type: "finish", artifactId, results });
    }
    if (location.pathname !== seenPath) return;
    if (!r || r.error || !r.checked?.length) return hide();
    if (r.owner) foundCard(r);
    else missingCard(r);
  }

  const blocked = () =>
    /^(Page not found|Sign in)/.test(document.title) ||
    /Page not found|Sign in to view this page/.test(document.body?.innerText || "");

  // claude.ai is a single-page app: watch for route changes, then give each artifact page a few seconds to settle.
  function onRoute() {
    if (location.pathname === seenPath) return;
    seenPath = location.pathname;
    hide();
    const m = ID.exec(seenPath);
    if (!m) return;
    let ticks = 0;
    const timer = setInterval(() => {
      if (location.pathname !== seenPath) return clearInterval(timer);
      if (blocked()) {
        clearInterval(timer);
        probe(m[1]);
      } else if (++ticks >= 12) {
        clearInterval(timer);
        send({ type: "seen", artifactId: m[1] });
      }
    }, 500);
  }

  onRoute();
  setInterval(onRoute, 1000);
})();
