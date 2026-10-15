import * as THREE from 'three'

export const HOME_URL = 'https://h118fb3.chloechu.com/'

export const MAPS = [
  {
    id: 'bedroom',
    name: '🛏️ Bedroom',
    desc: 'Cozy room. Desk + browser by the bed.',
    swatch: 'linear-gradient(135deg,#3b4a7a,#7c6cff)',
    size: { w: 12, d: 10 }
  },
  {
    id: 'loft',
    name: '🏙️ Loft Studio',
    desc: 'Open loft with kitchen, sofa & desk.',
    swatch: 'linear-gradient(135deg,#7a5b3b,#e0a437)',
    size: { w: 18, d: 14 }
  },
  {
    id: 'club',
    name: '🪩 Neon Club',
    desc: 'Dark dance floor, stage & booths.',
    swatch: 'linear-gradient(135deg,#4d1a5e,#ff2fb3)',
    size: { w: 20, d: 16 }
  },
  {
    id: 'deck',
    name: '🌤️ Sky Deck',
    desc: 'Open-air courtyard under the sky.',
    swatch: 'linear-gradient(135deg,#1e6f8e,#37e0b0)',
    size: { w: 16, d: 16 }
  }
]

// ---------- helpers ----------
function box(w, h, d, color, x = 0, y = 0, z = 0, opts = {}) {
  const m = new THREE.Mesh(
    new THREE.BoxGeometry(w, h, d),
    new THREE.MeshStandardMaterial({ color, roughness: opts.rough ?? 0.85, metalness: opts.metal ?? 0.05, emissive: opts.emissive ?? 0x000000, emissiveIntensity: opts.ei ?? 1 })
  )
  m.position.set(x, y, z)
  if (opts.ry) m.rotation.y = opts.ry
  m.castShadow = opts.shadow ?? false
  m.receiveShadow = true
  return m
}

function colliderFor(w, d, x, z) {
  return { x1: x - w / 2, x2: x + w / 2, z1: z - d / 2, z2: z + d / 2 }
}

function roomShell(g, colliders, W, D, H, palette, opts = {}) {
  const t = 0.3
  // floor
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(W, D),
    new THREE.MeshStandardMaterial({ color: palette.floor, roughness: 0.9 })
  )
  floor.rotation.x = -Math.PI / 2
  floor.receiveShadow = true
  g.add(floor)
  // ceiling (skipped for open-air maps)
  if (opts.ceiling !== false) {
    const ceil = new THREE.Mesh(
      new THREE.PlaneGeometry(W, D),
      new THREE.MeshStandardMaterial({ color: palette.ceil, roughness: 1 })
    )
    ceil.rotation.x = Math.PI / 2
    ceil.position.y = H
    g.add(ceil)
  }
  // walls
  const wallMat = new THREE.MeshStandardMaterial({ color: palette.wall, roughness: 0.95 })
  const mk = (w, h, d, x, y, z) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), wallMat)
    m.position.set(x, y, z)
    m.receiveShadow = true
    g.add(m)
  }
  mk(W + t * 2, H, t, 0, H / 2, -D / 2 - t / 2)
  mk(W + t * 2, H, t, 0, H / 2, D / 2 + t / 2)
  mk(t, H, D, -W / 2 - t / 2, H / 2, 0)
  mk(t, H, D, W / 2 + t / 2, H / 2, 0)
  // wall trim / baseboard glow
  const trim = box(W, 0.08, D, palette.trim ?? 0x222a45, 0, 0.04, 0)
  trim.scale.set(0.995, 1, 0.995)
  // keep floor visible: make trim a thin frame using 4 boxes instead
  g.remove(trim)
  const tw = 0.12
  g.add(box(W, 0.1, tw, palette.trim ?? 0x2a3358, 0, 0.05, -D / 2 + tw / 2))
  g.add(box(W, 0.1, tw, palette.trim ?? 0x2a3358, 0, 0.05, D / 2 - tw / 2))
  g.add(box(tw, 0.1, D, palette.trim ?? 0x2a3358, -W / 2 + tw / 2, 0.05, 0))
  g.add(box(tw, 0.1, D, palette.trim ?? 0x2a3358, W / 2 - tw / 2, 0.05, 0))
}

