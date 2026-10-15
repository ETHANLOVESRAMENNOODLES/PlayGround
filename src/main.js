import * as THREE from 'three'
import { MAPS, BUILDERS } from './maps.js'
import { createNet } from './net.js'
import { createDesktop } from './desktop.js'

// ---------------- lobby state ----------------
const $ = (id) => document.getElementById(id)
const params = new URLSearchParams(location.search)
let playerName = ''
let roomCode = params.get('room') || ''
let avatarColor = '#7c6cff'
let currentMapId = 'bedroom'
let net = null
let joined = false

const AVATAR_COLORS = ['#7c6cff', '#37e0b0', '#ff5f7a', '#e0a437', '#4aa8ff', '#ff8c2e', '#c084fc', '#f4f4f5']

function randomRoom() {
  const words = ['moon', 'den', 'loft', 'nebula', 'cabin', 'arcade', 'garden', 'harbor']
  return `${words[Math.floor(Math.random() * words.length)]}-${Math.floor(1000 + Math.random() * 9000)}`
}

function renderMapCards(elId, onPick) {
  const el = $(elId)
  el.innerHTML = ''
  for (const m of MAPS) {
    const d = document.createElement('div')
    d.className = 'map-card' + (m.id === currentMapId ? ' sel' : '')
    d.innerHTML = `<div class="swatch" style="background:${m.swatch}"></div><b>${m.name}</b><small>${m.desc}</small>`
    d.onclick = () => { onPick(m.id) }
    el.appendChild(d)
  }
}

function paintLobby() {
  const cc = $('avatar-colors')
  cc.innerHTML = ''
  for (const c of AVATAR_COLORS) {
    const b = document.createElement('button')
    b.style.background = c
    if (c === avatarColor) b.classList.add('sel')
    b.onclick = () => { avatarColor = c; paintLobby() }
    cc.appendChild(b)
  }
  renderMapCards('map-list', (id) => { currentMapId = id; paintLobby() })
  renderMapCards('map-list-ingame', (id) => pickMap(id, true))
}

// ---------------- three.js setup ----------------
const canvas = $('scene')
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true })
renderer.setPixelRatio(Math.min(devicePixelRatio, 2))
renderer.setSize(innerWidth, innerHeight)
renderer.shadowMap.enabled = true
renderer.shadowMap.type = THREE.PCFSoftShadowMap

const scene = new THREE.Scene()
scene.background = new THREE.Color(0x0b0e17)
const camera = new THREE.PerspectiveCamera(75, innerWidth / innerHeight, 0.05, 200)

const hemi = new THREE.HemisphereLight(0xdfe6ff, 0x1a1d30, 0.9)
scene.add(hemi)
const sun = new THREE.DirectionalLight(0xffffff, 1.2)
sun.position.set(6, 10, 4)
sun.castShadow = true
sun.shadow.mapSize.set(1024, 1024)
scene.add(sun)
let extraLights = []

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight
  camera.updateProjectionMatrix()
  renderer.setSize(innerWidth, innerHeight)
})

let mapGroup = null
let colliders = []
let bounds = { x: 5, z: 4 }
let screens = []
let spawns = [[0, 3]]
let flameMesh = null
let danceTiles = []

function clearMap() {
  if (mapGroup) {
    scene.remove(mapGroup)
    mapGroup.traverse(o => {
      if (o.geometry) o.geometry.dispose()
      if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => { if (m.map) m.map.dispose(); m.dispose() })
    })
  }
  for (const l of extraLights) scene.remove(l)
  extraLights = []
  danceTiles = []
  flameMesh = null
}

function applyAtmosphere(mode) {
  if (mode === 'neon') {
    scene.background = new THREE.Color(0x07060f)
    scene.fog = new THREE.Fog(0x07060f, 18, 46)
    hemi.intensity = 0.35
    sun.intensity = 0.15
    const a = new THREE.PointLight(0xff2fb3, 30, 24); a.position.set(-5, 3.4, 0); scene.add(a); extraLights.push(a)
    const b = new THREE.PointLight(0x37e0ff, 30, 24); b.position.set(5, 3.4, 0); scene.add(b); extraLights.push(b)
  } else if (mode === 'day') {
    scene.background = new THREE.Color(0x87bfe8)
    scene.fog = new THREE.Fog(0x87bfe8, 25, 70)
    hemi.intensity = 1.1
    sun.intensity = 2.2
    sun.color.set(0xfff2d9)
  } else if (mode === 'warm') {
    scene.background = new THREE.Color(0x0b0e17)
    scene.fog = null
    hemi.intensity = 0.75
    sun.intensity = 0.7
    const w = new THREE.PointLight(0xffd9a0, 18, 16); w.position.set(0, 2.8, 1); scene.add(w); extraLights.push(w)
  } else {
    scene.background = new THREE.Color(0x0b0e17)
    scene.fog = null
    hemi.intensity = 0.9
    sun.intensity = 1.2
    sun.color.set(0xffffff)
  }
}

