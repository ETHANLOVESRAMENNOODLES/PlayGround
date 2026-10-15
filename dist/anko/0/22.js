(() => {
  "use strict";
  const CHECK_KEY = "anko-moderation-check";
  const RECHECK_MS = 120000;
  let running = false;

  function el(tag, attrs, ...children) {
    const node = document.createElement(tag);
    for (const [key, value] of Object.entries(attrs || {})) {
      if (key === "style") node.style.cssText = value;
      else if (key.startsWith("on")) node.addEventListener(key.slice(2), value);
      else node.setAttribute(key, value);
    }
    for (const child of children) if (child != null) node.append(child instanceof Node ? child : document.createTextNode(String(child)));
    return node;
  }

  function untilText(ts) {
    if (!ts) return "permanently";
    const minutes = Math.max(1, Math.ceil((ts - Date.now()) / 60000));
    if (minutes >= 1440) return `for ${Math.ceil(minutes / 1440)} more day(s)`;
    if (minutes >= 60) return `for ${Math.ceil(minutes / 60)} more hour(s)`;
    return `for ${minutes} more minute(s)`;
  }

  function overlay(title, body, buttonText, onClose, tone) {
    const accent = tone === "ban" ? "#ff5c5c" : tone === "timeout" ? "#ffd166" : "var(--accent, #00d4ff)";
    const wrap = el("div", { role: "alertdialog", "aria-modal": "true", style: "position:fixed;inset:0;z-index:2147483600;display:flex;align-items:center;justify-content:center;background:rgba(3,6,8,.78);padding:16px" },
      el("div", { style: `max-width:440px;width:100%;background:#0f1418;border:2px solid ${accent};border-radius:16px;padding:22px;color:#e6edf1;font-family:Montserrat,system-ui,sans-serif;box-shadow:0 0 24px rgba(0,0,0,.5)` },
        el("h2", { style: `margin:0 0 10px;font-size:1.25rem;color:${accent}` }, title),
        ...body.map(line => el("p", { style: "margin:0 0 10px;line-height:1.45;font-size:.95rem;overflow-wrap:anywhere" }, line)),
        el("button", { type: "button", style: "margin-top:8px;width:100%;padding:11px;border-radius:12px;border:2px solid #2f3942;background:#1a2026;color:#fff;font:700 .95rem Montserrat,system-ui,sans-serif;cursor:pointer", onclick: () => { wrap.remove(); onClose?.(); } }, buttonText)));
    document.body.append(wrap);
    return wrap;
  }

  async function showWarnings(warnings) {
    for (const warning of warnings) {
      await new Promise(resolve => overlay("you received a warning", [warning.reason, "repeated issues can lead to a timeout or ban."], "i understand", async () => {
        try { await window._0x3f9a7c.api("/api/account/moderation/ack", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: warning.id }) }); } catch {}
        resolve();
      }, "warning"));
    }
  }

  async function check(force) {
    const auth = window._0x3f9a7c;
    if (!auth || running) return;
    running = true;
    try {
      await auth.ready;
      const user = auth.user;
      if (!user) return;
      let last = {};
      try { last = JSON.parse(sessionStorage.getItem(CHECK_KEY) || "{}"); } catch {}
      if (!force && last.uid === user.uid && Date.now() - last.at < RECHECK_MS && !last.flagged) return;
      const data = await auth.api("/api/account", { cache: "no-store" }).catch(() => null);
      if (!data) return;
      const m = data.moderation || {};
      const warnings = Array.isArray(m.warnings) ? m.warnings : [];
      try { sessionStorage.setItem(CHECK_KEY, JSON.stringify({ uid: user.uid, at: Date.now(), flagged: Boolean(m.ban || m.timeout || warnings.length) })); } catch {}
      if (m.ban) overlay("your account is banned", [m.ban.reason, `you're banned ${untilText(m.ban.expiresAt)}. chat, ai and account changes are disabled.`], "close", null, "ban");
      else if (m.timeout) overlay("you're timed out", [m.timeout.reason, `chat and ai are disabled ${untilText(m.timeout.expiresAt)}.`], "ok", null, "timeout");
      if (warnings.length) await showWarnings(warnings);
    } finally { running = false; }
  }

  window.addEventListener("anko-auth-changed", event => { if (event.detail?.user) check(false); });
  if (window._0x3f9a7c) check(false);
})();