function drawScreenTexture(title = 'anko', url = HOME_URL) {
  const c = document.createElement('canvas')
  c.width = 512
  c.height = 320
  const x = c.getContext('2d')
  x.fillStyle = '#10142a'
  x.fillRect(0, 0, 512, 320)
  x.fillStyle = '#1d2440'
  x.fillRect(0, 0, 512, 44)
  x.fillStyle = '#ff5f57'
  x.beginPath(); x.arc(24, 22, 7, 0, 7); x.fill()
  x.fillStyle = '#febc2e'
  x.beginPath(); x.arc(46, 22, 7, 0, 7); x.fill()
  x.fillStyle = '#28c840'
  x.beginPath(); x.arc(68, 22, 7, 0, 7); x.fill()
  x.fillStyle = '#0b0e1c'
  x.fillRect(92, 10, 340, 24)
  x.fillStyle = '#9aa3c0'
  x.font = '13px sans-serif'
  x.fillText(url.replace('https://', '').slice(0, 40), 100, 27)
  x.fillStyle = '#eef1ff'
  x.font = 'bold 54px sans-serif'
  x.textAlign = 'center'
  x.fillText(title, 256, 150)
  x.fillStyle = '#7c6cff'
  x.fillRect(156, 180, 200, 40)
  x.fillStyle = '#fff'
  x.font = 'bold 18px sans-serif'
  x.fillText('search', 256, 206)
  x.fillStyle = '#9aa3c0'
  x.font = '14px sans-serif'
  x.fillText('press  E  to use this PC', 256, 250)
  x.fillText('working browser inside', 256, 272)
  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  return tex
}

/** Shared desk + computer builder. Returns the screen mesh (raycast target). */
function buildDeskSetup(g, colliders, { x, z, ry = 0, title }) {
  const grp = new THREE.Group()
  grp.position.set(x, 0, z)
  grp.rotation.y = ry
  // desk top + legs
  const top = box(2.2, 0.08, 0.9, 0x6b4f35, 0, 0.74, 0)
  grp.add(top)
  for (const [lx, lz] of [[-1, -0.35], [1, -0.35], [-1, 0.35], [1, 0.35]]) {
    grp.add(box(0.07, 0.74, 0.07, 0x3d2d1e, lx, 0.37, lz))
  }
  // monitor stand + screen
  grp.add(box(0.3, 0.06, 0.24, 0x14161f, 0, 0.81, -0.05))
  grp.add(box(0.08, 0.32, 0.08, 0x14161f, 0, 0.98, -0.08))
  const screen = new THREE.Mesh(
    new THREE.BoxGeometry(1.15, 0.7, 0.06),
    new THREE.MeshStandardMaterial({ color: 0x0a0c16, roughness: 0.4 })
  )
  screen.position.set(0, 1.32, -0.1)
  grp.add(screen)
  const glow = new THREE.Mesh(
    new THREE.PlaneGeometry(1.05, 0.6),
    new THREE.MeshBasicMaterial({ map: drawScreenTexture(title) })
  )
  glow.position.set(0, 1.32, -0.065)
  grp.add(glow)
  // keyboard + mug
  grp.add(box(0.7, 0.03, 0.24, 0x1b2036, 0, 0.8, 0.22))
  const mug = new THREE.Mesh(
    new THREE.CylinderGeometry(0.05, 0.045, 0.12, 16),
    new THREE.MeshStandardMaterial({ color: 0x37e0b0 })
  )
  mug.position.set(0.85, 0.84, 0.1)
  grp.add(mug)
  // chair
  grp.add(box(0.55, 0.08, 0.55, 0x232a4d, 0, 0.5, 1.0))
  grp.add(box(0.55, 0.7, 0.08, 0x232a4d, 0, 0.9, 1.28))
  grp.add(box(0.07, 0.5, 0.07, 0x11142a, 0, 0.25, 1.0))
  // desk light glow
  const lamp = new THREE.PointLight(0x9db4ff, 6, 6)
  lamp.position.set(0, 2.1, 0.4)
  grp.add(lamp)
  g.add(grp)
  // collider for whole desk footprint in world space (approx, ignores rotation for simplicity by using rotated corners)
  const cos = Math.cos(ry), sin = Math.sin(ry)
  const corners = []
  for (const [lx, lz] of [[-1.2, -0.6], [1.2, -0.6], [-1.2, 1.5], [1.2, 1.5]]) {
    corners.push([x + lx * cos + lz * sin, z - lx * sin + lz * cos])
  }
  const xs = corners.map(c => c[0]), zs = corners.map(c => c[1])
  colliders.push({ x1: Math.min(...xs), x2: Math.max(...xs), z1: Math.min(...zs), z2: Math.max(...zs) })
  screen.userData.isScreen = true
  return screen
}