function loadMap(mapId, spawnIdx = 0) {
  currentMapId = mapId
  clearMap()
  const built = BUILDERS[mapId]()
  mapGroup = built.group
  scene.add(mapGroup)
  colliders = built.colliders
  bounds = built.bounds
  screens = built.screens
  spawns = built.spawns
  flameMesh = built.flame || null
  mapGroup.traverse(o => { if (o.userData && o.userData.dance) danceTiles.push(o) })
  applyAtmosphere(built.lights)
  const s = spawns[spawnIdx % spawns.length]
  player.pos.set(s[0], EYE, s[1])
  player.vel.set(0, 0, 0)
  player.yaw = 0
  player.pitch = 0
  $('hud-map').textContent = '· ' + (MAPS.find(m => m.id === mapId)?.name || mapId)
  paintLobby()
}

// ---------------- player controller ----------------
const EYE = 1.65
const RADIUS = 0.35
const player = {
  pos: new THREE.Vector3(0, EYE, 3.5),
  vel: new THREE.Vector3(),
  yaw: Math.PI,
  pitch: 0,
  grounded: true
}
const keys = {}
let locked = false

function collides(x, z) {
  if (Math.abs(x) > bounds.x || Math.abs(z) > bounds.z) return true
  for (const c of colliders) {
    if (x > c.x1 - RADIUS && x < c.x2 + RADIUS && z > c.z1 - RADIUS && z < c.z2 + RADIUS) return true
  }
  return false
}

document.addEventListener('keydown', (e) => {
  if (document.activeElement === $('chat-input')) return
  if (document.activeElement && ['INPUT', 'TEXTAREA'].includes(document.activeElement.tagName)) return
  keys[e.code] = true
  if (!joined) return
  if (e.code === 'KeyT' || (e.code === 'Enter' && $('chat-box').classList.contains('hidden'))) {
    e.preventDefault()
    openChat()
  } else if (e.code === 'KeyM') {
    toggleMute()
  } else if (e.code === 'KeyE') {
    if (nearScreen && !desktop.isOpen()) {
      desktop.openPc(() => { canvas.requestPointerLock?.() })
    }
  }
})
document.addEventListener('keyup', (e) => { keys[e.code] = false })

canvas.addEventListener('click', () => {
  if (!joined || desktop.isOpen()) return
  if (!$('chat-box').classList.contains('hidden')) return
  if (!$('map-modal').classList.contains('hidden') || !$('help-modal').classList.contains('hidden')) return
  if (!locked) canvas.requestPointerLock?.()
})
document.addEventListener('pointerlockchange', () => {
  locked = document.pointerLockElement === canvas
  $('lock-tip').style.display = locked ? 'none' : 'block'
  $('crosshair').classList.toggle('hidden', !locked && joined)
})
document.addEventListener('mousemove', (e) => {
  if (!locked || !joined || desktop.isOpen()) return
  player.yaw -= e.movementX * 0.0023
  player.pitch -= e.movementY * 0.0023
  player.pitch = Math.max(-1.45, Math.min(1.45, player.pitch))
})

function stepPlayer(dt) {
  const sprint = (keys.ShiftLeft || keys.ShiftRight) ? 1.7 : 1
  const speed = 4.2 * sprint
  const f = new THREE.Vector3(-Math.sin(player.yaw), 0, -Math.cos(player.yaw))
  const r = new THREE.Vector3(-f.z, 0, f.x)
  const wish = new THREE.Vector3()
  if (keys.KeyW || keys.ArrowUp) wish.add(f)
  if (keys.KeyS || keys.ArrowDown) wish.sub(f)
  if (keys.KeyD || keys.ArrowRight) wish.add(r)
  if (keys.KeyA || keys.ArrowLeft) wish.sub(r)
  if (wish.lengthSq() > 0) wish.normalize().multiplyScalar(speed)
  // smooth accel
  player.vel.x += (wish.x - player.vel.x) * Math.min(1, dt * 10)
  player.vel.z += (wish.z - player.vel.z) * Math.min(1, dt * 10)
  // gravity / jump
  player.vel.y -= 14 * dt
  if ((keys.Space) && player.grounded) { player.vel.y = 5.2; player.grounded = false }
  // integrate with per-axis collision
  const nx = player.pos.x + player.vel.x * dt
  if (!collides(nx, player.pos.z)) player.pos.x = nx
  else player.vel.x = 0
  const nz = player.pos.z + player.vel.z * dt
  if (!collides(player.pos.x, nz)) player.pos.z = nz
  else player.vel.z = 0
  let ny = player.pos.y + player.vel.y * dt
  if (ny <= EYE) { ny = EYE; player.vel.y = 0; player.grounded = true }
  player.pos.y = ny
  camera.position.copy(player.pos)
  camera.rotation.set(0, 0, 0)
  camera.rotateY(player.yaw)
  camera.rotateX(player.pitch)
}

