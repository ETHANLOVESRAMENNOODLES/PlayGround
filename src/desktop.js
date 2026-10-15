import { HOME_URL } from './maps.js'
import snapshotHtml from './anko-snapshot.html?raw'

// In-game desktop PC: a working web browser.
// - The homepage (https://h118fb3.chloechu.com/) blocks direct iframe
//   embedding (X-Frame-Options: SAMEORIGIN), so ⌂ loads a bundled,
//   frame-friendly snapshot of it (assets still served live from the site).
// - Any URL typed in the bar loads directly (works for embed-friendly sites).
// - 🛡️ proxy tries a live CORS-relay copy; ↗ tab opens the live site.

function normalizeUrl(raw) {
  raw = (raw || '').trim()
  if (!raw) return HOME_URL
  if (/^https?:\/\//i.test(raw)) return raw
  if (/^[\w-]+(\.[\w-]+)+/.test(raw)) return 'https://' + raw
  // treat as web search on the homepage if it has one, else google
  return 'https://www.google.com/search?q=' + encodeURIComponent(raw)
}

export function createDesktop() {
  const os = document.getElementById('os')
  const frame = document.getElementById('browser-frame')
  const urlBar = document.getElementById('browser-url')
  const note = document.getElementById('browser-note')
  const title = document.getElementById('os-title')
  let open = false
  let booted = false
  let onClose = null
  let mode = { type: 'snapshot', url: HOME_URL } // snapshot | direct | proxy

  function showNote(html) {
    note.innerHTML = html
    note.classList.remove('hidden')
  }
  function hideNote() { note.classList.add('hidden') }

  function paintChrome(url) {
    urlBar.value = url
    title.textContent = '🖥️ desk-pc — ' + url.replace('https://', '').slice(0, 48)
  }

  function withBase(html, url) {
    try {
      const origin = new URL(url).origin + '/'
      if (/<head[^>]*>/i.test(html)) return html.replace(/<head[^>]*>/i, (m) => `${m}<base href="${origin}">`)
      return `<base href="${origin}">` + html
    } catch { return html }
  }

  // Bundled frame-friendly copy of the homepage (the live site refuses
  // all embedding: X-Frame-Options + CORP, so assets are vendored with the
  // game and links/search open the live site in real tabs via the shim).
  function openSnapshot(url) {
    mode = { type: 'snapshot', url }
    paintChrome(url)
    frame.removeAttribute('src')
    // Vendored first-party scripts only (ads/trackers stripped), so
    // allow-same-origin is safe here and enables their localStorage themes.
    frame.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-forms allow-popups allow-modals')
    frame.srcdoc = snapshotDocument()
    showNote('🏠 Start page loaded from the built-in copy (Oct 2026) — the live site blocks embedding. Search & links open the live site in new tabs. <b>↗ tab</b> opens it directly.')
  }

function snapshotDocument() {
    let html = snapshotHtml
    // point vendored assets at the local copies (strip cache-buster queries)
    html = html.replace(/\b(src|href)="(\.\/)?\/?(0\/[^"?#\s]+|icons\/[^"?#\s]+|img\/[^"?#\s]+|fonts\/[^"?#\s]+|particles\.min\.js|proxy-prewarm\.js)(\?[^"#\s]*)?"/g, '$1="./anko/$3"')
    // shim: keep in-embed browsing working — searches & off-page links open
    // the live site in a new tab; backend calls that need their origin are stubbed.
    // (NOTE: the closing tag is assembled to avoid a literal "</script>"
    // inside this template literal, which would break parsing.)
    const shimBody = `(function(){var HOME='https://h118fb3.chloechu.com';
function looksLikeHost(s){return /^[\\w-]+(\\.[\\w-]+)+/.test(s)}
function targetFor(q){q=String(q||'').trim();if(!q)return '';if(/^https?:\\/\\//i.test(q))return q;
if(q.indexOf('//')===0&&looksLikeHost(q.slice(2)))return 'https:'+q;
if(looksLikeHost(q))return 'https://'+q;var e='duckduckgo';
try{e=localStorage.getItem('anko-search-engine')||'duckduckgo'}catch(_){}
var T={duckduckgo:'https://duckduckgo.com/?q=%s',google:'https://www.google.com/search?q=%s',bing:'https://www.bing.com/search?q=%s',brave:'https://search.brave.com/search?q=%s',yandex:'https://yandex.com/search/?text=%s'};
return (T[e]||T.duckduckgo).replace('%s',encodeURIComponent(q))}
document.addEventListener('keydown',function(ev){var t=ev.target;
if(t&&t.id==='mainSearch'&&ev.key==='Enter'){var v=t.value.trim();if(!v)return;
ev.preventDefault();ev.stopPropagation();var u=targetFor(v);if(!u)return;
try{sessionStorage.setItem('anko-last-url',u)}catch(_){}
window.open(u,'_blank','noopener');}},true);
document.addEventListener('click',function(ev){var a=ev.target&&ev.target.closest?ev.target.closest('a'):null;
if(!a||!a.href)return;var hp=a.getAttribute('href')||'';
if(hp.charAt(0)==='#')return;
var dest=a.href;
try{var u=new URL(a.href);if(u.origin===location.origin){dest=HOME+u.pathname+u.search+u.hash;}}catch(_){}
ev.preventDefault();window.open(dest,'_blank','noopener');},true);
document.addEventListener('submit',function(ev){ev.preventDefault();
try{var q=new FormData(ev.target).get('q')||'';window.open(targetFor(q),'_blank','noopener');}catch(_){window.open(HOME,'_blank','noopener');}},true);
try{var _f=window.fetch;window.fetch=function(u,o){try{var s=String((u&&u.url)||u);
if(s.indexOf('/api/')!==-1)return Promise.resolve(new Response('{}',{status:200,headers:{'Content-Type':'application/json'}}));}catch(_){}
return _f.apply(this,arguments)}}catch(_){}})();`
    const shim = '<script>' + shimBody + '<' + '/script>'
    if (/<head[^>]*>/i.test(html)) return html.replace(/<head[^>]*>/i, (m) => `${m}${shim}`)
    return shim + html
  }

  function openDirect(url) {
    mode = { type: 'direct', url }
    paintChrome(url)
    frame.removeAttribute('srcdoc')
    frame.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-forms allow-popups allow-modals allow-downloads')
    frame.src = url
    if (isHome(url)) {
      showNote('Heads up: this homepage blocks direct embedding — you\'ll likely see blank. <b>⌂</b> shows the built-in copy, <b>↗ tab</b> the live site.')
    } else hideNote()
  }

  async function load(url, viaProxy = false) {
    if (isHome(url) && !viaProxy) { openSnapshot(url); return }
    if (viaProxy) { openViaProxy(url); return }
    openDirect(url)
  }

  // Sites that send X-Frame-Options / frame-ancestors can't load in an
  // <iframe> directly. Best-effort workaround: fetch the HTML through a
  // public CORS relay and render it via srcdoc. (Needs internet + a
  // reachable relay; otherwise the note explains the fallbacks.)
  async function openViaProxy(url) {
    mode = { type: 'proxy', url }
    paintChrome(url)
    showNote('🛡️ Proxy mode: fetching a live frame-friendly copy…')
    frame.removeAttribute('src')
    frame.setAttribute('sandbox', 'allow-scripts allow-forms allow-popups allow-modals allow-downloads')
    const relays = [
      'https://api.allorigins.win/raw?url=',
      'https://api.codetabs.com/v1/proxy?quest='
    ]
    let html = ''
    let ok = false
    for (const relay of relays) {
      try {
        const ctrl = new AbortController()
        const timer = setTimeout(() => ctrl.abort(), 25000)
        const res = await fetch(relay + encodeURIComponent(url), { signal: ctrl.signal })
        clearTimeout(timer)
        if (!res.ok) continue
        const text = await res.text()
        if (!text || text.length < 200) continue
        html = text
        ok = true
        break
      } catch { /* try next relay */ }
    }
    if (!ok) {
      showNote('⚠️ Live proxy fetch failed (relay unreachable from here). The <b>⌂</b> copy still works, and <b>↗ tab</b> opens the live site.')
      openSnapshot(url)
      return
    }
    frame.srcdoc = withBase(html, url)
    showNote('🛡️ Proxy mode on — live copy of the page. <b>⌂</b> returns to the built-in copy; <b>↗ tab</b> opens the live site.')
  }

  function isHome(url) {
    return url.includes('h118fb3.chloechu.com')
  }

  function boot() {
    if (booted) return
    booted = true
    load(HOME_URL)
    // clock
    const clock = document.getElementById('os-clock')
    setInterval(() => {
      clock.textContent = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    }, 1000)
  }

  document.getElementById('bb-go').onclick = () => load(normalizeUrl(urlBar.value))
  urlBar.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') load(normalizeUrl(urlBar.value))
    e.stopPropagation()
  })
  ;['bb-back', 'bb-fwd', 'bb-reload', 'bb-home', 'bb-proxy', 'bb-tab'].forEach(id => {
    document.getElementById(id).addEventListener('keydown', e => e.stopPropagation())
  })
  document.getElementById('bb-back').onclick = () => { try { frame.contentWindow.history.back() } catch {} }
  document.getElementById('bb-fwd').onclick = () => { try { frame.contentWindow.history.forward() } catch {} }
  document.getElementById('bb-reload').onclick = () => {
    if (mode.type === 'snapshot') openSnapshot(mode.url)
    else if (mode.type === 'proxy') openViaProxy(mode.url)
    else openDirect(mode.url)
  }
  document.getElementById('bb-home').onclick = () => load(HOME_URL)
  document.getElementById('bb-proxy').onclick = () => load(normalizeUrl(urlBar.value || HOME_URL), true)
  document.getElementById('bb-tab').onclick = () => window.open(normalizeUrl(urlBar.value || HOME_URL), '_blank', 'noopener')
  document.getElementById('os-close').onclick = () => close()
  document.getElementById('os-notes-app').onclick = (e) => {
    document.getElementById('os-notes').classList.toggle('hidden')
    document.querySelectorAll('.os-app').forEach(a => a.classList.remove('active'))
    e.target.classList.add('active')
  }
  document.getElementById('os-help-app').onclick = () => {
    load(HOME_URL)
    showNote('This is a real browser: type any URL + Go. Start page is the room homepage. Esc / Stand up returns to first-person.')
  }
  document.getElementById('notes-text').addEventListener('keydown', e => e.stopPropagation())

  function openPc(closeCb) {
    onClose = closeCb || null
    boot()
    os.classList.remove('hidden')
    open = true
    if (document.pointerLockElement) document.exitPointerLock()
  }
  function close() {
    os.classList.add('hidden')
    open = false
    if (onClose) { const cb = onClose; onClose = null; cb() }
  }
  function isOpen() { return open }

  return { openPc, close, isOpen, load, home: () => load(HOME_URL) }
}