function buildBed(g, colliders, { x, z, ry = 0, blanket = 0x7c6cff }) {
  const grp = new THREE.Group()
  grp.position.set(x, 0, z)
  grp.rotation.y = ry
  grp.add(box(2.2, 0.35, 3.2, 0x4a3826, 0, 0.28, 0)) // frame
  grp.add(box(2.0, 0.3, 3.0, 0xdfe6ff, 0, 0.55, 0)) // mattress
  grp.add(box(2.02, 0.12, 1.6, blanket, 0, 0.66, 0.6)) // blanket
  grp.add(box(1.5, 0.18, 0.6, 0xffffff, 0, 0.68, -1.0)) // pillow
  grp.add(box(2.2, 1.0, 0.15, 0x4a3826, 0, 0.6, -1.65)) // headboard
  // bedside rug
  const rug = new THREE.Mesh(
    new THREE.CircleGeometry(1.1, 28),
    new THREE.MeshStandardMaterial({ color: 0x2a3358, roughness: 1 })
  )
  rug.rotation.x = -Math.PI / 2
  rug.position.set(0, 0.02, 2.4)
  rug.receiveShadow = true
  grp.add(rug)
  g.add(grp)
  const cos = Math.cos(ry), sin = Math.sin(ry)
  const corners = []
  for (const [lx, lz] of [[-1.1, -1.7], [1.1, -1.7], [-1.1, 1.7], [1.1, 1.7]]) {
    corners.push([x + lx * cos + lz * sin, z - lx * sin + lz * cos])
  }
  const xs = corners.map(c => c[0]), zs = corners.map(c => c[1])
  colliders.push({ x1: Math.min(...xs), x2: Math.max(...xs), z1: Math.min(...zs), z2: Math.max(...zs) })
}

function poster(g, text, color, x, y, z, ry = 0) {
  const c = document.createElement('canvas')
  c.width = 256; c.height = 340
  const p = c.getContext('2d')
  p.fillStyle = color
  p.fillRect(0, 0, 256, 340)
  p.fillStyle = 'rgba(255,255,255,.92)'
  p.font = 'bold 44px sans-serif'
  p.textAlign = 'center'
  const words = text.split(' ')
  words.forEach((w, i) => p.fillText(w, 128, 140 + i * 52))
  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  const m = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 1.2), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.9 }))
  m.position.set(x, y, z)
  m.rotation.y = ry
  g.add(m)
}

// ---------- map builders ----------
function buildBedroom() {
  const g = new THREE.Group()
  const colliders = []
  const W = 12, D = 10, H = 3.2
  roomShell(g, colliders, W, D, H, { floor: 0x8a7358, wall: 0x3d466e, ceil: 0x232a4d, trim: 0x7c6cff })
  // bed in the corner, desk right BY the bed
  buildBed(g, colliders, { x: -3.4, z: -2.6, ry: 0, blanket: 0x7c6cff })
  // nightstand between bed and desk
  g.add(box(0.7, 0.55, 0.7, 0x4a3826, -1.6, 0.28, -4.2))
  colliders.push(colliderFor(0.7, 0.7, -1.6, -4.2))
  const lampShade = new THREE.Mesh(
    new THREE.ConeGeometry(0.28, 0.35, 18, 1, true),
    new THREE.MeshStandardMaterial({ color: 0xffd88a, emissive: 0xffb84d, emissiveIntensity: 0.9, side: THREE.DoubleSide })
  )
  lampShade.position.set(-1.6, 1.0, -4.2)
  g.add(lampShade)
  const lampLight = new THREE.PointLight(0xffc46b, 12, 9)
  lampLight.position.set(-1.6, 1.4, -4.2)
  g.add(lampLight)

  const screen = buildDeskSetup(g, colliders, { x: 0.6, z: -4.2, ry: 0, title: 'anko' })
  // rug center
  const rug = new THREE.Mesh(new THREE.CircleGeometry(1.8, 32), new THREE.MeshStandardMaterial({ color: 0x37e0b0, roughness: 1 }))
  rug.rotation.x = -Math.PI / 2
  rug.position.set(0.5, 0.015, 0.5)
  rug.receiveShadow = true
  g.add(rug)
  // sofa
  g.add(box(2.6, 0.5, 1.0, 0xb34a6e, 3.4, 0.35, 2.8))
  g.add(box(2.6, 0.8, 0.3, 0xb34a6e, 3.4, 0.7, 3.3))
  colliders.push(colliderFor(2.6, 1.1, 3.4, 2.85))
  // shelf
  g.add(box(1.6, 2.0, 0.4, 0x4a3826, -5.2, 1.0, 2.5))
  colliders.push(colliderFor(1.6, 0.4, -5.2, 2.5))
  // window (fake glow)
  const win = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 1.4), new THREE.MeshBasicMaterial({ color: 0x9fd8ff }))
  win.position.set(3.0, 1.9, -4.99 + 0.32)
  win.position.set(3.0, 1.9, -D / 2 + 0.02)
  g.add(win)
  poster(g, 'DREAM BIG', '#7c6cff', -5.98 + 0.32, 1.9, -1, Math.PI / 2)
  poster(g, 'STAY COZY', '#37e0b0', 5.98 - 0.32, 1.9, 1, -Math.PI / 2)
  return {
    group: g, colliders, screens: [screen],
    bounds: { x: W / 2 - 0.5, z: D / 2 - 0.5 },
    spawns: [[0, 3.5], [-2, 3.5], [2, 3.5], [0, 1.5]],
    lights: 'warm'
  }
}