// ---------------- avatars ----------------
const peers = new Map() // peerId -> {group, bodyMat, sprite, target, lastSeen, profile, audio}
function makeNameSprite(name, color) {
  const c = document.createElement('canvas')
  c.width = 256; c.height = 64
  const x = c.getContext('2d')
  x.fillStyle = 'rgba(8,10,20,.75)'
  x.beginPath(); x.roundRect(28, 8, 200, 44, 12); x.fill()
  x.fillStyle = color
  x.beginPath(); x.arc(52, 30, 10, 0, 7); x.fill()
  x.fillStyle = '#fff'
  x.font = 'bold 22px sans-serif'
  x.textAlign = 'left'
  x.fillText((name || 'guest').slice(0, 10), 70, 38)
  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false }))
  sp.scale.set(1.6, 0.4, 1)
  sp.position.y = 2.15
  return sp
}

function ensurePeer(peerId, profile = {}) {
  let p = peers.get(peerId)
  if (!p) {
    const group = new THREE.Group()
    const color = profile.color || '#4aa8ff'
    const bodyMat = new THREE.MeshStandardMaterial({ color, roughness: 0.7 })
    const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.32, 0.75, 6, 14), bodyMat)
    body.position.y = 0.95
    body.castShadow = true
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.26, 18, 14), new THREE.MeshStandardMaterial({ color: 0xf2c9a0, roughness: 0.8 }))
    head.position.y = 1.78
    head.castShadow = true
    const visor = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.1, 0.05), new THREE.MeshStandardMaterial({ color: 0x11142a }))
    visor.position.set(0, 1.8, 0.24)
    group.add(body, head, visor)
    const sprite = makeNameSprite(profile.name || 'guest', color)
    group.add(sprite)
    group.visible = false
    scene.add(group)
    p = { group, bodyMat, sprite, target: null, lastSeen: 0, profile, audio: null }
    peers.set(peerId, p)
    updatePeerCount()
  }
  return p
}

function updatePeerCount() {
  $('peer-count').textContent = String(peers.size + 1)
}

function removePeer(peerId) {
  const p = peers.get(peerId)
  if (!p) return
  scene.remove(p.group)
  if (p.audio) p.audio.remove()
  peers.delete(peerId)
  updatePeerCount()
  toast('👋 a friend left')
}

// ---------------- chat / toast ----------------
function toast(msg) {
  const t = document.createElement('div')
  t.className = 'toast'
  t.textContent = msg
  $('toast-holder').appendChild(t)
  setTimeout(() => t.remove(), 3100)
}

function addChat(name, color, text, sys = false) {
  const el = document.createElement('div')
  el.className = 'chat-msg' + (sys ? ' sys' : '')
  if (sys) el.textContent = text
  else {
    const b = document.createElement('b')
    b.textContent = name
    b.style.color = color
    el.appendChild(b)
    el.appendChild(document.createTextNode(text))
  }
  const log = $('chat-log')
  log.appendChild(el)
  while (log.children.length > 60) log.firstChild.remove()
  log.scrollTop = log.scrollHeight
}

function openChat() {
  $('chat-box').classList.remove('hidden')
  $('chat-log').style.bottom = '64px'
  setTimeout(() => $('chat-input').focus(), 0)
}
function closeChat() {
  $('chat-box').classList.add('hidden')
  $('chat-log').style.bottom = '12px'
  $('chat-input').value = ''
  $('chat-input').blur()
}
$('chat-input').addEventListener('keydown', (e) => {
  e.stopPropagation()
  if (e.key === 'Enter' && e.target.value.trim()) {
    const text = e.target.value.trim().slice(0, 200)
    net?.sendChat({ name: playerName, color: avatarColor, text, t: Date.now() })
    addChat(playerName, avatarColor, text)
    closeChat()
    canvas.requestPointerLock?.()
  } else if (e.key === 'Escape') {
    closeChat()
  }
})

