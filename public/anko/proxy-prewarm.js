(() => {
  const transportPath = '/transports/epoxy-baremux.mjs?v=2';
  const sessionKey = 'anko-proxy-wisp-session-v2';
  const transportKey = 'anko-proxy-transport-v2';
  const reuseMs = 5 * 60 * 1000;
  let sessionPromise;
  let prewarmPromise;
  let warmConnection;

  function storedSession() {
    try {
      const saved = JSON.parse(sessionStorage.getItem(sessionKey) || 'null');
      const expires = Number(String(saved?.token || '').split('.')[0]);
      if (saved && expires > Date.now() + 60_000 && Date.now() - saved.savedAt < reuseMs) {
        return saved.token;
      }
    } catch {}
    return null;
  }

  async function wispUrl() {
    const endpoint = window.__learn$config?.bare || '/space/';
    const base = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}${endpoint}`;
    let token = storedSession();
    if (!token) {
      sessionPromise ||= fetch('/api/session', {
        credentials: 'same-origin',
        signal: AbortSignal.timeout(6000),
      }).then(async response => {
        if (!response.ok) throw new Error('proxy session unavailable');
        const data = await response.json();
        if (!data.s) throw new Error('proxy session missing');
        try { sessionStorage.setItem(sessionKey, JSON.stringify({ token: data.s, savedAt: Date.now() })); } catch {}
        return data.s;
      }).catch(error => {
        sessionPromise = null;
        throw error;
      });
      try { token = await sessionPromise; }
      finally { sessionPromise = null; }
    }
    return `${base}?s=${encodeURIComponent(token)}`;
  }

  async function ensureTransport(connection) {
    const wisp = await wispUrl();
    let saved;
    try { saved = JSON.parse(sessionStorage.getItem(transportKey) || 'null'); } catch {}
    if (saved?.wisp === wisp && Date.now() - saved.readyAt < reuseMs) {
      try {
        if (await connection.getTransport() === transportPath) return;
      } catch {}
    }
    await connection.setTransport(transportPath, [{ wisp }]);
    try { sessionStorage.setItem(transportKey, JSON.stringify({ wisp, readyAt: Date.now() })); } catch {}
  }

  function loadBareMux() {
    if (window.BareMux) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = '/baremux/index.js';
      script.onload = resolve;
      script.onerror = () => reject(new Error('bare mux unavailable'));
      document.head.appendChild(script);
    });
  }

  function prewarm() {
    if (navigator.serviceWorker && !window._0x6f17e8) {
      window._0x6f17e8 = navigator.serviceWorker
        .register('/sw.js?v=11', { updateViaCache: 'none' })
        .catch(() => null);
    }
    prewarmPromise ||= (async () => {
      await Promise.all([wispUrl(), loadBareMux()]);
      warmConnection = new BareMux.BareMuxConnection('/baremux/worker.js');
      await ensureTransport(warmConnection);
    })().catch(error => {
      prewarmPromise = null;
      console.debug('[anko] proxy warmup deferred:', error);
    });
    return prewarmPromise;
  }

  window._0x5d1c9f = { wispUrl, ensureTransport, prewarm };

  function startOnHome() {
    const search = document.getElementById('mainSearch');
    if (!search) return;
    search.addEventListener('focus', prewarm, { once: true });
    search.addEventListener('pointerenter', prewarm, { once: true });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', startOnHome, { once: true });
  else startOnHome();
})();