function buildLoft() {
  const g = new THREE.Group()
  const colliders = []
  const W = 18, D = 14, H = 3.6
  roomShell(g, colliders, W, D, H, { floor: 0x6e6a66, wall: 0x4d4a55, ceil: 0x2a2733, trim: 0xe0a437 })
  const screen = buildDeskSetup(g, colliders, { x: -6.5, z: -5.6, ry: 0, title: 'anko' })
  // kitchen counter
  g.add(box(4.5, 0.95, 1.0, 0x39415e, 5.5, 0.48, -5.5))
  colliders.push(colliderFor(4.5, 1.0, 5.5, -5.5))
  g.add(box(4.5, 0.08, 1.1, 0xdfe6ff, 5.5, 0.99, -5.5))
  // island sofa + table
  g.add(box(3.2, 0.5, 1.2, 0x3e7cb1, -1, 0.35, 2.5, { ry: 0 }))
  colliders.push(colliderFor(3.2, 1.2, -1, 2.5))
  g.add(box(1.6, 0.45, 0.9, 0x6b4f35, -1, 0.23, 0.7))
  colliders.push(colliderFor(1.6, 0.9, -1, 0.7))
  // bookshelf wall
  g.add(box(3.5, 2.2, 0.45, 0x4a3826, 0, 1.1, -6.6))
  colliders.push(colliderFor(3.5, 0.45, 0, -6.6))
  // plants
  for (const [px, pz] of [[-8.2, 5.8], [8.2, 5.8], [8.2, -5.8]]) {
    const pot = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.24, 0.5, 14), new THREE.MeshStandardMaterial({ color: 0xb56545 }))
    pot.position.set(px, 0.25, pz)
    g.add(pot)
    const bush = new THREE.Mesh(new THREE.SphereGeometry(0.55, 14, 12), new THREE.MeshStandardMaterial({ color: 0x3fa34d, roughness: 1 }))
    bush.position.set(px, 0.9, pz)
    g.add(bush)
    colliders.push(colliderFor(0.6, 0.6, px, pz))
  }
  poster(g, 'LOFT LIFE', '#e0a437', -8.98 + 0.32, 2.0, 0, Math.PI / 2)
  return {
    group: g, colliders, screens: [screen],
    bounds: { x: W / 2 - 0.5, z: D / 2 - 0.5 },
    spawns: [[0, 5.5], [-3.5, 5.5], [3.5, 5.5], [-4.5, 2.5]],
    lights: 'neutral'
  }
}