// ---------------- voice ----------------
let micStream = null
let muted = false
let analyser = null
let audioCtx = null

async function startVoice() {
  try {
    micStream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } })
    net?.addStream(micStream)
    audioCtx = new (window.AudioContext || window.webkitAudioContext)()
    const src = audioCtx.createMediaStreamSource(micStream)
    analyser = audioCtx.createAnalyser()
    analyser.fftSize = 512
    src.connect(analyser)
    $('mute-label').textContent = 'Voice on'
  } catch (e) {
    console.warn('mic denied/unavailable', e)
    $('mute-label').textContent = 'Voice blocked'
    toast('🎙️ Mic blocked — text chat still works (T)')
  }
}

function toggleMute() {
  if (!micStream) { toast('🎙️ No mic yet — allow microphone to talk'); return }
  muted = !muted
  micStream.getAudioTracks().forEach(t => { t.enabled = !muted })
  $('mute-label').textContent = muted ? 'Muted' : 'Voice on'
  $('mute-pill').textContent = muted ? '🔇 Muted' : '🎙️ Voice on'
}
$('mute-pill').onclick = toggleMute

// ---------------- desktop ----------------
const desktop = createDesktop()
let nearScreen = null
const ray = new THREE.Raycaster()
function checkInteract() {
  nearScreen = null
  if (!joined || desktop.isOpen()) { $('interact-prompt').classList.add('hidden'); return }
  ray.setFromCamera({ x: 0, y: 0 }, camera)
  ray.far = 3.5
  const hits = ray.intersectObjects(screens, false)
  if (hits.length) {
    nearScreen = hits[0].object
    $('interact-prompt').classList.remove('hidden')
  } else $('interact-prompt').classList.add('hidden')
}
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && desktop.isOpen()) desktop.close()
})

// ---------------- HUD wiring ----------------
$('room-pill').onclick = async () => {
  const link = `${location.origin}${location.pathname}?room=${encodeURIComponent(roomCode)}`
  try { await navigator.clipboard.writeText(link); toast('🔗 Invite link copied — share it!') }
  catch { prompt('Share this invite link:', link) }
}
$('maps-pill').onclick = () => $('map-modal').classList.remove('hidden')
$('map-close').onclick = () => $('map-modal').classList.add('hidden')
$('help-pill').onclick = () => $('help-modal').classList.remove('hidden')
$('help-close').onclick = () => $('help-modal').classList.add('hidden')
$('leave-pill').onclick = () => { try { net?.leave() } catch {} location.reload() }

function pickMap(id, broadcast) {
  if (id === currentMapId && broadcast) { $('map-modal').classList.add('hidden'); return }
  if (broadcast && net) net.sendMap({ mapId: id, by: playerName })
  loadMap(id, 0)
  $('map-modal').classList.add('hidden')
  if (broadcast) toast(`🗺️ switched to ${MAPS.find(m => m.id === id)?.name}`)
}

// ---------------- join flow ----------------
function selfProfile() { return { name: playerName, color: avatarColor } }

$('random-room').onclick = () => { $('room-input').value = randomRoom() }
if (roomCode) $('room-input').value = roomCode
paintLobby()