function buildClub() {
  const g = new THREE.Group()
  const colliders = []
  const W = 20, D = 16, H = 4.2
  roomShell(g, colliders, W, D, H, { floor: 0x11131f, wall: 0x1c1030, ceil: 0x0b0716, trim: 0xff2fb3 })
  // dance floor tiles
  const tileColors = [0xff2fb3, 0x7c6cff, 0x37e0b0, 0x4aa8ff]
  for (let ix = -2; ix <= 2; ix++) {
    for (let iz = -1; iz <= 1; iz++) {
      const t = new THREE.Mesh(
        new THREE.BoxGeometry(1.5, 0.06, 1.5),
        new THREE.MeshStandardMaterial({ color: 0x11131f, emissive: tileColors[(ix + iz + 8) % 4], emissiveIntensity: 0.9, roughness: 0.4 })
      )
      t.position.set(ix * 1.7, 0.03, iz * 1.7)
      t.userData.dance = true
      g.add(t)
    }
  }
  // stage
  g.add(box(8, 0.6, 3, 0x2a2140, 0, 0.3, -6))
  colliders.push(colliderFor(8, 3, 0, -6))
  // booths
  for (const bx of [-7, 7]) {
    g.add(box(2.4, 0.55, 1.0, 0x6e2a5e, bx, 0.4, 4.5))
    g.add(box(1.4, 0.5, 0.8, 0x2a2140, bx, 0.35, 3.0))
    colliders.push(colliderFor(2.4, 1.0, bx, 4.5))
    colliders.push(colliderFor(1.4, 0.8, bx, 3.0))
  }
  // bar
  g.add(box(5, 1.0, 1.0, 0x39415e, 0, 0.5, 6.8))
  colliders.push(colliderFor(5, 1.0, 0, 6.8))
  // DJ desk doubles as the computer desk here
  const screen = buildDeskSetup(g, colliders, { x: 0, z: -6.0, ry: 0, title: 'anko' })
  // neon strips
  for (const [sx, col] of [[-9.5, 0xff2fb3], [9.5, 0x37e0b0]]) {
    const strip = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.12, 14), new THREE.MeshBasicMaterial({ color: col }))
    strip.position.set(sx, 3.2, 0)
    g.add(strip)
  }
  poster(g, 'DANCE', '#ff2fb3', -9.98 + 0.32, 2.2, -2, Math.PI / 2)
  poster(g, 'VIBES', '#7c6cff', 9.98 - 0.32, 2.2, 2, -Math.PI / 2)
  return {
    group: g, colliders, screens: [screen],
    bounds: { x: W / 2 - 0.5, z: D / 2 - 0.5 },
    spawns: [[0, 4.5], [-3, 4.5], [3, 4.5], [0, 2.0]],
    lights: 'neon'
  }
}

function buildDeck() {
  const g = new THREE.Group()
  const colliders = []
  const W = 16, D = 16, H = 3.0
  // sky-handled: no ceiling look — still add invisible-ish ceiling? Keep open: tall walls as hedges
  roomShell(g, colliders, W, D, H, { floor: 0x5d8a5a, wall: 0x2e4a35, ceil: 0x9fd8ff, trim: 0xdfe6ff }, { ceiling: false })
  // remove ceiling visual: replace with sky color handled by scene fog/background per-map
  // fire pit
  const pit = new THREE.Mesh(new THREE.CylinderGeometry(0.8, 0.9, 0.5, 18), new THREE.MeshStandardMaterial({ color: 0x5a5a5a, roughness: 1 }))
  pit.position.set(0, 0.25, 1.5)
  g.add(pit)
  const fire = new THREE.Mesh(new THREE.ConeGeometry(0.35, 0.9, 12), new THREE.MeshStandardMaterial({ color: 0xff8c2e, emissive: 0xff6a00, emissiveIntensity: 2 }))
  fire.position.set(0, 0.95, 1.5)
  fire.userData.flame = true
  g.add(fire)
  const fireLight = new THREE.PointLight(0xff8c2e, 20, 12)
  fireLight.position.set(0, 1.4, 1.5)
  g.add(fireLight)
  colliders.push(colliderFor(1.8, 1.8, 0, 1.5))
  // benches
  for (const [bx, bz, ry] of [[-2.2, 1.5, 0], [2.2, 1.5, 0], [0, 3.6, 0]]) {
    g.add(box(1.6, 0.45, 0.5, 0x6b4f35, bx, 0.23, bz, { ry }))
    colliders.push(colliderFor(1.6, 0.5, bx, bz))
  }
  // umbrellas (pole + canopy)
  for (const [ux, uz] of [[-5, -4], [5, -4]]) {
    g.add(box(0.12, 2.6, 0.12, 0x8a7358, ux, 1.3, uz))
    const can = new THREE.Mesh(new THREE.ConeGeometry(1.6, 0.8, 10), new THREE.MeshStandardMaterial({ color: 0xe0e4ff, roughness: 0.9 }))
    can.position.set(ux, 2.8, uz)
    g.add(can)
    colliders.push(colliderFor(0.3, 0.3, ux, uz))
  }
  // outdoor desk with the browser PC (covered corner)
  g.add(box(3.4, 0.15, 2.6, 0x4a3826, -5.5, 2.6, -5.5))
  const screen = buildDeskSetup(g, colliders, { x: -5.5, z: -5.5, ry: 0, title: 'anko' })
  poster(g, 'FRESH AIR', '#37e0b0', 7.98 - 0.32, 1.8, 0, -Math.PI / 2)
  return {
    group: g, colliders, screens: [screen],
    bounds: { x: W / 2 - 0.5, z: D / 2 - 0.5 },
    spawns: [[0, -2.5], [-2.5, -2.5], [2.5, -2.5], [0, 5.5]],
    lights: 'day',
    flame: fire,
    outdoor: true
  }
}

export const BUILDERS = { bedroom: buildBedroom, loft: buildLoft, club: buildClub, deck: buildDeck }