$('join-btn').onclick = async () => {
  playerName = ($('name-input').value.trim() || 'guest' + Math.floor(Math.random() * 99)).slice(0, 16)
  roomCode = ($('room-input').value.trim() || randomRoom()).toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 24) || randomRoom()
  loadMap(currentMapId, Math.floor(Math.random() * 4))
  $('lobby').classList.add('hidden')
  $('hud').classList.remove('hidden')
  $('hud-room').textContent = roomCode
  joined = true
  history.replaceState(null, '', `?room=${encodeURIComponent(roomCode)}`)
  toast(`🚪 welcome to “${roomCode}”, ${playerName}!`)
  addChat('', '', `You joined “${roomCode}”. Click the game to lock the mouse. Walk to the desk by the bed and press E for the browser.`, true)
  startVoice()
  try {
    net = await createNet(roomCode, {
      selfProfile,
      onPos: (peerId, d) => {
        if (!Array.isArray(d) || d.length < 4) return
        const p = ensurePeer(peerId)
        p.target = { x: d[0], y: d[1], z: d[2], yaw: d[3] }
        p.lastSeen = performance.now()
        p.group.visible = true
      },
      onProfile: (peerId, d) => {
        if (!d) return
        const p = ensurePeer(peerId, d)
        p.profile = { ...p.profile, ...d }
        p.bodyMat.color.set(d.color || '#4aa8ff')
        p.group.remove(p.sprite)
        p.sprite = makeNameSprite(d.name || 'guest', d.color || '#4aa8ff')
        p.group.add(p.sprite)
      },
      onChat: (_peerId, d) => { if (d && d.text) addChat(d.name || 'guest', d.color || '#fff', d.text) },
      onMap: (_peerId, d) => {
        if (d && d.mapId && BUILDERS[d.mapId] && d.mapId !== currentMapId) {
          loadMap(d.mapId, 0)
          toast(`🗺️ ${d.by || 'a friend'} switched map to ${MAPS.find(m => m.id === d.mapId)?.name}`)
        }
      },
      onJoin: (peerId) => {
        ensurePeer(peerId)
        toast('🎉 a friend joined!')
        addChat('', '', 'A friend joined the room.', true)
        // tell the newcomer who we are + which map the room uses
        setTimeout(() => {
          net?.sendProfile(selfProfile())
          net?.sendMap({ mapId: currentMapId, by: playerName })
        }, 800)
      },
      onLeave: (peerId) => removePeer(peerId),
      onStream: (stream, peerId) => {
        const p = ensurePeer(peerId)
        if (p.audio) p.audio.remove()
        const a = document.createElement('audio')
        a.autoplay = true
        a.playsInline = true
        a.srcObject = stream
        document.body.appendChild(a)
        a.play().catch(() => {})
        p.audio = a
        const pill = document.createElement('div')
        pill.className = 'speaker'
        pill.id = `spk-${peerId}`
        pill.textContent = `🔊 ${(p.profile && p.profile.name) || 'friend'} talking`
        $('speaking').appendChild(pill)
      }
    })
    net.sendProfile(selfProfile())
  } catch (e) {
    console.warn('P2P unavailable, solo mode', e)
    toast('⚠️ P2P network blocked — exploring solo. Chat/voice need internet.')
  }
}

// ---------------- main loop ----------------
const clock = new THREE.Clock()
let posTimer = 0
const data = new Uint8Array(64)

loadMap('bedroom', 0) // pre-load backdrop behind lobby

function animate() {
  requestAnimationFrame(animate)
  const dt = Math.min(clock.getDelta(), 0.05)
  const t = clock.elapsedTime
  if (joined && !desktop.isOpen()) stepPlayer(dt)
  else {
    camera.position.copy(player.pos)
    camera.rotation.set(0, 0, 0)
    camera.rotateY(player.yaw)
    camera.rotateX(player.pitch)
  }
  checkInteract()
  // interpolate peers
  for (const [, p] of peers) {
    if (!p.target) continue
    p.group.position.x += (p.target.x - p.group.position.x) * Math.min(1, dt * 8)
    p.group.position.z += (p.target.z - p.group.position.z) * Math.min(1, dt * 8)
    p.group.position.y += ((p.target.y - EYE) - p.group.position.y) * Math.min(1, dt * 8)
    p.group.rotation.y = p.target.yaw + Math.PI
    if (performance.now() - p.lastSeen > 15000) p.group.visible = false
  }
  // broadcast position ~15 Hz
  posTimer += dt
  if (joined && net && posTimer > 0.066) {
    posTimer = 0
    net.sendPos([+player.pos.x.toFixed(2), +player.pos.y.toFixed(2), +player.pos.z.toFixed(2), +player.yaw.toFixed(2)])
  }
  // dance floor pulse + flame flicker
  danceTiles.forEach((tile, i) => {
    tile.material.emissiveIntensity = 0.6 + 0.5 * Math.abs(Math.sin(t * 2 + i))
  })
  if (flameMesh) flameMesh.scale.setScalar(1 + 0.12 * Math.sin(t * 9) + 0.05 * Math.sin(t * 23))
  // local speaking indicator
  if (analyser && !muted) {
    analyser.getByteTimeDomainData(data)
    let v = 0
    for (let i = 0; i < data.length; i++) v += Math.abs(data[i] - 128)
    v /= data.length
    const el = $('speaking')
    let me = document.getElementById('spk-me')
    if (v > 6) {
      if (!me) { me = document.createElement('div'); me.className = 'speaker'; me.id = 'spk-me'; me.textContent = '🎙️ you are talking'; el.appendChild(me) }
    } else if (me) me.remove()
  }
  renderer.render(scene, camera)
}
animate()

// debug/testing handle (also handy in the console)
window.__rooms = { desktop, pickMap, loadMap, player, get peers() { return peers } }
