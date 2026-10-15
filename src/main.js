import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';
import './style.css';

/* ============================================================
   IN THE TRENCHES — WW1 FPS prototype (single file game)
   British (player team) vs German AI battalions. 6v6 + player.
   ============================================================ */

const $ = id => document.getElementById(id);
const clamp = (v,a,b)=>Math.max(a,Math.min(b,v));
const lerp = (a,b,t)=>a+(b-a)*t;
const rand = (a,b)=>a+Math.random()*(b-a);
const randi = (a,b)=>Math.floor(rand(a,b+1));
const V3 = (x=0,y=0,z=0)=>new THREE.Vector3(x,y,z);

// ---------- settings ----------
const Settings = {
  sens: 1.0, adsSens: 0.7, volume: 0.7, invert: false, shake: true, quality: 'medium',
  load(){ try{ const s=JSON.parse(localStorage.getItem('itt-settings')||'{}'); Object.assign(this,s);}catch{} },
  save(){ try{ localStorage.setItem('itt-settings', JSON.stringify({sens:this.sens,adsSens:this.adsSens,volume:this.volume,invert:this.invert,shake:this.shake,quality:this.quality})); }catch{} }
};
Settings.load();

// ---------- audio (procedural WebAudio) ----------
const AudioSys = {
  ctx:null, master:null,
  init(){ if(this.ctx) return; try{
    this.ctx = new (window.AudioContext||window.webkitAudioContext)();
    this.master = this.ctx.createGain(); this.master.gain.value = Settings.volume; this.master.connect(this.ctx.destination);
  }catch{} },
  setVolume(v){ if(this.master) this.master.gain.value=v; },
  now(){ return this.ctx?this.ctx.currentTime:0; },
  env(g,t0,a,peak,dur){ g.gain.setValueAtTime(0.0001,t0); g.gain.exponentialRampToValueAtTime(Math.max(peak,0.0002),t0+a); g.gain.exponentialRampToValueAtTime(0.0001,t0+dur); },
  noiseBuf(){ if(this._nb) return this._nb; const sr=this.ctx.sampleRate,len=sr*1.2,buf=this.ctx.createBuffer(1,len,sr),d=buf.getChannelData(0); for(let i=0;i<len;i++)d[i]=Math.random()*2-1; this._nb=buf; return buf; },
  playNoise({dur=0.3,vol=0.5,freq=1200,q=0.7,type='lowpass',attack=0.002,when=0}){ if(!this.ctx)return; const t=this.now()+when;
    const src=this.ctx.createBufferSource(); src.buffer=this.noiseBuf(); src.loop=true;
    const f=this.ctx.createBiquadFilter(); f.type=type; f.frequency.value=freq; f.Q.value=q;
    const g=this.ctx.createGain(); this.env(g,t,attack,vol,dur);
    src.connect(f); f.connect(g); g.connect(this.master); src.start(t); src.stop(t+dur+0.05); },
  playTone({freq=220,dur=0.15,vol=0.3,type='sine',slide=0,when=0}){ if(!this.ctx)return; const t=this.now()+when;
    const o=this.ctx.createOscillator(); o.type=type; o.frequency.setValueAtTime(freq,t); if(slide)o.frequency.exponentialRampToValueAtTime(Math.max(20,freq+slide),t+dur);
    const g=this.ctx.createGain(); this.env(g,t,0.004,vol,dur); o.connect(g); g.connect(this.master); o.start(t); o.stop(t+dur+0.05); },
  rifle(close=true){ if(!this.ctx)return; const v=close?0.9:0.22;
    this.playNoise({dur:0.16,vol:v,freq:2800,type:'lowpass'});
    this.playNoise({dur:0.5,vol:v*0.5,freq:220,type:'lowpass',when:0.015});
    this.playTone({freq:90,dur:0.28,vol:v*0.8,slide:-50}); },
  revolver(){ if(!this.ctx)return; this.playNoise({dur:0.12,vol:0.7,freq:3200}); this.playTone({freq:130,dur:0.2,vol:0.5,slide:-70}); },
  distantShot(){ if(!this.ctx)return; this.playNoise({dur:0.4,vol:rand(0.05,0.13),freq:rand(150,300)}); },
  explosion(dist=50){ if(!this.ctx)return; const v=clamp(1.4-dist/90,0.08,1);
    this.playNoise({dur:1.6,vol:v,freq:120}); this.playTone({freq:55,dur:1.2,vol:v*0.9,slide:-30}); },
  reload(stage){ if(!this.ctx)return; this.playTone({freq:stage===0?900:stage===1?600:1200,dur:0.06,vol:0.25,type:'square'}); },
  bolt(){ if(!this.ctx)return; this.playTone({freq:500,dur:0.05,vol:0.3,type:'square'}); this.playTone({freq:750,dur:0.05,vol:0.3,type:'square',when:0.12}); },
  hitmark(kill){ if(!this.ctx)return; this.playTone({freq:kill?1500:2000,dur:0.06,vol:0.3,type:'square'}); if(kill)this.playTone({freq:1000,dur:0.12,vol:0.3,type:'square',when:0.07}); },
  hurt(){ if(!this.ctx)return; this.playNoise({dur:0.25,vol:0.4,freq:400}); this.playTone({freq:160,dur:0.25,vol:0.35,slide:-60}); },
  step(run){ if(!this.ctx)return; this.playNoise({dur:0.09,vol:run?0.11:0.07,freq:rand(300,700)}); },
  whistle(){ if(!this.ctx)return; this.playTone({freq:2200,dur:1.4,vol:0.35,slide:400}); },
  cap(){ if(!this.ctx)return; this.playTone({freq:660,dur:0.12,vol:0.22}); },
  click(){ if(!this.ctx)return; this.playTone({freq:700,dur:0.05,vol:0.2,type:'square'}); },
  empty(){ if(!this.ctx)return; this.playTone({freq:1400,dur:0.04,vol:0.25,type:'square'}); }
};

// ---------- renderer / scene ----------
const canvas = $('game');
const renderer = new THREE.WebGLRenderer({ canvas, antialias:true, powerPreference:'high-performance' });
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x8d867a);
scene.fog = new THREE.FogExp2(0x8d867a, 0.0072);

const camera = new THREE.PerspectiveCamera(75, innerWidth/innerHeight, 0.08, 600);
camera.rotation.order = 'YXZ';

function applyQuality(){
  const q = Settings.quality;
  const pr = q==='high'?Math.min(devicePixelRatio,2):q==='medium'?Math.min(devicePixelRatio,1.25):0.85;
  renderer.setPixelRatio(pr);
  renderer.setSize(innerWidth, innerHeight);
  FX.smokeMax = q==='high'?220:q==='medium'?140:70;
}
addEventListener('resize', ()=>{ camera.aspect=innerWidth/innerHeight; camera.updateProjectionMatrix(); renderer.setSize(innerWidth,innerHeight); });

// lights — bleak overcast morning
const hemi = new THREE.HemisphereLight(0xc4c0b4, 0x4a4034, 1.15); scene.add(hemi);
const sun = new THREE.DirectionalLight(0xe2d8c2, 1.55);
sun.position.set(-60, 90, 40); sun.castShadow = true;
sun.shadow.mapSize.set(2048,2048);
sun.shadow.camera.left=-130; sun.shadow.camera.right=130; sun.shadow.camera.top=130; sun.shadow.camera.bottom=-130;
sun.shadow.camera.far=300; sun.shadow.bias=-0.0006;
scene.add(sun); scene.add(sun.target);
const muzzleLight = new THREE.PointLight(0xffb45e, 0, 18, 2); scene.add(muzzleLight);

// ---------- PBR textures (Poly Haven, CC0) ----------
const loadManager = new THREE.LoadingManager();
const texLoader = new THREE.TextureLoader(loadManager);
const maxAniso = Math.min(8, renderer.capabilities.getMaxAnisotropy());
function loadTex(file, srgb=true){
  const t=texLoader.load('tex/'+file);
  t.wrapS=t.wrapT=THREE.RepeatWrapping;
  if(srgb)t.colorSpace=THREE.SRGBColorSpace;
  t.anisotropy=maxAniso;
  return t;
}
function pbrMat(diff, {nor=null, rough=null, rx=1, ry=1, color=0xffffff, roughVal=1.0}={}){
  const m=new THREE.MeshStandardMaterial({color,roughness:roughVal,metalness:0.0});
  if(diff){ const t=loadTex(diff); t.repeat.set(rx,ry); m.map=t; }
  if(nor){ const t=loadTex(nor,false); t.repeat.set(rx,ry); m.normalMap=t; }
  if(rough){ const t=loadTex(rough,false); t.repeat.set(rx,ry); m.roughnessMap=t; }
  return m;
}
const groundPBR = pbrMat('brown_mud_02_diff_1k.jpg',{nor:'brown_mud_02_nor_gl_1k.jpg',rough:'brown_mud_02_rough_1k.jpg',rx:30,ry:30,color:0xffffff});
const brickPBR  = pbrMat('plaster_brick_01_diff_1k.jpg',{nor:'plaster_brick_01_nor_gl_1k.jpg',rx:2,ry:1.4});
const roofPBR   = pbrMat('clay_roof_tiles_02_diff_1k.jpg',{nor:'clay_roof_tiles_02_nor_gl_1k.jpg',rx:3,ry:3,color:0xb5a994});
const plankPBR  = pbrMat('wood_planks_grey_diff_1k.jpg',{nor:'wood_planks_grey_nor_gl_1k.jpg',rx:1,ry:1,color:0xb99f78});
const concretePBR=pbrMat('concrete_block_wall_diff_1k.jpg',{nor:'concrete_block_wall_nor_gl_1k.jpg',rx:2,ry:1});
const plasterPBR= pbrMat('damaged_plaster_diff_1k.jpg',{rx:2,ry:1.4});
const stonePBR  = pbrMat('rock_wall_04_diff_1k.jpg',{nor:'rock_wall_04_nor_gl_1k.jpg',rx:2,ry:2});
// ---------- procedural canvas textures ----------
function canvasTex(size, fn, repeat=1){
  const c=document.createElement('canvas'); c.width=c.height=size;
  fn(c.getContext('2d'), size);
  const t=new THREE.CanvasTexture(c); t.wrapS=t.wrapT=THREE.RepeatWrapping; t.repeat.set(repeat,repeat);
  t.colorSpace=THREE.SRGBColorSpace; return t;
}
const mudTex = canvasTex(512,(g,s)=>{
  g.fillStyle='#4a3d2c'; g.fillRect(0,0,s,s);
  for(let i=0;i<9000;i++){ g.fillStyle=`rgba(${randi(30,110)},${randi(25,85)},${randi(15,60)},${rand(0.1,0.5)})`; const r=rand(0.5,3); g.beginPath(); g.arc(rand(0,s),rand(0,s),r,0,7); g.fill(); }
  for(let i=0;i<260;i++){ g.fillStyle=`rgba(${randi(90,140)},${randi(80,115)},${randi(55,85)},0.25)`; g.beginPath(); g.ellipse(rand(0,s),rand(0,s),rand(4,22),rand(3,14),rand(0,3),0,7); g.fill(); }
  for(let i=0;i<40;i++){ g.strokeStyle='rgba(20,14,8,0.35)'; g.lineWidth=rand(1,3); g.beginPath(); const x=rand(0,s),y=rand(0,s); g.moveTo(x,y); g.lineTo(x+rand(-30,30),y+rand(-30,30)); g.stroke(); }
},28);
const sandbagTex = canvasTex(256,(g,s)=>{
  g.fillStyle='#6e6046'; g.fillRect(0,0,s,s);
  // 2 cols x 3 rows of large bags
  for(let r=0;r<3;r++)for(let c=0;c<2;c++){
    const x=c*128, y=r*86;
    const base=[randi(118,132),randi(102,116),randi(72,88)];
    const grd=g.createLinearGradient(0,y,0,y+86);
    grd.addColorStop(0,`rgb(${base[0]+12},${base[1]+10},${base[2]+8})`);
    grd.addColorStop(0.5,`rgb(${base[0]},${base[1]},${base[2]})`);
    grd.addColorStop(1,`rgb(${base[0]-22},${base[1]-20},${base[2]-16})`);
    g.fillStyle=grd;
    g.beginPath(); g.roundRect(x+6,y+7,116,72,22); g.fill();
    g.strokeStyle='rgba(45,35,20,0.75)'; g.lineWidth=3; g.stroke();
    // fabric weave
    for(let i=0;i<130;i++){ g.fillStyle=`rgba(50,40,22,${rand(0.05,0.16)})`; g.fillRect(rand(x,x+128),rand(y,y+86),2,1); }
    // tie knot shadow
    g.fillStyle='rgba(50,40,22,0.45)'; g.beginPath(); g.ellipse(x+64,y+43,9,6,0.3,0,7); g.fill();
  }
},1);
const woodTex = canvasTex(256,(g,s)=>{
  g.fillStyle='#5d4a30'; g.fillRect(0,0,s,s);
  for(let i=0;i<40;i++){ g.strokeStyle=`rgba(${randi(30,70)},${randi(20,55)},${randi(10,35)},0.7)`; g.lineWidth=rand(1,4); g.beginPath(); const y=rand(0,s); g.moveTo(0,y); g.bezierCurveTo(s*0.3,y+rand(-8,8),s*0.6,y+rand(-8,8),s,y+rand(-6,6)); g.stroke(); }
  for(let i=0;i<6;i++){ g.fillStyle='rgba(25,15,8,0.8)'; g.beginPath(); g.ellipse(rand(0,s),rand(0,s),rand(3,7),rand(2,4),0,0,7); g.fill(); }
},1);
const smokeTex = (()=>{ const c=document.createElement('canvas'); c.width=c.height=128; const g=c.getContext('2d');
  const gr=g.createRadialGradient(64,64,4,64,64,62); gr.addColorStop(0,'rgba(220,215,205,0.85)'); gr.addColorStop(0.6,'rgba(180,175,165,0.35)'); gr.addColorStop(1,'rgba(160,155,145,0)');
  g.fillStyle=gr; g.fillRect(0,0,128,128); const t=new THREE.CanvasTexture(c); return t; })();
const flashTex = (()=>{ const c=document.createElement('canvas'); c.width=c.height=128; const g=c.getContext('2d');
  const gr=g.createRadialGradient(64,64,2,64,64,62); gr.addColorStop(0,'rgba(255,240,180,1)'); gr.addColorStop(0.35,'rgba(255,180,80,0.9)'); gr.addColorStop(1,'rgba(255,120,20,0)');
  g.fillStyle=gr; g.fillRect(0,0,128,128); return new THREE.CanvasTexture(c); })();

// ---------- world data ----------
const colliders = [];   // {x1,z1,x2,z2} 2D AABB walls
const obstacles = [];   // meshes for bullet raycast
const losBlockers = []; // cheap invisible boxes + ground for AI LOS
const coverPoints = []; // Vector3 for AI
const craters = [];
const ammoCrates = [];
function addCollider(x1,z1,x2,z2){ colliders.push({x1:Math.min(x1,x2),z1:Math.min(z1,z2),x2:Math.max(x1,x2),z2:Math.max(z1,z2)}); }
function collideCircle(p, r){
  for(const c of colliders){
    const nx=clamp(p.x,c.x1,c.x2), nz=clamp(p.z,c.z1,c.z2);
    const dx=p.x-nx, dz=p.z-nz;
    if(dx*dx+dz*dz < r*r){
      const d=Math.sqrt(dx*dx+dz*dz)||0.001;
      const push=(r-d)/d;
      p.x+=dx*push; p.z+=dz*push;
    }
  }
  p.x=clamp(p.x,-115,115); p.z=clamp(p.z,-115,115);
}
function segmentBlocked(ax,az,bx,bz){
  // sample along segment for collider intersection (LOS for movement)
  const steps=12;
  for(let i=1;i<steps;i++){ const x=lerp(ax,bx,i/steps), z=lerp(az,bz,i/steps);
    for(const c of colliders){ if(x>c.x1-0.3&&x<c.x2+0.3&&z>c.z1-0.3&&z<c.z2+0.3) return true; } }
  return false;
}

// ---------- materials ----------
const MAT = {
  mud: groundPBR,
  sandbag: new THREE.MeshStandardMaterial({ map:sandbagTex, roughness:0.95 }),
  wood: plankPBR,
  darkwood: new THREE.MeshStandardMaterial({ color:0x3d2f1e, roughness:0.95 }),
  wire: new THREE.MeshStandardMaterial({ color:0x2a2622, roughness:0.6, metalness:0.6 }),
  stone: stonePBR,
  ruin: brickPBR,
  plaster: plasterPBR,
  roof: roofPBR,
  concrete: concretePBR,
  metal: new THREE.MeshStandardMaterial({ color:0x3a3a3c, roughness:0.45, metalness:0.8 }),
  gunwood: new THREE.MeshStandardMaterial({ color:0x4a3018, roughness:0.6 }),
};

// ---------- build terrain ----------
const groundGeo = new THREE.PlaneGeometry(240,240,120,120);
groundGeo.rotateX(-Math.PI/2);
{
  const pos = groundGeo.attributes.position;
  for(let i=0;i<pos.count;i++){
    const x=pos.getX(i), z=pos.getZ(i);
    let y = Math.sin(x*0.05)*Math.cos(z*0.04)*0.7 + Math.sin(x*0.013+2)*1.1;
    // flatten trench corridors & center
    const nearTrench = Math.abs(Math.abs(z)-62)<7;
    if(nearTrench) y *= 0.25;
    if(Math.hypot(x,z)<20) y *= 0.3;
    pos.setY(i,y);
  }
  groundGeo.computeVertexNormals();
}
const ground = new THREE.Mesh(groundGeo, MAT.mud);
ground.receiveShadow = true; scene.add(ground); obstacles.push(ground); losBlockers.push(ground);

// craters (visual + cover)
const craterMat = new THREE.MeshStandardMaterial({ color:0x2e251a, roughness:1 });
const craterRimMat = new THREE.MeshStandardMaterial({ color:0x5a4c38, roughness:1 });
function addCrater(x,z,r){
  const g = new THREE.CircleGeometry(r, 20);
  const m = new THREE.Mesh(g, craterMat); m.rotation.x=-Math.PI/2; m.position.set(x,0.06,z); m.receiveShadow=true; scene.add(m);
  const rim = new THREE.Mesh(new THREE.TorusGeometry(r, r*0.16, 6, 20), craterRimMat);
  rim.rotation.x=Math.PI/2; rim.position.set(x,0.15,z); rim.castShadow=true; rim.receiveShadow=true; scene.add(rim);
  craters.push({x,z,r}); coverPoints.push(V3(x+r*0.9,0,z), V3(x-r*0.9,0,z));
  // dark water puddle in big craters
  if(r>3){ const w=new THREE.Mesh(new THREE.CircleGeometry(r*0.45,14), new THREE.MeshStandardMaterial({color:0x2c332e,roughness:0.15,metalness:0.4}));
    w.rotation.x=-Math.PI/2; w.position.set(x,0.09,z); scene.add(w); }
}
const craterSpots=[[8,-18,4.5],[-14,-8,3.2],[20,10,3.8],[-24,18,4.2],[6,24,2.8],[-6,-32,3.5],[30,-14,2.6],[-34,-22,4.8],[44,4,3.4],[-46,8,3.0],[12,-40,2.7],[-18,38,3.1],[36,30,4.4],[-38,32,2.9],[52,-30,4.0],[-55,-6,3.6],[18,-8,2.2],[-10,6,2.4],[26,-26,3.0],[-28,-36,3.3],[60,18,3.8],[-62,22,4.1],[70,-8,3.2],[-72,-16,3.7],[10,44,3.0],[-8,-48,2.6]];
craterSpots.forEach(([x,z,r])=>addCrater(x,z,r));

// ---------- trench construction (instanced for performance) ----------
const sandbagGeo = new THREE.BoxGeometry(1.8,0.55,0.6);
const boardGeo = new THREE.BoxGeometry(1.6,0.08,0.5);
const postGeo = new THREE.CylinderGeometry(0.06,0.08,1.3,6);
const coilGeo = new THREE.TorusGeometry(0.55,0.05,5,12);
const INST = { sandbag:[], board:[], post:[], coil:[] };
function buildInstances(){
  const dummy=new THREE.Object3D();
  const mk=(geo,mat,list,shadow=true)=>{
    if(!list.length) return null;
    const m=new THREE.InstancedMesh(geo,mat,list.length);
    list.forEach((t,i)=>{ dummy.position.set(t.x,t.y??0.06,t.z); dummy.rotation.set(t.rx||0,t.ry||0,t.rz||0); dummy.updateMatrix(); m.setMatrixAt(i,dummy.matrix); });
    m.instanceMatrix.needsUpdate=true; m.castShadow=shadow; m.receiveShadow=true; scene.add(m); return m;
  };
  mk(sandbagGeo,MAT.sandbag,INST.sandbag);
  mk(boardGeo,MAT.wood,INST.board,false);
  mk(postGeo,MAT.wood,INST.post);
  mk(coilGeo,MAT.wire,INST.coil,false);
}
function sandbagWall(x1,z1,x2,z2,h=2.2,front=true){
  // wall of stacked sandbags along segment (instanced)
  const len = Math.hypot(x2-x1,z2-z1);
  const n = Math.max(1,Math.round(len/1.8));
  const rows = Math.max(2,Math.round(h/0.55));
  const ang=Math.atan2(x2-x1,z2-z1);
  for(let i=0;i<=n;i++){
    const t=i/n, x=lerp(x1,x2,t), z=lerp(z1,z2,t);
    for(let r=0;r<rows;r++){
      INST.sandbag.push({x:x+rand(-0.05,0.05), y:0.28+r*0.53, z:z+rand(-0.05,0.05), ry:ang+Math.PI/2+rand(-0.06,0.06)});
    }
  }
  // collider (thick)
  const dx=x2-x1,dz=z2-z1,L=Math.hypot(dx,dz)||1,nx=-dz/L*0.45,nz=dx/L*0.45;
  addCollider(Math.min(x1+nx,x2+nx),Math.min(z1+nz,z2+nz),Math.max(x1-nx,x2-nx),Math.max(z1-nz,z2-nz));
  // register as raycast obstacles (use invisible box for cheap bullet blocking)
  const block = new THREE.Mesh(new THREE.BoxGeometry(Math.abs(x2-x1)+1, h, Math.abs(z2-z1)+1), new THREE.MeshBasicMaterial({visible:false}));
  block.position.set((x1+x2)/2, h/2, (z1+z2)/2); scene.add(block); obstacles.push(block); losBlockers.push(block);
}
function duckboards(x1,z1,x2,z2){
  const len=Math.hypot(x2-x1,z2-z1), n=Math.round(len/1.2);
  const ry=Math.atan2(x2-x1,z2-z1)+Math.PI/2;
  for(let i=0;i<=n;i++){ const t=i/n; INST.board.push({x:lerp(x1,x2,t), y:0.06, z:lerp(z1,z2,t), ry}); }
}
function timberFrame(x,z,rotY=0){
  const g=new THREE.Group();
  const post=new THREE.BoxGeometry(0.25,2.6,0.25);
  for(const s of [-1,1]){ const p=new THREE.Mesh(post,MAT.darkwood); p.position.set(s*1.4,1.3,0); p.castShadow=true; g.add(p); }
  const beam=new THREE.Mesh(new THREE.BoxGeometry(3.1,0.25,0.3),MAT.darkwood); beam.position.y=2.6; beam.castShadow=true; g.add(beam);
  g.position.set(x,0,z); g.rotation.y=rotY; scene.add(g);
}
function barbedWire(x1,z1,x2,z2){
  const g=new THREE.Group();
  const len=Math.hypot(x2-x1,z2-z1), n=Math.max(2,Math.round(len/4));
  for(let i=0;i<=n;i++){ const t=i/n,x=lerp(x1,x2,t),z=lerp(z1,z2,t);
    INST.post.push({x, y:0.65, z, rz:rand(-0.15,0.15)});
  }
  // wire strands: catenary-ish lines
  for(let s=0;s<3;s++){ const pts=[]; const y=0.5+s*0.28;
    for(let i=0;i<=40;i++){ const t=i/40; pts.push(V3(lerp(x1,x2,t)+Math.sin(t*40+s)*0.25, y+Math.sin(t*25)*0.08, lerp(z1,z2,t)+Math.cos(t*36+s)*0.25)); }
    const line=new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({color:0x1c1a18}));
    g.add(line); }
  // X coils
  for(let i=0;i<n*2;i++){ const t=Math.random();
    INST.coil.push({x:lerp(x1,x2,t), y:0.55, z:lerp(z1,z2,t), ry:rand(0,3)});
  }
  scene.add(g);
  // wire slows & blocks bullets partially; add low collider segments with gaps
  for(let i=0;i<n;i++){ const t0=i/n,t1=(i+1)/n;
    if(i%3!==2) addCollider(lerp(x1,x2,t0)-0.4,lerp(z1,z2,t0)-0.4,lerp(x1,x2,t1)+0.4,lerp(z1,z2,t1)+0.4); }
}

// zigzag trench builder: returns fire-trench path points
function trenchLine(zBase, facing, team){
  const pts=[];
  for(let x=-72;x<=72;x+=12){ const off=((x/12)%2===0)?0:(facing>0?-3:3); pts.push([x, zBase+off]); }
  // front parapet + rear parados with exit gaps every ~24m
  for(let i=0;i<pts.length-1;i++){
    const [x1,z1]=pts[i],[x2,z2]=pts[i+1];
    const gap = (i%2===1); // segment index with exit gap
    if(gap){
      const mx=(x1+x2)/2;
      const t0=0.42,t1=0.58;
      const ax=lerp(x1,x2,t0),az=lerp(z1,z2,t0),bx=lerp(x1,x2,t1),bz=lerp(z1,z2,t1);
      sandbagWall(x1,z1 - facing*0, ax,az, 1.5);
      sandbagWall(bx,bz, x2,z2, 1.5);
      // matching gap in the rear parados so troops can go over the top
      const rx1=x1,rz1=z1-facing*3.2, rax=ax,raz=az-facing*3.2, rbx=bx,rbz=bz-facing*3.2, rx2=x2,rz2=z2-facing*3.2;
      sandbagWall(rx1,rz1, rax,raz, 1.3);
      sandbagWall(rbx,rbz, rx2,rz2, 1.3);
    } else {
      sandbagWall(x1,z1, x2,z2, 1.5);
      sandbagWall(x1,z1-facing*3.2, x2,z2-facing*3.2, 1.3);
    }
    duckboards(x1,z1-facing*1.6, x2,z2-facing*1.6);
    if(i%2===0) timberFrame((x1+x2)/2,(z1+z2)/2-facing*1.6, Math.atan2(x2-x1,z2-z1)+Math.PI/2);
  }
  // support trench behind
  const sz = zBase - facing*14;
  sandbagWall(-60,sz, 60,sz, 1.5);
  sandbagWall(-60,sz-facing*3, 60,sz-facing*3, 1.2);
  duckboards(-60,sz-facing*1.5, 60,sz-facing*1.5);
  // communication trenches connecting
  for(const cx of [-40,0,40]){
    sandbagWall(cx-1.4,zBase-facing*3, cx-1.4,sz, 1.5);
    sandbagWall(cx+1.4,zBase-facing*3, cx+1.4,sz, 1.5);
    duckboards(cx,zBase-facing*3, cx,sz);
  }
  // firestep + ladders at exits
  for(let x=-60;x<=60;x+=24){
    const ladder=new THREE.Mesh(new THREE.BoxGeometry(0.7,2.2,0.25),MAT.wood);
    ladder.position.set(x+3,1.0,zBase-facing*0.6); ladder.castShadow=true; scene.add(ladder);
  }
  // duckout / dugout entrances
  for(const dx of [-52,-8,36]){
    const hut=new THREE.Group();
    const roof=new THREE.Mesh(new THREE.BoxGeometry(4,0.3,3),MAT.darkwood); roof.position.y=2.2; roof.castShadow=true; hut.add(roof);
    hut.position.set(dx,0,zBase-facing*6); scene.add(hut);
  }
  // cover points along trench
  for(let x=-66;x<=66;x+=11) coverPoints.push(V3(x,0,zBase-facing*1.6));
  return { z:zBase, facing, team, exits:[-60,-36,-12,12,36,60].map(x=>V3(x,0,zBase)) };
}
const britTrench = trenchLine(62, -1, 'brit');   // faces north (-z)
const gerTrench  = trenchLine(-62, 1, 'ger');   // faces south (+z)

// wire belts
for(let x=-70;x<70;x+=14){ barbedWire(x,28,x+11,28+rand(-1,1)); barbedWire(x,-28,x+11,-28+rand(-1,1)); }
buildInstances(); // bake all collected sandbags / boards / posts / coils into 4 draw calls

// ---------- realistic buildings (PBR masonry + timber) ----------
const Objective = { pos: V3(0,0,0), radius: 13 };
// solid box with collision + bullet blocking
function solidBox(w,h,d,x,z,{ry=0,mat=MAT.ruin,y=0}={}){
  const m=new THREE.Mesh(new THREE.BoxGeometry(w,h,d),mat);
  m.position.set(x,y+h/2,z); m.rotation.y=ry; m.castShadow=true; m.receiveShadow=true;
  scene.add(m); obstacles.push(m); losBlockers.push(m);
  const c=Math.cos(ry),s=Math.sin(ry),hw=w/2,hd=d/2;
  addCollider(x-Math.abs(hw*c)-Math.abs(hd*s),z-Math.abs(hw*s)-Math.abs(hd*c),x+Math.abs(hw*c)+Math.abs(hd*s),z+Math.abs(hw*s)+Math.abs(hd*c));
  coverPoints.push(V3(x+Math.abs(hw)+1.6,0,z),V3(x-Math.abs(hw)-1.6,0,z));
  return m;
}
// masonry wall along a segment with door/window openings:
// openings: [{at:0..1 along, w, sill, top}]
function masonryWall(x1,z1,x2,z2,h,mat,{thick=0.45,openings=[]}={}){
  const len=Math.hypot(x2-x1,z2-z1), ang=Math.atan2(x2-x1,z2-z1);
  const px=(t)=>lerp(x1,x2,t), pz=(t)=>lerp(z1,z2,t);
  const sorted=[...openings].sort((a,b)=>a.at-b.at);
  const edges=[0];
  for(const o of sorted){ edges.push(o.at-o.w/2/len, o.at+o.w/2/len); }
  edges.push(1);
  for(let i=0;i<edges.length;i+=2){
    const a=Math.max(0,edges[i]), b=Math.min(1,edges[i+1]);
    if(b-a<0.01) continue;
    const segLen=(b-a)*len;
    const m=new THREE.Mesh(new THREE.BoxGeometry(thick,h,segLen),mat);
    m.position.set((px(a)+px(b))/2,h/2,(pz(a)+pz(b))/2); m.rotation.y=ang;
    m.castShadow=true; m.receiveShadow=true; scene.add(m); obstacles.push(m); losBlockers.push(m);
    // rotated footprint collider
    const ux=(x2-x1)/len, uz=(z2-z1)/len;
    const hl=segLen/2+0.25, hw=thick/2+0.12;
    const cx=(px(a)+px(b))/2, cz=(pz(a)+pz(b))/2;
    const ex=Math.abs(ux)*hl+Math.abs(uz)*hw, ez=Math.abs(uz)*hl+Math.abs(ux)*hw;
    addCollider(cx-ex,cz-ez,cx+ex,cz+ez);
  }
  // lintels above openings + timber frames
  const frameMat=MAT.darkwood;
  for(const o of sorted){
    if(o.top<h-0.05){
      const lw=o.w+0.3;
      const l=new THREE.Mesh(new THREE.BoxGeometry(thick+0.06,h-o.top,lw),mat);
      l.position.set(px(o.at),(h+o.top)/2,pz(o.at)); l.rotation.y=ang;
      l.castShadow=true; scene.add(l); obstacles.push(l);
    }
    // timber frame trim
    const t1=new THREE.Mesh(new THREE.BoxGeometry(thick+0.1,o.top-o.sill,0.12),frameMat);
    const off1=V3(Math.cos(ang),0,-Math.sin(ang));
    for(const s of [-1,1]){
      const f=t1.clone();
      f.position.set(px(o.at)+off1.x*(o.w/2)*s,(o.top+o.sill)/2,pz(o.at)+off1.z*(o.w/2)*s);
      f.rotation.y=ang; f.castShadow=true; scene.add(f);
    }
    const head=new THREE.Mesh(new THREE.BoxGeometry(thick+0.1,0.12,o.w+0.24),frameMat);
    head.position.set(px(o.at),o.top+0.02,pz(o.at)); head.rotation.y=ang; head.castShadow=true; scene.add(head);
    // dark interior recess for windows (not doors)
    if(o.sill>0.3){
      const dark=new THREE.Mesh(new THREE.PlaneGeometry(o.w-0.1,o.top-o.sill-0.1),new THREE.MeshBasicMaterial({color:0x0a0806,side:THREE.DoubleSide}));
      dark.position.set(px(o.at),(o.top+o.sill)/2,pz(o.at)); dark.rotation.y=ang+Math.PI/2; scene.add(dark);
    }
  }
  coverPoints.push(V3(x1,0,z1),V3(x2,0,z2));
}
// triangular gable prism capping a wall end (ridge along x: triangle spans z)
function gable(cx,cz,d,h,thick,mat){
  const shape=new THREE.Shape();
  shape.moveTo(-d/2,0); shape.lineTo(d/2,0); shape.lineTo(0,h); shape.closePath();
  const g=new THREE.ExtrudeGeometry(shape,{depth:thick,bevelEnabled:false});
  g.translate(0,0,-thick/2);
  const m=new THREE.Mesh(g,mat);
  m.position.set(cx,0,cz); m.rotation.y=Math.PI/2; // thickness along x, face spans z
  m.castShadow=true; m.receiveShadow=true; scene.add(m); obstacles.push(m);
  return m;
}
// pitched roof: two slabs + ridge + rafters; opts.half removes one slope (ruin)
function pitchedRoof(cx,cz,w,d,wallH,rise,mat,{half=false}={}){
  const g=new THREE.Group();
  const slope=Math.hypot(w/2,rise), ang=Math.atan2(rise,w/2);
  const mkSlope=(side)=>{
    const s=new THREE.Mesh(new THREE.BoxGeometry(slope+0.6,0.14,d+0.9),mat);
    s.position.set(cx+side*(w/4), wallH+rise/2, cz);
    s.rotation.z=-side*ang; s.castShadow=true; s.receiveShadow=true; g.add(s);
  };
  if(!half) { mkSlope(1); mkSlope(-1); }
  else { // ruined: keep the west slope, expose rafters on the missing east side
    mkSlope(-1);
    for(let i=0;i<6;i++){ const r=new THREE.Mesh(new THREE.BoxGeometry(slope,0.18,0.14),MAT.darkwood);
      const z=cz-d/2+ (i+0.5)*(d/6);
      r.position.set(cx+w/4,wallH+rise/2-0.15,z); r.rotation.z=-ang; r.castShadow=true; g.add(r); }
  }
  const ridge=new THREE.Mesh(new THREE.BoxGeometry(0.22,0.22,d+0.9),MAT.darkwood);
  ridge.position.set(cx,wallH+rise,cz); ridge.castShadow=true; g.add(ridge);
  scene.add(g);
  return g;
}
function rubblePile(x,z,r,n,mat){
  for(let i=0;i<n;i++){
    const m=new THREE.Mesh(new THREE.BoxGeometry(rand(0.3,1.1),rand(0.25,0.7),rand(0.3,1.0)),mat);
    const a=rand(0,Math.PI*2), rr=Math.sqrt(Math.random())*r;
    m.position.set(x+Math.cos(a)*rr,rand(0.1,0.5),z+Math.sin(a)*rr);
    m.rotation.set(rand(0,0.6),rand(0,3),rand(0,0.4));
    m.castShadow=true; m.receiveShadow=true; scene.add(m);
  }
}
// full house builder: rectangular masonry shell + gables + roof
function makeHouse(cx,cz,w,d,wallH,mat,{ry=0,ruin=0,roofHalf=false,doorSide=0}={}){
  // doorSide: 0 = door on +z face, 2 = -z face (plus windows around)
  const win=(at)=>({at,w:1.0,sill:1.0,top:2.1});
  const door=(at)=>({at,w:1.25,sill:0,top:2.25});
  const c=Math.cos(ry),s=Math.sin(ry);
  const L=(lx,lz)=>[cx+lx*c+lz*s, cz-lx*s+lz*c];
  const wall=(ax,az,bx,bz,ops)=>{ const [x1,z1]=L(ax,az),[x2,z2]=L(bx,bz); masonryWall(x1,z1,x2,z2,ops.h??wallH,mat,{openings:ops.openings??[]}); };
  const doors = doorSide===0 ? [door(0.5)] : [door(0.5)];
  // south (+z) and north (−z) walls
  wall(-w/2, d/2, w/2, d/2, {openings: doorSide===0?[...doors,win(0.2),win(0.8)]:[win(0.25),win(0.75)]});
  wall(w/2,-d/2,-w/2,-d/2, {openings: doorSide!==0?[...doors,win(0.5)]:[win(0.3),win(0.7)]});
  // west wall full height, east wall collapsed if ruin
  wall(-w/2,-d/2,-w/2, d/2, {openings:[win(0.35),win(0.65)]});
  const eastH = ruin>0 ? wallH*0.45 : wallH;
  wall(w/2, d/2, w/2,-d/2, {h:eastH, openings: ruin>0?[]:[win(0.5)]});
  // gables on west/east (ridge along x)
  const rise=Math.min(2.6,w*0.28);
  if(ruin<2){
    const [gx1,gz1]=L(-w/2,0),[gx2,gz2]=L(w/2,0);
    const g1=gable(gx1,gz1,d,rise,0.45,mat); g1.position.y=wallH;
    if(ruin===0){ const g2=gable(gx2,gz2,d,rise,0.45,mat); g2.position.y=eastH; }
  }
  pitchedRoof(cx,cz,w,d,wallH,rise,MAT.roof,{half:roofHalf||ruin>0});
  if(ruin>0) rubblePile(cx+w/4,cz,3,16,mat);
  return {cx,cz,w,d};
}

{
  // --- central ruined farmhouse (the objective): house + courtyard + well ---
  makeHouse(0,-4, 12,8, 3.4, MAT.ruin, {ruin:1, roofHalf:true, doorSide:0});
  // courtyard dwarf walls (ruined, with gate gaps)
  const yw=(x1,z1,x2,z2,h)=>masonryWall(x1,z1,x2,z2,h,MAT.ruin,{thick:0.4,openings:[]});
  yw(-9,7, -2.2,7, 1.5); yw(2.2,7, 9,7, 1.2);
  yw(-9,7, -9,0, 1.6); yw(9,7, 9,0, 1.0);
  // stone well
  const well=new THREE.Mesh(new THREE.CylinderGeometry(0.9,1.0,1.0,12,1,true),MAT.stone);
  well.position.set(-5.5,0.5,3.5); well.castShadow=true; well.receiveShadow=true; scene.add(well); obstacles.push(well);
  addCollider(-6.5,2.5,-4.5,4.5);
  for(const s of [-1,1]){ const p=new THREE.Mesh(new THREE.BoxGeometry(0.14,2.2,0.14),MAT.darkwood);
    p.position.set(-5.5+s*0.8,1.4,3.5); p.castShadow=true; scene.add(p); }
  const wroof=new THREE.Mesh(new THREE.BoxGeometry(2.2,0.12,1.4),MAT.roof);
  wroof.position.set(-5.5,2.55,3.5); wroof.rotation.z=0.12; wroof.castShadow=true; scene.add(wroof);
  rubblePile(4,-5,2.5,12,MAT.ruin);
  // cart wreck
  const cart=new THREE.Group();
  const bed=new THREE.Mesh(new THREE.BoxGeometry(2.2,0.15,1.2),MAT.wood); bed.position.y=0.8; cart.add(bed);
  for(const [sx,sz2] of [[-1,-1],[1,-1],[-1,1],[1,1]]){
    const w=new THREE.Mesh(new THREE.TorusGeometry(0.55,0.09,8,18),MAT.darkwood);
    w.position.set(sx*0.8,0.55,sz2*0.7); cart.add(w); }
  const shaft=new THREE.Mesh(new THREE.BoxGeometry(0.12,0.12,2.4),MAT.darkwood);
  shaft.position.set(0.4,0.5,1.8); shaft.rotation.x=0.25; cart.add(shaft);
  cart.position.set(5.5,0,4.5); cart.rotation.set(0,0.6,0.12); cart.traverse(o=>{o.castShadow=true;}); scene.add(cart);
  addCollider(4.3,3.6,6.7,5.4);
  // flag pole in the courtyard
  const pole=new THREE.Mesh(new THREE.CylinderGeometry(0.09,0.12,9,8),MAT.wood); pole.position.set(0,4.5,1); pole.castShadow=true; scene.add(pole);
  // white tape marking capture zone
  const tapePts=[]; for(let a=0;a<=32;a++){ const t=a/32*Math.PI*2; tapePts.push(V3(Math.cos(t)*13,0.25,Math.sin(t)*13)); }
  const tape=new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(tapePts), new THREE.LineBasicMaterial({color:0xf5efdd})); scene.add(tape);
  for(let i=0;i<10;i++){ const t=i/10*Math.PI*2; const p=new THREE.Mesh(new THREE.CylinderGeometry(0.04,0.04,0.6,6),MAT.wood);
    p.position.set(Math.cos(t)*13,0.3,Math.sin(t)*13); scene.add(p); }

  // --- British barn (rear, intact) ---
  makeHouse(-38,88, 9,6.5, 3.0, MAT.plaster, {ruin:0, doorSide:0});
  // --- German concrete bunker (rear) ---
  solidBox(7,2.6,3.6, 24,-84, {mat:MAT.concrete});
  masonryWall(20.5,-82.4, 27.5,-82.4, 1.0, MAT.concrete, {thick:0.4}); // front lip with firing slit gap
  {
    const roof=solidBox(7.6,0.5,4.4, 24,-84, {mat:MAT.concrete}); roof.position.y=2.6;
    const mound=new THREE.Mesh(new THREE.SphereGeometry(4.4,12,8,0,Math.PI*2,0,Math.PI/2),MAT.mud);
    mound.scale.set(1,0.35,0.7); mound.position.set(24,2.8,-84); mound.receiveShadow=true; scene.add(mound);
  }
  // --- ruined church tower (east landmark) ---
  masonryWall(59.75,-12.25, 64.25,-12.25, 10, MAT.stone, {thick:0.5, openings:[{at:0.5,w:1.7,sill:0,top:3.2}]});
  masonryWall(64.25,-12.25, 64.25,-7.75, 10, MAT.stone, {thick:0.5, openings:[{at:0.6,w:0.8,sill:6,top:7.6}]});
  masonryWall(64.25,-7.75, 59.75,-7.75, 7.5, MAT.stone, {thick:0.5});
  masonryWall(59.75,-7.75, 59.75,-12.25, 8.6, MAT.stone, {thick:0.5});
  rubblePile(62,-10,3,14,MAT.stone);
  // --- ruined cottage (German side) ---
  makeHouse(-32,-66, 6,5, 2.4, MAT.plaster, {ruin:2, doorSide:2});
}

// ---------- dressing: stumps, crosses, crates, fires ----------
{
  const stumpMat=new THREE.MeshStandardMaterial({color:0x2e2318,roughness:1});
  for(let i=0;i<40;i++){ const x=rand(-110,110),z=rand(-110,110);
    if(Math.abs(Math.abs(z)-62)<9||Math.hypot(x,z)<18) continue;
    const h=rand(0.8,2.6);
    const t=new THREE.Mesh(new THREE.CylinderGeometry(rand(0.12,0.3),rand(0.25,0.45),h,7),stumpMat);
    t.position.set(x,h/2,z); t.rotation.z=rand(-0.2,0.2); t.castShadow=true; scene.add(t);
    if(Math.random()<0.4){ const br=new THREE.Mesh(new THREE.CylinderGeometry(0.05,0.09,rand(0.6,1.4),5),stumpMat);
      br.position.set(x+rand(-0.3,0.3),h*0.8,z); br.rotation.z=rand(0.5,1.2); scene.add(br); }
  }
  // field-gun wreck + limbers
  const gun=new THREE.Group();
  const shield=new THREE.Mesh(new THREE.BoxGeometry(2.2,1.1,0.12),new THREE.MeshStandardMaterial({color:0x4c5245,roughness:0.7,metalness:0.4}));
  shield.position.y=1; shield.rotation.x=-0.15; gun.add(shield);
  const barrel=new THREE.Mesh(new THREE.CylinderGeometry(0.09,0.13,3,10),MAT.metal); barrel.rotation.x=Math.PI/2-0.1; barrel.position.set(0,1,1.4); gun.add(barrel);
  for(const s of [-1,1]){ const w=new THREE.Mesh(new THREE.TorusGeometry(0.65,0.12,8,18),MAT.darkwood); w.position.set(s*1.2,0.65,0); gun.add(w); }
  gun.position.set(24,0,40); gun.rotation.y=0.7; gun.traverse(o=>{o.castShadow=true;}); scene.add(gun);
  addCollider(22.5,38.5,25.5,41.5);
  coverPoints.push(V3(22,0,38),V3(26,0,42));
  // grave markers row (British rear)
  const crossMat=MAT.wood;
  for(let i=0;i<9;i++){ const c=new THREE.Group();
    const v=new THREE.Mesh(new THREE.BoxGeometry(0.12,1.1,0.12),crossMat); v.position.y=0.55; c.add(v);
    const hbar=new THREE.Mesh(new THREE.BoxGeometry(0.55,0.12,0.12),crossMat); hbar.position.y=0.8; c.add(hbar);
    c.position.set(-30+i*2.2,0,86+rand(-1,1)); c.rotation.y=rand(-0.2,0.2); scene.add(c); }
}
// ammo crates (resupply)
function addAmmoCrate(x,z){
  const g=new THREE.Group();
  const box=new THREE.Mesh(new THREE.BoxGeometry(1.2,0.7,0.7),MAT.wood); box.position.y=0.35; box.castShadow=true; g.add(box);
  const lid=new THREE.Mesh(new THREE.BoxGeometry(1.24,0.1,0.74),MAT.darkwood); lid.position.y=0.74; g.add(lid);
  const cross=new THREE.Mesh(new THREE.BoxGeometry(0.5,0.12,0.02),new THREE.MeshStandardMaterial({color:0xc9a227})); cross.position.set(0,0.4,0.36); g.add(cross);
  g.position.set(x,0,z); scene.add(g);
  ammoCrates.push({pos:V3(x,0,z),mesh:g});
}
[[-20,60],[20,60],[-45,60],[45,60],[0,74],[-20,-60],[20,-60],[0,-74]].forEach(([x,z])=>addAmmoCrate(x,z));
// braziers (fire + light + smoke source)
const fires=[];
function addFire(x,z){
  const g=new THREE.Group();
  const bowl=new THREE.Mesh(new THREE.CylinderGeometry(0.5,0.35,0.5,10),MAT.metal); bowl.position.y=0.5; g.add(bowl);
  const l=new THREE.PointLight(0xff8a30, 6, 12, 2); l.position.y=1.2; g.add(l);
  const fl=new THREE.Sprite(new THREE.SpriteMaterial({map:flashTex,color:0xffa040,transparent:true,blending:THREE.AdditiveBlending,depthWrite:false}));
  fl.scale.set(1.2,1.2,1); fl.position.y=1.1; g.add(fl);
  g.position.set(x,0,z); scene.add(g);
  fires.push({pos:V3(x,1,z),light:l,sprite:fl,seed:Math.random()*10});
}
addFire(-8,60); addFire(30,58); addFire(-6,-60); addFire(10,-60); addFire(3,4);

// distant treeline silhouette + observation balloons
{
  const mat=new THREE.MeshBasicMaterial({color:0x4c4a42, fog:true});
  for(let i=0;i<60;i++){ const a=(i/60)*Math.PI*2; const r=rand(150,210);
    const h=rand(6,16);
    const t=new THREE.Mesh(new THREE.ConeGeometry(rand(3,7),h,6),mat);
    t.position.set(Math.cos(a)*r,h/2-2,Math.sin(a)*r); scene.add(t); }
  const balMat=new THREE.MeshStandardMaterial({color:0x9a917e,roughness:0.8});
  for(const [x,z] of [[-90,-120],[80,-130]]){ const b=new THREE.Mesh(new THREE.SphereGeometry(6,12,10),balMat);
    b.scale.set(1,1.35,1); b.position.set(x,70,z); scene.add(b);
    const line=new THREE.Line(new THREE.BufferGeometry().setFromPoints([V3(x,64,z),V3(x,0,z)]),new THREE.LineBasicMaterial({color:0x222222})); scene.add(line); }
}
// low overcast cloud deck (big soft sprites drifting slowly)
const clouds=[];
for(let i=0;i<10;i++){
  const s=new THREE.Sprite(new THREE.SpriteMaterial({map:smokeTex,transparent:true,opacity:rand(0.35,0.6),depthWrite:false,color:0x9a968c}));
  const sc=rand(60,120); s.scale.set(sc,sc*0.35,1);
  s.position.set(rand(-220,220),rand(70,110),rand(-220,220));
  scene.add(s); clouds.push({s,spd:rand(0.4,1.1)});
}

// ---------- particle FX ----------
const FX = {
  smokeMax:140, list:[],
  spawnSmoke(x,y,z,{big=false,dark=false,life=4}={}){
    if(this.list.length>this.smokeMax) return;
    const s=new THREE.Sprite(new THREE.SpriteMaterial({map:smokeTex,transparent:true,opacity:0.5,depthWrite:false,color:dark?0x3a352c:0xbdb6a8}));
    const sc=big?rand(4,7):rand(1.2,2.6); s.scale.set(sc,sc,1); s.position.set(x+rand(-1,1),y,z+rand(-1,1));
    scene.add(s); this.list.push({s,life,max:life,vy:big?rand(1.5,2.5):rand(0.6,1.4),grow:big?1.6:0.7});
  },
  spawnFlash(x,y,z,scale=2){
    const s=new THREE.Sprite(new THREE.SpriteMaterial({map:flashTex,transparent:true,blending:THREE.AdditiveBlending,depthWrite:false}));
    s.scale.set(scale,scale,1); s.position.set(x,y,z); scene.add(s);
    this.list.push({s,life:0.12,max:0.12,vy:0,grow:0,flash:true});
  },
  burst(x,y,z,n=10,color=0x6b5a40,spd=4){
    const geo=new THREE.BufferGeometry(); const p=new Float32Array(n*3),v=[];
    for(let i=0;i<n;i++){ p[i*3]=x;p[i*3+1]=y;p[i*3+2]=z; v.push(V3(rand(-spd,spd),rand(0,spd),rand(-spd,spd))); }
    geo.setAttribute('position',new THREE.BufferAttribute(p,3));
    const m=new THREE.PointsMaterial({color,size:0.14,transparent:true,opacity:1});
    const pts=new THREE.Points(geo,m); scene.add(pts);
    this.list.push({pts,v,life:0.7,max:0.7,debris:true});
  },
  blood(x,y,z){ this.burst(x,y,z,12,0x6e1414,3); },
  update(dt){
    for(let i=this.list.length-1;i>=0;i--){ const p=this.list[i]; p.life-=dt;
      if(p.life<=0){ scene.remove(p.s||p.pts); (p.s?.material||p.pts?.material)?.dispose?.(); if(p.pts?.geometry)p.pts.geometry.dispose(); this.list.splice(i,1); continue; }
      const t=p.life/p.max;
      if(p.flash){ p.s.material.opacity=t; }
      else if(p.debris){ const a=p.pts.geometry.attributes.position;
        for(let j=0;j<p.v.length;j++){ p.v[j].y-=9*dt; a.array[j*3]+=p.v[j].x*dt; a.array[j*3+1]+=p.v[j].y*dt; a.array[j*3+2]+=p.v[j].z*dt; }
        a.needsUpdate=true; p.pts.material.opacity=t;
      } else { p.s.position.y+=p.vy*dt; const g=p.s.scale.x+p.grow*dt; p.s.scale.set(g,g,1); p.s.material.opacity=0.5*t; }
    }
  }
};
// tracers
const tracers=[];
function spawnTracer(a,b,color=0xffe0a0){
  const g=new THREE.BufferGeometry().setFromPoints([a,b]);
  const l=new THREE.Line(g,new THREE.LineBasicMaterial({color,transparent:true,opacity:0.9}));
  scene.add(l); tracers.push({l,life:0.07});
}
function updateTracers(dt){ for(let i=tracers.length-1;i>=0;i--){ const t=tracers[i]; t.life-=dt;
  if(t.life<=0){ scene.remove(t.l); t.l.geometry.dispose(); t.l.material.dispose(); tracers.splice(i,1); } } }

// ambient battlefield smoke + drifting fog patches
for(let i=0;i<14;i++) FX.spawnSmoke(rand(-90,90),rand(2,9),rand(-70,70),{big:true,life:rand(6,14)});
// ambient smoke respawn timer handled in loop

// ---------- soldier models: rigged GLB (three.js example asset, Mixamo rig) + procedural fallback ----------
let soldierLib = null; // {scene, clips:{idle,walk}}
const soldierReady = new Promise(resolve=>{
  new GLTFLoader(loadManager).load('models/Soldier.glb',
    glb=>{
      const clips={};
      for(const c of glb.animations) clips[c.name.toLowerCase()]=c;
      soldierLib={scene:glb.scene, clips};
      resolve(true);
    },
    undefined,
    ()=>resolve(false)); // fallback to procedural on failure
});
const teamMats = { brit:[], ger:[] };
function tintedSoldierMats(team){
  if(teamMats[team].length) return teamMats[team];
  const tint = team==='brit' ? new THREE.Color(0xf0cf9a) : new THREE.Color(0xc9d2c6);
  // clone materials from lib, lift shadows so troops read in overcast light
  soldierLib.scene.traverse(o=>{
    if(o.isMesh){
      const ms = Array.isArray(o.material)?o.material:[o.material];
      for(const m of ms){
        if(!teamMats[team].find(e=>e.src===m)){
          const c=m.clone(); c.color.multiply(tint);
          c.emissive=new THREE.Color(tint).multiplyScalar(0.07);
          teamMats[team].push({src:m, mat:c});
        }
      }
    }
  });
  return teamMats[team];
}
function soldierMatFor(team, src){
  const e=tintedSoldierMats(team).find(e=>e.src===src);
  return e?e.mat:src;
}
function makeCarriedRifle(){
  // bolt-action rifle sized for the rigged hands
  const g=new THREE.Group();
  const stock=new THREE.Mesh(new THREE.BoxGeometry(0.07,0.11,0.75),MAT.gunwood); g.add(stock);
  const fore=new THREE.Mesh(new THREE.BoxGeometry(0.06,0.07,0.4),MAT.gunwood); fore.position.z=-0.5; g.add(fore);
  const barrel=new THREE.Mesh(new THREE.CylinderGeometry(0.022,0.022,0.55,8),MAT.metal);
  barrel.rotation.x=Math.PI/2; barrel.position.z=-0.9; g.add(barrel);
  const bolt=new THREE.Mesh(new THREE.BoxGeometry(0.03,0.1,0.05),MAT.metal); bolt.position.set(0.05,0.04,-0.15); g.add(bolt);
  g.traverse(o=>{if(o.isMesh)o.castShadow=true;});
  return g;
}
function makeHelmet(team){
  // period helmets sized for the GLB head, attached to the head bone
  const g=new THREE.Group();
  if(team==='brit'){
    const mat=new THREE.MeshStandardMaterial({color:0x6b6242,roughness:0.55,metalness:0.45});
    const brim=new THREE.Mesh(new THREE.CylinderGeometry(0.21,0.23,0.035,16),mat);
    const dome=new THREE.Mesh(new THREE.SphereGeometry(0.115,14,10,0,Math.PI*2,0,Math.PI/2),mat);
    dome.position.y=0.012; g.add(brim,dome);
  } else {
    const mat=new THREE.MeshStandardMaterial({color:0x53564a,roughness:0.5,metalness:0.5});
    const dome=new THREE.Mesh(new THREE.SphereGeometry(0.135,14,10,0,Math.PI*2,0,Math.PI/1.65),mat);
    const skirt=new THREE.Mesh(new THREE.CylinderGeometry(0.165,0.185,0.1,14),mat); skirt.position.y=-0.045;
    g.add(dome,skirt);
  }
  g.traverse(o=>{if(o.isMesh)o.castShadow=true;});
  return g;
}
function markerTexture(team){
  const c=document.createElement('canvas'); c.width=64;c.height=64; const g=c.getContext('2d');
  g.translate(32,32); g.rotate(Math.PI/4);
  g.fillStyle=team==='brit'?'#3f8cff':'#ff4d4d'; g.fillRect(-13,-13,26,26);
  g.lineWidth=5; g.strokeStyle='#fff'; g.strokeRect(-13,-13,26,26);
  const t=new THREE.CanvasTexture(c); return t;
}
const texMarkBrit = markerTexture('brit'), texMarkGer = markerTexture('ger');
const SKIN=[0xd9a986,0xc99878,0xb08264];
function buildSoldier(team){
  if(soldierLib) return buildRiggedSoldier(team);
  return buildPrimitiveSoldier(team);
}
function buildRiggedSoldier(team){
  const g=new THREE.Group();
  const model=cloneSkinned(soldierLib.scene);
  model.traverse(o=>{
    if(o.isMesh){
      o.castShadow=true; o.frustumCulled=false;
      if(/visor/i.test(o.name)) o.visible=false; // reveal face; period helmet goes on top
      const ms=Array.isArray(o.material)?o.material:[o.material];
      o.material=Array.isArray(o.material)?ms.map(m=>soldierMatFor(team,m)):soldierMatFor(team,o.material);
    }
  });
  g.add(model);
  // period helmet rides the head bone so it follows animations
  let head=null;
  model.traverse(o=>{ if(o.isBone&&/head$/i.test(o.name)&&!head) head=o; });
  if(!head) model.traverse(o=>{ if(o.isBone&&/head/i.test(o.name)&&!head) head=o; });
  if(head){ const h=makeHelmet(team); h.position.set(0,0.10,0.04); h.scale.setScalar(1.35); head.add(h); }
  // service rifle carried at the trail: fixed to the body so it always reads
  { const r=makeCarriedRifle(); r.position.set(0.24,1.05,0.28); r.rotation.set(0.12,0,-0.08); g.add(r); }
  // team marker
  const mark=new THREE.Sprite(new THREE.SpriteMaterial({map:team==='brit'?texMarkBrit:texMarkGer,depthTest:false,transparent:true,opacity:0.95}));
  mark.scale.set(0.55,0.55,1); mark.position.y=2.25; g.add(mark);
  // generous hitbox
  const hit=new THREE.Mesh(new THREE.BoxGeometry(0.85,1.9,0.85),new THREE.MeshBasicMaterial({visible:false}));
  hit.position.y=0.95; g.add(hit);
  // animation mixer: idle <-> walk blend
  const mixer=new THREE.AnimationMixer(model);
  const actions={};
  const play=(key,clip)=>{ if(!clip)return null; const a=mixer.clipAction(clip); a.play(); a.setEffectiveWeight(0); actions[key]=a; return a; };
  play('idle', soldierLib.clips.idle); play('walk', soldierLib.clips.walk);
  if(actions.idle) actions.idle.setEffectiveWeight(1);
  g.userData={hit,mark,mixer,actions,walkW:0,rigged:true,model};
  return g;
}
function buildPrimitiveSoldier(team){
  const g=new THREE.Group();
  const uni = team==='brit'?0x6e6046:0x5c6158;
  const uniMat=new THREE.MeshStandardMaterial({color:uni,roughness:0.95});
  const skinMat=new THREE.MeshStandardMaterial({color:SKIN[randi(0,2)],roughness:0.8});
  // legs
  const legG=new THREE.BoxGeometry(0.22,0.85,0.26);
  const legL=new THREE.Mesh(legG,uniMat); legL.position.set(-0.14,0.42,0); legL.castShadow=true; g.add(legL);
  const legR=new THREE.Mesh(legG,uniMat); legR.position.set(0.14,0.42,0); legR.castShadow=true; g.add(legR);
  // torso + webbing
  const torso=new THREE.Mesh(new THREE.BoxGeometry(0.55,0.75,0.32),uniMat); torso.position.y=1.2; torso.castShadow=true; g.add(torso);
  const belt=new THREE.Mesh(new THREE.BoxGeometry(0.57,0.1,0.34),new THREE.MeshStandardMaterial({color:0x2e2418})); belt.position.y=0.95; g.add(belt);
  const pack=new THREE.Mesh(new THREE.BoxGeometry(0.4,0.45,0.2),new THREE.MeshStandardMaterial({color:0x4a3d28})); pack.position.set(0,1.3,-0.26); g.add(pack);
  // arms
  const armG=new THREE.BoxGeometry(0.16,0.7,0.18);
  const armL=new THREE.Mesh(armG,uniMat); armL.position.set(-0.36,1.2,0.1); armL.rotation.x=-1.1; g.add(armL);
  const armR=new THREE.Mesh(armG,uniMat); armR.position.set(0.36,1.2,0.1); armR.rotation.x=-1.1; g.add(armR);
  // head
  const head=new THREE.Mesh(new THREE.SphereGeometry(0.16,10,8),skinMat); head.position.y=1.75; head.castShadow=true; g.add(head);
  let helmet;
  if(team==='brit'){ // Brodie flat helmet
    helmet=new THREE.Group();
    const brim=new THREE.Mesh(new THREE.CylinderGeometry(0.30,0.32,0.05,14),new THREE.MeshStandardMaterial({color:0x5a5238,roughness:0.7,metalness:0.3}));
    const dome=new THREE.Mesh(new THREE.SphereGeometry(0.17,12,8,0,Math.PI*2,0,Math.PI/2),brim.material);
    dome.position.y=0.02; helmet.add(brim,dome); helmet.position.y=1.86;
  } else { // German M16 coal-scuttle
    helmet=new THREE.Group();
    const mat=new THREE.MeshStandardMaterial({color:0x4a4d42,roughness:0.6,metalness:0.4});
    const dome=new THREE.Mesh(new THREE.SphereGeometry(0.19,12,8,0,Math.PI*2,0,Math.PI/1.7),mat); helmet.add(dome);
    const skirt=new THREE.Mesh(new THREE.CylinderGeometry(0.24,0.27,0.14,12),mat); skirt.position.y=-0.06; helmet.add(skirt);
    helmet.position.y=1.87;
  }
  g.add(helmet);
  // rifle held forward
  const rifle=new THREE.Group();
  const stock=new THREE.Mesh(new THREE.BoxGeometry(0.07,0.09,0.9),MAT.gunwood); rifle.add(stock);
  const barrel=new THREE.Mesh(new THREE.CylinderGeometry(0.025,0.025,0.7,6),MAT.metal); barrel.rotation.x=Math.PI/2; barrel.position.z=-0.6; rifle.add(barrel);
  rifle.position.set(0.15,1.25,-0.45); rifle.rotation.x=0.1; g.add(rifle);
  // team marker
  const mark=new THREE.Sprite(new THREE.SpriteMaterial({map:team==='brit'?texMarkBrit:texMarkGer,depthTest:false,transparent:true,opacity:0.95}));
  mark.scale.set(0.55,0.55,1); mark.position.y=2.45; g.add(mark);
  // hitbox (invisible, generous)
  const hit=new THREE.Mesh(new THREE.BoxGeometry(0.8,1.9,0.8),new THREE.MeshBasicMaterial({visible:false}));
  hit.position.y=0.95; g.add(hit);
  g.userData={legL,legR,armL,armR,head,torso,hit,mark,rifle};
  return g;
}

// ---------- weapons ----------
const WEAPONS = {
  rifle:{ name:'SMLE Mk III', magSize:5, damage:78, headMul:2.0, spreadHip:0.028, spreadAds:0.003, delay:1.0, reloadTime:3.3, range:220, auto:false, kick:0.035, adsFov:55 },
  revolver:{ name:'Webley Mk VI', magSize:6, damage:44, headMul:1.8, spreadHip:0.022, spreadAds:0.010, delay:0.34, reloadTime:2.6, range:90, auto:false, kick:0.028, adsFov:62 }
};

// viewmodel: rifle + hands
const viewmodel = new THREE.Group(); camera.add(viewmodel); scene.add(camera);
let vmRifle, vmRevolver, vmHands=[];
function buildViewmodel(){
  const gun = (woodLen)=>{
    const g=new THREE.Group();
    const stock=new THREE.Mesh(new THREE.BoxGeometry(0.07,0.11,0.55),MAT.gunwood); stock.position.z=0.1; g.add(stock);
    const body=new THREE.Mesh(new THREE.BoxGeometry(0.06,0.08,0.45),MAT.gunwood); body.position.z=-0.35; g.add(body);
    const barrel=new THREE.Mesh(new THREE.CylinderGeometry(0.022,0.022,0.5,8),MAT.metal); barrel.rotation.x=Math.PI/2; barrel.position.z=-0.75; g.add(barrel);
    const bolt=new THREE.Mesh(new THREE.BoxGeometry(0.03,0.03,0.12),MAT.metal); bolt.position.set(0.05,0.05,-0.2); g.add(bolt); g.userData.bolt=bolt;
    const sight=new THREE.Mesh(new THREE.BoxGeometry(0.015,0.05,0.015),MAT.metal); sight.position.set(0,0.07,-0.55); g.add(sight);
    g.traverse(o=>{o.frustumCulled=false;});
    return g;
  };
  vmRifle=gun(); vmRifle.position.set(0.28,-0.26,-0.55); vmRifle.scale.setScalar(0.85); viewmodel.add(vmRifle);
  vmRevolver=new THREE.Group();
  {
    const frame=new THREE.Mesh(new THREE.BoxGeometry(0.06,0.09,0.3),MAT.metal); vmRevolver.add(frame);
    const grip=new THREE.Mesh(new THREE.BoxGeometry(0.055,0.16,0.09),MAT.gunwood); grip.position.set(0,-0.1,0.12); grip.rotation.x=0.4; vmRevolver.add(grip);
    const cyl=new THREE.Mesh(new THREE.CylinderGeometry(0.045,0.045,0.12,10),MAT.metal); cyl.rotation.x=Math.PI/2; cyl.position.z=-0.05; vmRevolver.add(cyl);
    const bar=new THREE.Mesh(new THREE.CylinderGeometry(0.02,0.02,0.22,8),MAT.metal); bar.rotation.x=Math.PI/2; bar.position.z=-0.22; vmRevolver.add(bar);
    vmRevolver.traverse(o=>{o.frustumCulled=false;});
  }
  vmRevolver.position.set(0.26,-0.26,-0.45); vmRevolver.visible=false; viewmodel.add(vmRevolver);
  // hands: sleeves + skin
  const sleeveMat=new THREE.MeshStandardMaterial({color:0x5c4f36,roughness:1});
  const skinMat=new THREE.MeshStandardMaterial({color:0xa87c52,roughness:0.85});
  const mkHand=(x,y,z)=>{
    const h=new THREE.Group();
    const arm=new THREE.Mesh(new THREE.CylinderGeometry(0.055,0.065,0.4,8),sleeveMat); arm.rotation.x=1.2; h.add(arm);
    const hand=new THREE.Mesh(new THREE.BoxGeometry(0.08,0.06,0.14),skinMat); hand.position.set(0,-0.05,-0.2); h.add(hand);
    h.position.set(x,y,z); h.traverse(o=>{o.frustumCulled=false;}); viewmodel.add(h); vmHands.push(h); return h;
  };
  mkHand(0.28,-0.32,-0.75); mkHand(0.1,-0.3,-0.55);
  // viewmodel lighting: small fill so hands read in shadow
  const vl=new THREE.PointLight(0xfff2d8, 1.0, 4, 1.6); vl.position.set(0.2,-0.1,-0.8); viewmodel.add(vl);
}
buildViewmodel();

// ---------- game state ----------
const G = {
  phase:'menu', // menu|deploy|playing|paused|over
  time:0, matchTime:720, elapsed:0,
  scoreB:0, scoreG:0, cap:-0, capOwner:null, // -100 ger .. +100 brit
  player:null, bots:[],
  kills:0, deaths:0, shots:0, hits:0, caps:0,
  shakeT:0, lastDamageT:-99, bannerT:0,
  winner:null,
};
const WIN_SCORE=500;

function toast(msg,ms=2600){ const t=$('toast'); t.textContent=msg; t.classList.remove('hidden'); clearTimeout(t._h); t._h=setTimeout(()=>t.classList.add('hidden'),ms); }

// ---------- player ----------
class Player {
  constructor(){
    this.pos=V3(0,0,64); this.vel=V3();
    this.yaw=0; this.pitch=0; // face north (-z) toward the enemy
    this.hp=100; this.alive=true; this.crouch=false;
    this.weapon='rifle'; this.mag={rifle:5,revolver:6}; this.reserve={rifle:50,revolver:36};
    this.nextShot=0; this.reloading=0; this.reloadDur=0; this.ads=0; this.adsTarget=0;
    this.sprinting=false; this.onGround=true; this.vy=0; this.bob=0; this.stepT=0;
    this.respawnT=0; this.protectT=0; this.lastFire=0;
    this.recoil=0;
  }
  eyeH(){ return this.crouch?1.22:1.65; }
  speed(){ if(this.crouch) return 2.3; if(this.adsTarget>0.5) return 2.6; if(this.sprinting) return 6.4; return 4.3; }
  damage(amount, attacker){
    if(!this.alive||this.protectT>0) return;
    if(G.phase!=='playing') return;
    this.hp-=amount; G.lastDamageT=G.time;
    AudioSys.hurt();
    $('damage-flash').style.opacity=clamp(0.35+amount/120,0,0.9);
    setTimeout(()=>$('damage-flash').style.opacity=0,180);
    if(Settings.shake){ G.shakeT=Math.min(0.5,G.shakeT+amount/220); }
    showHitDir(attacker);
    if(this.hp<=0){ this.hp=0; this.die(attacker); }
  }
  die(attacker){
    this.alive=false; G.deaths++;
    const aname = attacker&&attacker.name?attacker.name:(attacker==='shell'?'SHELLFIRE':'THE ENEMY');
    if(attacker&&attacker.team==='ger'||attacker==='shell') { G.scoreG+=8; feed(`${aname} <span style="color:#c9a227">✠</span> YOU`, 'g'); }
    killMsg(`KILLED BY ${aname} — reforms at the trench in 6s`);
    document.body.classList.add('killcam');
    setTimeout(()=>document.body.classList.remove('killcam'),2500);
    this.respawnT=6;
  }
  respawn(){
    this.pos.set(rand(-4,4),0,64); this.hp=100; this.alive=true;
    this.mag.rifle=5; this.reserve.rifle=Math.max(this.reserve.rifle,20);
    this.mag.revolver=6; this.protectT=3; this.reloading=0;
    AudioSys.whistle();
  }
}
function showHitDir(fromDir){
  // red arc indicator pointing toward damage source
  const el=$('hitdir'); el.innerHTML='';
  const a=document.createElement('div'); a.className='hd';
  el.appendChild(a);
  setTimeout(()=>el.innerHTML='',700);
}
// hitdir css injected
{
  const st=document.createElement('style');
  st.textContent='#hitdir{position:absolute;left:50%;top:50%;width:0;height:0}.hd{position:absolute;left:-40px;top:-40px;width:80px;height:80px;border-radius:50%;border:6px solid transparent;border-top-color:rgba(255,40,40,.9);animation:hd .7s ease-out}@keyframes hd{from{opacity:1;transform:scale(1.2)}to{opacity:0;transform:scale(.9)}}';
  document.head.appendChild(st);
}

// ---------- bots ----------
let botId=0;
const NAMES_B=['A. Whitfield','T. Okafor','J. Merritt','S. Hardcastle','W. Davies','E. Thornton','R. Calloway','H. Prescott'];
const NAMES_G=['K. Brandt','O. Steiner','F. Vogel','H. Adler','M. Krüger','L. Hartmann','E. Richter','P. Neumann'];
class Bot {
  constructor(team, idx){
    this.id=botId++; this.team=team; this.name=(team==='brit'?NAMES_B:NAMES_G)[idx%8];
    this.mesh=buildSoldier(team); scene.add(this.mesh);
    this.hitMesh=this.mesh.userData.hit;
    this.pos=V3(); this.yaw=0; this.hp=100; this.alive=true;
    this.state='advance'; this.wp=null; this.repathT=0; this.fireT=rand(1,3); this.burstN=0;
    this.reloadT=0; this.mag=5; this.aimErr=rand(0.02,0.05);
    this.respawnT=0; this.coverT=0; this.strafeDir=Math.random()<0.5?-1:1; this.strafeT=0;
    this.moveSpd=rand(2.6,3.8); this.crouchT=0; this.lastSeen=null; this.killer=null;
    this.respawn();
  }
  respawn(){
    const t=this.team==='brit'?britTrench:gerTrench;
    this.pos.set(rand(-50,50),0,t.z+(t.team==='brit'?rand(2,8):rand(-8,-2)) + (this.team==='brit'?4:-4));
    this.hp=100; this.alive=true; this.mag=5; this.reloadT=0;
    this.mesh.visible=true; this.mesh.rotation.set(0,0,0);
    this.pickObjective(true);
  }
  pickObjective(force){
    // choose: mostly center, some trench defence
    const r=Math.random();
    if(this.team==='brit'){
      if(r<0.62) this.dest=V3(rand(-10,10),0,rand(-8,8));
      else if(r<0.8) this.dest=V3(rand(-40,40),0,rand(20,45));
      else this.dest=V3(rand(-55,55),0,rand(55,66));
    } else {
      if(r<0.62) this.dest=V3(rand(-10,10),0,rand(-8,8));
      else if(r<0.8) this.dest=V3(rand(-40,40),0,rand(-45,-20));
      else this.dest=V3(rand(-55,55),0,rand(-66,-55));
    }
    // route via nearest exit if crossing lines
    this.route=this.buildRoute();
  }
  buildRoute(){
    const pts=[this.pos.clone()];
    const myZ=this.pos.z, dZ=this.dest.z;
    const crossed=(myZ>50&&dZ<50)||(myZ<-50&&dZ>-50);
    if(crossed){
      const trench=this.team==='brit'?britTrench:gerTrench;
      // nearest exit
      let best=trench.exits[0],bd=1e9;
      for(const e of trench.exits){ const d=Math.abs(e.x-this.pos.x); if(d<bd){bd=d;best=e;} }
      pts.push(V3(best.x,0,this.pos.z), V3(best.x,0,best.z+(this.team==='brit'?-14:14)));
      // crater hop
      const c=craters[randi(0,craters.length-1)];
      if(c) pts.push(V3(c.x,0,c.z));
    }
    pts.push(this.dest.clone());
    return pts;
  }
  get eye(){ return V3(this.pos.x,1.6,this.pos.z); }
  // cached, staggered sensing: returns [{kind:'bot',bot} | {kind:'player'}, d]
  senseEnemies(){
    const out=[];
    for(const b of G.bots){
      if(b.team===this.team||!b.alive) continue;
      const d=this.eye.distanceTo(V3(b.pos.x,1.5,b.pos.z));
      if(d>90) continue;
      if(!los(this.eye, V3(b.pos.x,1.4,b.pos.z))) continue;
      out.push({kind:'bot',bot:b,d});
    }
    if(this.team==='ger'&&G.player&&G.player.alive){
      const p=G.player;
      const d=this.eye.distanceTo(V3(p.pos.x,p.pos.y+p.eyeH(),p.pos.z));
      if(d<90&&los(this.eye,V3(p.pos.x,p.pos.y+p.eyeH()-0.1,p.pos.z))) out.push({kind:'player',d});
    }
    out.sort((a,b2)=>a.d-b2.d);
    return out;
  }
  targetPos(t){ return t.kind==='bot'?t.bot.eyePos():V3(G.player.pos.x,G.player.pos.y+G.player.eyeH(),G.player.pos.z); }
  targetMotion(t){ return t.kind==='bot'?(t.bot.moving?1:0):((keys.KeyW||keys.KeyA||keys.KeyS||keys.KeyD)?1:0); }
  eyePos(){ return V3(this.pos.x, (this.crouchT>0?1.25:1.6), this.pos.z); }
  update(dt){
    if(!this.alive){
      this.respawnT-=dt;
      if(this.respawnT<=0) this.respawn();
      return;
    }
    if(this.reloadT>0){ this.reloadT-=dt; if(this.reloadT<=0) this.mag=5; }
    this.repathT-=dt; this.fireT-=dt; this.strafeT-=dt; this.senseT=(this.senseT??0)-dt;
    if(this.senseT<=0){ this.senseT=0.25+Math.random()*0.15; this._foes=this.senseEnemies(); }
    if(this.strafeT<=0){ this.strafeT=rand(1,2.5); this.strafeDir=Math.random()<0.5?-1:1; if(Math.random()<0.3)this.strafeDir=0; }
    // desired movement
    let move=V3();
    const foes=this._foes||[];
    const tgt=foes[0];
    if(tgt){
      const tpos=this.targetPos(tgt);
      this._seen={pos:V3(tpos.x,0,tpos.z),t:G.time};
      // face enemy
      const dx=tpos.x-this.pos.x, dz=tpos.z-this.pos.z;
      this.yaw=Math.atan2(dx,dz);
      // behavior: if close & exposed → strafe to cover; mid → strafe + fire; far → advance while firing
      const d=tgt.d;
      this.crouchT = (d>18&&Math.random()<0.02)?rand(1,2.5):Math.max(0,this.crouchT-dt);
      if(d<10){ // too close: back/strafe
        const nx=-dx/d, nz=-dz/d;
        move.set(nx+this.strafeDir*-nz*0.8,0,nz+this.strafeDir*nx*0.8);
      } else if(d<45){
        // strafe around cover, don't stand in open: sidestep perpendicular
        const nx=dx/d, nz=dz/d;
        move.set(this.strafeDir*-nz*0.9 + (this.inOpen()?nx*0.4:0),0,this.strafeDir*nx*0.9 + (this.inOpen()?nz*0.4:0));
        // occasionally push toward objective
        if(Math.random()<0.005) this.pickObjective();
      } else {
        move.set(dx/d,0,dz/d);
      }
      // fire control
      if(this.fireT<=0 && this.reloadT<=0 && tgt.d<75){
        this.shoot(tgt, tgt.d);
      }
    } else {
      // no enemy: move along route toward dest
      if(!this.route||this.route.length===0||this.repathT<=0){ if(Math.random()<0.1||!this.route||!this.route.length) this.pickObjective(); this.repathT=rand(4,8); }
      const rp=this.route&&this.route[0];
      if(rp){
        const dx=rp.x-this.pos.x,dz=rp.z-this.pos.z; const d=Math.hypot(dx,dz);
        if(d<2.5){ this.route.shift(); }
        else { move.set(dx/d,0,dz/d); this.yaw=Math.atan2(dx,dz); }
      }
      // lastSeen memory: look toward it briefly
      if(this._seen&&G.time-this._seen.t<4){
        const dx=this._seen.pos.x-this.pos.x,dz=this._seen.pos.z-this.pos.z;
        this.yaw=Math.atan2(dx,dz);
      }
      this.crouchT=Math.max(0,this.crouchT-dt);
    }
    // separation from other bots
    for(const o of G.bots){ if(o===this||!o.alive)continue;
      const dx=this.pos.x-o.pos.x,dz=this.pos.z-o.pos.z; const d2=dx*dx+dz*dz;
      if(d2<2.25&&d2>0.001){ const d=Math.sqrt(d2); move.x+=dx/d*0.8; move.z+=dz/d*0.8; } }
    // normalize + avoid walls
    if(move.lengthSq()>0.001){
      move.normalize();
      // probe ahead; if blocked, sidestep
      const px=this.pos.x+move.x*1.2, pz=this.pos.z+move.z*1.2;
      let blocked=false;
      for(const c of colliders){ if(px>c.x1-0.35&&px<c.x2+0.35&&pz>c.z1-0.35&&pz<c.z2+0.35){blocked=true;break;} }
      if(blocked){
        // try rotate ±60°
        const a1=Math.atan2(move.x,move.z)+1.05, a2=Math.atan2(move.x,move.z)-1.05;
        const m1=V3(Math.sin(a1),0,Math.cos(a1)), m2=V3(Math.sin(a2),0,Math.cos(a2));
        const b1=segBlocked(this.pos,m1), b2=segBlocked(this.pos,m2);
        move = (!b1)?m1:(!b2)?m2:V3(-move.x,0,-move.z);
        if(Math.random()<0.02) this.pickObjective();
      }
      const spd=this.moveSpd*(this.crouchT>0?0.55:1);
      this.pos.x+=move.x*spd*dt; this.pos.z+=move.z*spd*dt;
      collideCircle(this.pos,0.45);
      this.moving=true; this.moveDir=move.clone();
    } else this.moving=false;
    // mesh update
    this.mesh.position.set(this.pos.x, this.crouchT>0?-0.35:0, this.pos.z);
    const u=this.mesh.userData;
    if(u.rigged){
      this.mesh.rotation.y=this.yaw; // GLB faces +z
      u.mixer.update(dt);
      const target=this.moving?1:0;
      u.walkW+=(target-u.walkW)*Math.min(1,dt*6);
      if(u.actions.idle)u.actions.idle.setEffectiveWeight(1-u.walkW);
      if(u.actions.walk)u.actions.walk.setEffectiveWeight(u.walkW);
    } else {
      this.mesh.rotation.y=this.yaw+Math.PI; // rifle (local -z) points at enemy
      const t=G.time*9;
      if(this.moving){ u.legL.rotation.x=Math.sin(t)*0.6; u.legR.rotation.x=-Math.sin(t)*0.6; }
      else { u.legL.rotation.x*=0.9; u.legR.rotation.x*=0.9; }
    }
    // marker fade with distance from player camera
    const pd=camera.position.distanceTo(this.pos);
    u.mark.material.opacity = pd>95?0:clamp(1.2-pd/80,0.25,0.95);
    const s=clamp(pd/40,0.7,1.6)*0.55; u.mark.scale.set(s,s,1);
  }
  inOpen(){
    // exposed if far from any cover point or wall
    for(const c of coverPoints){ const dx=this.pos.x-c.x,dz=this.pos.z-c.z; if(dx*dx+dz*dz<36) return false; }
    return Math.abs(this.pos.z)<50; // in no-man's land counts as open unless near cover
  }
  shoot(tgt, dist){
    if(this.mag<=0){ this.reloadT=2.8; return; }
    this.mag--; this.fireT=rand(0.9,1.8); this.burstN++;
    const from=this.eyePos();
    const tpos=this.targetPos(tgt);
    const tMoving=this.targetMotion(tgt);
    const tCrouch=tgt.kind==='bot'?(tgt.bot.crouchT>0):G.player.crouch;
    const aimErr=this.aimErr*(1+dist/60)*(tMoving?1.4:1)*(tCrouch?1.3:1);
    const tp=tpos.clone(); tp.x+=rand(-1,1)*aimErr*dist*0.12; tp.y+=rand(-1,1)*aimErr*dist*0.08; tp.z+=rand(-1,1)*aimErr*dist*0.12;
    // muzzle fx
    FX.spawnFlash(from.x,from.y,from.z,1.4);
    spawnTracer(from, tp.clone(), 0xffd9a0);
    AudioSys.distantShot();
    // hit chance roll (distance + cover falloff)
    const inCov=tgt.kind==='bot'?!tgt.bot.inOpen()&&tgt.bot.crouchT>0:false;
    const cover = inCov?0.55:1;
    const pHit = clamp(0.42 - dist/220, 0.06, 0.42)*cover;
    if(Math.random()<pHit){
      const head=Math.random()<0.18;
      const dmg=(head?130:rand(45,75));
      if(tgt.kind==='bot') hurtBot(tgt.bot,dmg,this,head);
      else G.player.damage(dmg,this);
    }
    if(this.mag<=0) this.reloadT=2.8;
  }
}
function segBlocked(pos,dir){
  const px=pos.x+dir.x*1.2,pz=pos.z+dir.z*1.2;
  for(const c of colliders){ if(px>c.x1-0.35&&px<c.x2+0.35&&pz>c.z1-0.35&&pz<c.z2+0.35) return true; }
  return false;
}
const _losRay = new THREE.Raycaster();
function los(a,b){
  const dir=b.clone().sub(a); const dist=dir.length(); if(dist<0.001) return true; dir.normalize();
  _losRay.set(a,dir); _losRay.far=dist;
  const hits=_losRay.intersectObjects(losBlockers,false);
  return hits.length===0 || hits[0].distance>dist-0.8;
}
function hurtBot(bot,dmg,attacker,head){
  if(!bot.alive) return;
  bot.hp-=dmg;
  FX.blood(bot.pos.x,1.4,bot.pos.z);
  if(bot.hp<=0){
    bot.alive=false; bot.respawnT=rand(6,9);
    bot.mesh.rotation.x=-Math.PI/2; bot.mesh.position.y=0.25; bot.mesh.userData.mark.material.opacity=0;
    // score + feed
    const atkTeam = attacker==='player'?'brit':attacker.team;
    const vicTeam = bot.team;
    onKill(atkTeam, vicTeam, attacker==='player'?'YOU':attacker.name, bot.name, head);
    if(attacker==='player'){ G.kills++; AudioSys.hitmark(true); showHitmarker(true); }
    if(bot===playerTarget) playerTarget=null;
  } else {
    // react: face attacker, maybe relocate
    if(Math.random()<0.5&&attacker!=='player'){ /* keep simple */ }
    if(attacker==='player'){ AudioSys.hitmark(false); showHitmarker(false); G.hits++; }
  }
}
let playerTarget=null;
function onKill(atkTeam,vicTeam,atkName,vicName,head){
  if(atkTeam==='brit'){ G.scoreB+=8; } else { G.scoreG+=8; }
  feed(`${atkName} <span style="color:#c9a227">✠${head?' ⌖':''}</span> ${vicName}`, atkTeam==='brit'?'b':'g');
}

// ---------- HUD helpers ----------
function feed(html, cls){
  const kf=$('killfeed'); const d=document.createElement('div'); d.className='kf '+cls; d.innerHTML=html;
  kf.prepend(d); while(kf.children.length>5) kf.lastChild.remove();
  setTimeout(()=>{d.style.opacity='0';d.style.transition='0.5s'; setTimeout(()=>d.remove(),500);},6000);
}
function showHitmarker(kill){
  const h=$('hitmarker'); h.classList.remove('show','kill'); void h.offsetWidth;
  if(kill)h.classList.add('kill'); h.classList.add('show');
}
let killMsgT=null;
function killMsg(t){ const e=$('killmsg'); e.textContent=t; e.style.opacity=1; clearTimeout(killMsgT); killMsgT=setTimeout(()=>e.style.opacity=0,2600); }

// ---------- input ----------
const keys={};
addEventListener('keydown',e=>{
  keys[e.code]=true;
  if(G.phase==='playing'){
    if(e.code==='KeyR') startReload();
    if(e.code==='Digit1') switchWeapon('rifle');
    if(e.code==='Digit2') switchWeapon('revolver');
    if(e.code==='KeyC') { G.player.crouch=!G.player.crouch; AudioSys.click(); }
  }
  if(['Space','Tab'].includes(e.code)) e.preventDefault();
});
addEventListener('keyup',e=>{keys[e.code]=false;});
let mouseDown=false, adsDown=false;
addEventListener('mousedown',e=>{
  if(G.phase!=='playing') return;
  if(document.pointerLockElement!==canvas) return;
  if(e.button===0)mouseDown=true;
  if(e.button===2)adsDown=true;
});
addEventListener('mouseup',e=>{ if(e.button===0)mouseDown=false; if(e.button===2)adsDown=false; });
addEventListener('contextmenu',e=>e.preventDefault());
addEventListener('mousemove',e=>{
  if(G.phase!=='playing'||document.pointerLockElement!==canvas) return;
  const p=G.player; if(!p.alive) return;
  const s=0.0022*(p.adsTarget>0.5?Settings.adsSens:Settings.sens);
  p.yaw-=e.movementX*s;
  p.pitch-=e.movementY*s*(Settings.invert?-1:1);
  p.pitch=clamp(p.pitch,-1.45,1.45);
});
document.addEventListener('pointerlockchange',()=>{
  const locked=document.pointerLockElement===canvas;
  $('click-to-play').classList.toggle('hidden', locked||G.phase!=='playing');
  if(!locked&&G.phase==='playing') pauseGame();
});
canvas.addEventListener('click',()=>{
  if(G.phase==='playing'&&document.pointerLockElement!==canvas) canvas.requestPointerLock();
});
function lockPointer(){ try{ canvas.requestPointerLock(); }catch{} }

// ---------- combat: player shooting ----------
const raycaster=new THREE.Raycaster();
function playerShoot(){
  const p=G.player, w=WEAPONS[p.weapon];
  if(G.time<p.nextShot||p.reloading>0||!p.alive) return;
  if(p.mag[p.weapon]<=0){ AudioSys.empty(); startReload(); return; }
  p.mag[p.weapon]--; G.shots++; p.nextShot=G.time+w.delay; p.lastFire=G.time;
  p.recoil+=w.kick;
  AudioSys.init();
  if(p.weapon==='rifle')AudioSys.rifle(true); else AudioSys.revolver();
  // spread
  const moving=(keys.KeyW||keys.KeyA||keys.KeyS||keys.KeyD);
  const spread=(p.ads>0.5?w.spreadAds:w.spreadHip)*(moving?1.8:1)*(p.crouch?0.7:1);
  const dir=V3(0,0,-1).applyQuaternion(camera.quaternion);
  dir.x+=rand(-spread,spread);dir.y+=rand(-spread,spread);dir.z+=rand(-spread,spread);dir.normalize();
  const origin=camera.getWorldPosition(V3());
  // muzzle flash
  muzzleLight.position.copy(origin).add(dir.clone().multiplyScalar(1.2));
  muzzleLight.intensity=24; setTimeout(()=>muzzleLight.intensity=0,60);
  // viewmodel kick
  vmKick=1;
  raycaster.set(origin,dir); raycaster.far=w.range;
  // targets: bot hitboxes + obstacles
  const hitMeshes=[];
  for(const b of G.bots){ if(b.alive){ b.hitMesh.userData.bot=b; hitMeshes.push(b.hitMesh); } }
  const hitsBot=raycaster.intersectObjects(hitMeshes,false);
  const hitsWall=raycaster.intersectObjects(obstacles,true);
  const wallD=hitsWall.length?hitsWall[0].distance:Infinity;
  let end=origin.clone().add(dir.clone().multiplyScalar(Math.min(wallD,w.range)));
  if(hitsBot.length&&hitsBot[0].distance<wallD){
    const b=hitsBot[0].object.userData.bot;
    end=hitsBot[0].point.clone();
    // headshot if upper part
    const localY=hitsBot[0].point.y-(b.pos.y);
    const head=localY>1.6;
    hurtBot(b, w.damage*(head?w.headMul:1)*(1-hitsBot[0].distance/w.range*0.4), 'player', head);
    FX.blood(end.x,end.y,end.z);
  } else if(hitsWall.length&&hitsWall[0].distance<w.range){
    const pt=hitsWall[0].point;
    FX.burst(pt.x,pt.y+0.05,pt.z,7,0x8a7550,3);
    end=pt.clone();
  }
  spawnTracer(origin.clone().add(dir.clone().multiplyScalar(1.5)), end);
  // crosshair bloom
  crossBloom=Math.min(14,crossBloom+5);
  if(p.mag[p.weapon]===0) setTimeout(()=>{if(p.mag[p.weapon]===0)startReload();},350);
  updateAmmoHUD();
}
function startReload(){
  const p=G.player,w=WEAPONS[p.weapon];
  if(p.reloading>0||p.mag[p.weapon]>=w.magSize||p.reserve[p.weapon]<=0||!p.alive) return;
  p.reloading=w.reloadTime; p.reloadDur=w.reloadTime;
  AudioSys.reload(0); setTimeout(()=>AudioSys.reload(1),500); setTimeout(()=>AudioSys.reload(2),w.reloadTime*1000-400);
  if(p.weapon==='rifle') setTimeout(()=>AudioSys.bolt(),w.reloadTime*1000-200);
  $('reload-ring').classList.remove('hidden');
}
function finishReload(){
  const p=G.player,w=WEAPONS[p.weapon];
  const need=w.magSize-p.mag[p.weapon], take=Math.min(need,p.reserve[p.weapon]);
  p.mag[p.weapon]+=take; p.reserve[p.weapon]-=take;
  p.reloading=0; $('reload-ring').classList.add('hidden');
  updateAmmoHUD();
}
function switchWeapon(w){
  const p=G.player;
  if(p.weapon===w||p.reloading>0) return;
  p.weapon=w; AudioSys.click(); updateAmmoHUD();
  vmRifle.visible=(w==='rifle'); vmRevolver.visible=(w==='revolver');
  $('weapon-name').textContent=WEAPONS[w].name;
  $('slot1').className=w==='rifle'?'on':''; $('slot2').className=w==='revolver'?'on':'';
}
function updateAmmoHUD(){
  const p=G.player;
  $('ammo-mag').textContent=p.mag[p.weapon];
  $('ammo-res').textContent='/ '+p.reserve[p.weapon];
}

// ---------- match flow ----------
function startMatch(){
  if(!soldierLib){ toast('Still mustering — one moment…'); return; }
  // reset
  G.scoreB=0;G.scoreG=0;G.cap=0;G.capOwner=null;G.elapsed=0;G.kills=0;G.deaths=0;G.shots=0;G.hits=0;G.caps=0;G.winner=null;
  G.player=new Player();
  for(const b of G.bots) scene.remove(b.mesh);
  G.bots=[];
  for(let i=0;i<5;i++){ G.bots.push(new Bot('brit',i)); G.bots.push(new Bot('ger',i)); }
  // 6th German to make 5v6? spec says bots on both teams: 5 allies + 6 enemies + player = 6v6
  G.bots.push(new Bot('ger',5));
  G.phase='playing';
  for(const id of ['menu','deploy','settings','pause','gameover']) $(id).classList.remove('visible');
  $('hud').classList.remove('hidden');
  AudioSys.init(); AudioSys.whistle();
  lockPointer();
  toast('CAPTURE THE FARMHOUSE — follow the white tapes!');
  updateAmmoHUD();
  $('weapon-name').textContent=WEAPONS.rifle.name;
}
function pauseGame(){
  if(G.phase!=='playing') return;
  G.phase='paused'; $('pause').classList.add('visible');
  document.exitPointerLock?.();
}
function resumeGame(){
  if(G.phase!=='paused')return;
  G.phase='playing'; $('pause').classList.remove('visible'); lockPointer();
}
function endMatch(winner,reason){
  if(G.phase==='over')return;
  G.phase='over'; G.winner=winner;
  document.exitPointerLock?.();
  $('hud').classList.add('hidden'); $('gameover').classList.add('visible');
  const britWon=winner==='brit';
  $('go-kicker').textContent=reason||'BATTLE RESULT';
  $('go-title').textContent=britWon?'SECTOR TAKEN — WELL DONE':'SECTOR LOST — FALL BACK';
  $('go-title').style.color=britWon?'#ffe9a8':'#ff8a8a';
  $('go-detail').textContent=britWon?
    'The farmhouse is ours. The battalion holds the line — the Hun has withdrawn to his support trench.':
    'The enemy holds the farmhouse. Our company is spent — survivors filter back to the support line.';
  const acc=G.shots?Math.round(G.hits/G.shots*100):0;
  $('go-stats').innerHTML=`
    <div class="stat"><b>${G.kills}</b><span>KILLS</span></div>
    <div class="stat"><b>${G.deaths}</b><span>DEATHS</span></div>
    <div class="stat"><b>${acc}%</b><span>ACCURACY</span></div>
    <div class="stat"><b>${Math.round(G.scoreB)} : ${Math.round(G.scoreG)}</b><span>SCORE</span></div>`;
  if(britWon)AudioSys.whistle(); else AudioSys.explosion(10);
}
function quitToMenu(){
  G.phase='menu';
  for(const id of ['pause','gameover','deploy','settings']) $(id).classList.remove('visible');
  $('hud').classList.add('hidden'); $('menu').classList.add('visible');
  document.exitPointerLock?.();
}

// ---------- menu wiring ----------
$('btn-single').onclick=()=>{ AudioSys.init();AudioSys.click(); $('menu').classList.remove('visible'); $('deploy').classList.add('visible'); G.phase='deploy'; drawTacmap(); };
$('btn-multi').onclick=()=>{ toast('Multiplayer is not implemented — Coming Soon.'); };
$('btn-settings').onclick=()=>{ AudioSys.init();AudioSys.click(); $('menu').classList.remove('visible'); $('settings').classList.add('visible'); G._setFrom='menu'; };
$('btn-quit').onclick=()=>{ AudioSys.click(); toast('To quit: close this tab (browser environment).'); setTimeout(()=>{ try{window.close();}catch{} },600); };
$('btn-settings-back').onclick=()=>{ AudioSys.click(); $('settings').classList.remove('visible'); ($( 'pause').classList.contains('visible')?'pause':G._setFrom==='pause'?'pause':'menu'); if(G._setFrom==='pause'){ $('pause').classList.add('visible'); } else $('menu').classList.add('visible'); };
$('btn-deploy').onclick=()=>{ AudioSys.click(); startMatch(); };
$('btn-deploy-back').onclick=()=>{ $('deploy').classList.remove('visible'); $('menu').classList.add('visible'); G.phase='menu'; };
$('btn-resume').onclick=()=>resumeGame();
$('btn-restart').onclick=()=>{ $('pause').classList.remove('visible'); startMatch(); };
$('btn-quit-menu').onclick=()=>quitToMenu();
$('btn-again').onclick=()=>{ $('gameover').classList.remove('visible'); startMatch(); };
$('btn-go-menu').onclick=()=>quitToMenu();
// settings inputs
function bindSettings(){
  const s1=$('set-sens'),s2=$('set-ads'),v=$('set-vol');
  s1.value=Settings.sens; $('sens-val').textContent=Number(Settings.sens).toFixed(2);
  s2.value=Settings.adsSens; $('ads-val').textContent=Number(Settings.adsSens).toFixed(2);
  v.value=Settings.volume*100; $('vol-val').textContent=Math.round(Settings.volume*100)+'%';
  $('set-invert').checked=Settings.invert; $('set-shake').checked=Settings.shake; $('set-quality').value=Settings.quality;
  s1.oninput=()=>{Settings.sens=+s1.value;$('sens-val').textContent=Settings.sens.toFixed(2);Settings.save();};
  s2.oninput=()=>{Settings.adsSens=+s2.value;$('ads-val').textContent=Settings.adsSens.toFixed(2);Settings.save();};
  v.oninput=()=>{Settings.volume=v.value/100;$('vol-val').textContent=v.value+'%';AudioSys.setVolume(Settings.volume);Settings.save();};
  $('set-invert').onchange=e=>{Settings.invert=e.target.checked;Settings.save();};
  $('set-shake').onchange=e=>{Settings.shake=e.target.checked;Settings.save();};
  $('set-quality').onchange=e=>{Settings.quality=e.target.value;Settings.save();applyQuality();};
}
bindSettings();
applyQuality();

// tacmap + minimap
function drawTacmap(){
  const c=$('tacmap'),g=c.getContext('2d');
  g.fillStyle='#14110d';g.fillRect(0,0,300,300);
  const w2m=x=>(x+120)/240*300, m2w=z=>(z+120)/240*300;
  // no man's land shading
  g.fillStyle='#1d1a13'; g.fillRect(0,m2w(45),300,m2w(-45)-m2w(45));
  const trench=(z)=>{ g.strokeStyle='#8a7a52';g.lineWidth=4;g.beginPath();
    for(let x=-72;x<=72;x+=4){ const off=((Math.round(x/12))%2===0)?0:(z>0?-3:3); const px=w2m(x),py=m2w(z+off); x===-72?g.moveTo(px,py):g.lineTo(px,py);} g.stroke();
    g.strokeStyle='#5a4f38';g.lineWidth=2;g.beginPath();g.moveTo(w2m(-60),m2w(z+(z>0?14:-14)));g.lineTo(w2m(60),m2w(z+(z>0?14:-14)));g.stroke(); };
  trench(62); trench(-62);
  // wire
  g.strokeStyle='#aa4444';g.setLineDash([4,3]);g.beginPath();g.moveTo(w2m(-70),m2w(28));g.lineTo(w2m(70),m2w(28));g.stroke();
  g.beginPath();g.moveTo(w2m(-70),m2w(-28));g.lineTo(w2m(70),m2w(-28));g.stroke();g.setLineDash([]);
  // objective
  g.fillStyle='#c9a227';g.beginPath();g.arc(w2m(0),m2w(0),9,0,7);g.fill();
  g.fillStyle='#000';g.font='bold 11px sans-serif';g.textAlign='center';g.fillText('★',w2m(0),m2w(0)+4);
  g.fillStyle='#8d8064';g.font='11px sans-serif';g.fillText('BRITISH LINE (YOU)',w2m(0),m2w(82));g.fillText('GERMAN LINE',w2m(0),m2w(-72));
}
function drawMinimap(){
  const c=$('minimap'),g=c.getContext('2d'); const S=168;
  g.clearRect(0,0,S,S);
  g.fillStyle='rgba(20,17,12,0.9)';g.beginPath();g.arc(S/2,S/2,S/2,0,7);g.fill();
  g.save();g.beginPath();g.arc(S/2,S/2,S/2-2,0,7);g.clip();
  const w=x=>S/2+x/240*S, m=z=>S/2+z/240*S;
  g.strokeStyle='#6e6046';g.lineWidth=2.5;
  for(const z of [62,76,-62,-76]){ g.beginPath();g.moveTo(w(-72),m(z));g.lineTo(w(72),m(z));g.stroke(); }
  g.strokeStyle='#c9a227';g.lineWidth=1.5;g.beginPath();g.arc(w(0),m(0),Objective.radius/240*S,0,7);g.stroke();
  // flag color by owner
  g.fillStyle=G.capOwner==='brit'?'#3f8cff':G.capOwner==='ger'?'#ff4d4d':'#888';
  g.fillRect(w(0)-3,m(0)-3,6,6);
  const dot=(x,z,col,big)=>{ g.fillStyle=col;g.beginPath();g.arc(w(x),m(z),big?3.4:2.2,0,7);g.fill();g.strokeStyle='#000';g.lineWidth=1;g.stroke(); };
  for(const b of G.bots){ if(!b.alive)continue; dot(b.pos.x,b.pos.z,b.team==='brit'?'#4da3ff':'#ff5a5a',false); }
  if(G.player){ dot(G.player.pos.x,G.player.pos.z,'#ffe9a8',true);
    // view cone
    g.strokeStyle='rgba(255,233,168,0.7)';g.beginPath();g.moveTo(w(G.player.pos.x),m(G.player.pos.z));
    g.lineTo(w(G.player.pos.x-Math.sin(G.player.yaw)*14),m(G.player.pos.z-Math.cos(G.player.yaw)*14));g.stroke(); }
  g.restore();
}

// compass
function updateCompass(){
  const yaw=G.player?G.player.yaw:0;
  const pts=[['N',0],['NE',45],['E',90],['SE',135],['S',180],['SW',225],['W',270],['NW',315],['N',360]];
  // heading: yaw=π faces north? define heading deg
  let deg=(-yaw*180/Math.PI+360)%360; if(deg<0)deg+=360;
  const strip=$('compass-strip');
  let html='';
  for(const [label,a] of pts){ let d=((a-deg+540)%360)-180; const x=110+d*1.4; if(x>-30&&x<250) html+=`<span style="position:absolute;left:${x}px">${label}</span>`; }
  // objective marker
  if(G.player){ const dx=Objective.pos.x-G.player.pos.x,dz=Objective.pos.z-G.player.pos.z;
    let ang=Math.atan2(dx,-dz)*180/Math.PI; let d=((ang-deg+540)%360)-180; const x=110+d*1.4;
    if(x>-20&&x<240) html+=`<span style="position:absolute;left:${x}px;color:#c9a227">◈</span>`; }
  strip.innerHTML=html;
}

// ---------- per-frame update ----------
const clock=new THREE.Clock();
let crossBloom=0, vmKick=0, ambientT=2, artyT=5, mmT=0, capTickT=0;
const tmpV=V3();

function updatePlayer(dt){
  const p=G.player; if(!p) return;
  if(!p.alive){
    p.respawnT-=dt;
    camera.position.set(p.pos.x, 3.2, p.pos.z+4);
    camera.lookAt(p.pos.x,0.5,p.pos.z);
    if(p.respawnT<=0){ p.respawn(); toast('Back in the line — mind the wire.'); }
    return;
  }
  if(p.protectT>0)p.protectT-=dt;
  // ADS
  p.adsTarget=(adsDown&&p.reloading<=0)?1:0;
  p.ads+=(p.adsTarget-p.ads)*Math.min(1,dt*10);
  const w=WEAPONS[p.weapon];
  camera.fov=lerp(75,w.adsFov,p.ads); camera.updateProjectionMatrix();
  $('crosshair').classList.toggle('ads',p.ads>0.6);
  // movement: forward = -z rotated by yaw; right = +x rotated by yaw
  const f=(keys.KeyW?1:0)-(keys.KeyS?1:0), s=(keys.KeyD?1:0)-(keys.KeyA?1:0);
  p.sprinting=!!keys.ShiftLeft&&f>0&&!p.crouch&&p.ads<0.3;
  const sp=p.speed();
  const sin=Math.sin(p.yaw),cos=Math.cos(p.yaw);
  let mx=(-sin*f+cos*s), mz=(-cos*f-sin*s);
  const ml=Math.hypot(mx,mz)||1; if(f||s){mx/=ml;mz/=ml;}
  // wire slow
  let inWire=false;
  if(Math.abs(p.pos.z-28)<3||Math.abs(p.pos.z+28)<3) inWire=true;
  const spd=sp*(inWire?0.45:1);
  p.pos.x+=mx*spd*dt; p.pos.z+=mz*spd*dt;
  collideCircle(p.pos,0.42);
  // footsteps + bob
  if((f||s)){ p.bob+=dt*(p.sprinting?11:7); p.stepT-=dt;
    if(p.stepT<=0){ p.stepT=p.sprinting?0.32:0.45; AudioSys.step(p.sprinting); } }
  // reload
  if(p.reloading>0){ p.reloading-=dt; if(p.reloading<=0) finishReload(); }
  // fire (semi-auto handled on mousedown; hold-to-fire only for auto weapons)
  if(mouseDown&&w.auto) playerShoot();
  // ammo crates
  for(const c of ammoCrates){ if(p.pos.distanceTo(c.pos)<2.2){
    if(p.reserve.rifle<80||p.reserve.revolver<36){ p.reserve.rifle=Math.min(120,p.reserve.rifle+40*dt); p.reserve.revolver=Math.min(60,p.reserve.revolver+12*dt); updateAmmoHUD();
      if(!c._msgT||G.time-c._msgT>4){ c._msgT=G.time; $('hint').textContent='RESUPPLYING FROM AMMO CRATE…'; setTimeout(()=>$('hint').textContent='',1500); } }
  }}
  // regen
  if(G.time-G.lastDamageT>5&&p.hp<100){ p.hp=Math.min(100,p.hp+13*dt); $('heal-flash').style.opacity=0.5; }
  else $('heal-flash').style.opacity=0;
  // camera
  p.recoil=Math.max(0,p.recoil-dt*0.25);
  const bobY=Math.sin(p.bob)*0.035*(f||s?1:0), bobX=Math.cos(p.bob*0.5)*0.02*(f||s?1:0);
  camera.position.set(p.pos.x+bobX*Math.cos(p.yaw), p.pos.y+p.eyeH()+bobY, p.pos.z+bobX*Math.sin(p.yaw));
  camera.rotation.set(p.pitch+p.recoil, p.yaw, 0);
  // shake
  if(G.shakeT>0&&Settings.shake){ G.shakeT-=dt;
    camera.position.x+=rand(-1,1)*G.shakeT*0.25; camera.position.y+=rand(-1,1)*G.shakeT*0.25;
    camera.rotation.z+=rand(-1,1)*G.shakeT*0.05; }
  // viewmodel sway / position
  vmKick=Math.max(0,vmKick-dt*6);
  const adsP=p.ads;
  const hipPos={x:0.28,y:-0.26,z:-0.55}, adsPos={x:0,y:-0.175,z:-0.4};
  const vm= p.weapon==='rifle'?vmRifle:vmRevolver;
  vm.position.set(lerp(hipPos.x,adsPos.x,adsP), lerp(hipPos.y,adsPos.y,adsP)+Math.sin(p.bob)*0.008, lerp(hipPos.z,adsPos.z,adsP)+vmKick*0.09);
  vm.rotation.x=vmKick*0.25+p.recoil*2;
  // hide hands when ADS
  for(const h of vmHands) h.visible=adsP<0.7;
  $('crosshair').style.setProperty('--gap',(8+crossBloom+p.recoil*300)+'px');
  crossBloom=Math.max(0,crossBloom-dt*30);
  // reload anim: dip weapon
  if(p.reloading>0){ const t=1-p.reloading/p.reloadDur; vm.rotation.x=-0.7*Math.sin(t*Math.PI); vm.position.y-=0.15*Math.sin(t*Math.PI); }
  // bolt visual for rifle
  if(p.weapon==='rifle'&&vmRifle.userData.bolt){ vmRifle.userData.bolt.position.z=-0.2+clamp((G.time-p.lastFire)*3,0,1)*0+ (G.time-p.lastFire<0.4?0.08:0); }
  // health HUD
  const hb=$('health-bar').firstElementChild;
  hb.style.transform=`scaleX(${clamp(p.hp/100,0,1)})`;
  hb.style.background=p.hp>55?'linear-gradient(90deg,#6e6a4a,#c9b96a)':p.hp>25?'linear-gradient(90deg,#8a5a20,#d98a30)':'linear-gradient(90deg,#7a1f1f,#c94f4f)';
  $('health-num').textContent=Math.ceil(p.hp);
  $('stance').textContent=p.crouch?'CROUCHED':p.sprinting?'SPRINTING':p.ads>0.5?'AIMING':'STANDING';
}
// semi-auto fire on mousedown edge
addEventListener('mousedown',e=>{
  if(e.button!==0||G.phase!=='playing'||document.pointerLockElement!==canvas) return;
  const p=G.player; if(!p||!p.alive) return;
  const w=WEAPONS[p.weapon];
  if(!w.auto) playerShoot();
});

function updateObjective(dt){
  // count alive inside zone
  let nb=0,ng=0;
  if(G.player.alive&&Math.hypot(G.player.pos.x-Objective.pos.x,G.player.pos.z-Objective.pos.z)<Objective.radius) nb++;
  for(const b of G.bots){ if(!b.alive)continue;
    if(Math.hypot(b.pos.x-Objective.pos.x,b.pos.z-Objective.pos.z)<Objective.radius){ b.team==='brit'?nb++:ng++; } }
  const prev=G.cap;
  if(nb>0&&ng===0) G.cap=clamp(G.cap+dt*14*(1+nb*0.25),-100,100);
  else if(ng>0&&nb===0) G.cap=clamp(G.cap-dt*14*(1+ng*0.25),-100,100);
  else if(nb>0&&ng>0){ /* contested: freeze */ }
  else { // decay slowly to neutral
    if(G.cap>0)G.cap=Math.max(0,G.cap-dt*2); else G.cap=Math.min(0,G.cap+dt*2);
  }
  const owner=G.cap>=100?'brit':G.cap<=-100?'ger':G.capOwner&&Math.abs(G.cap)>25?G.capOwner:null;
  if((G.cap>=100||G.cap<=-100)&&G.capOwner!==(G.cap>0?'brit':'ger')){ G.caps+= (G.cap>0&&G.player.alive&&Math.hypot(G.player.pos.x, G.player.pos.z)<Objective.radius)?1:0; }
  if(G.cap>25)G.capOwner='brit'; else if(G.cap<-25)G.capOwner='ger'; else if(Math.abs(G.cap)<5)G.capOwner=null;
  if(prev!==G.cap&&(Math.abs(G.cap)%20<1)) AudioSys.cap();
  // score tick for holder
  capTickT+=dt;
  if(capTickT>=1){ capTickT=0;
    if(G.capOwner==='brit')G.scoreB+=2; else if(G.capOwner==='ger')G.scoreG+=2;
  }
  // HUD
  $('score-brit').textContent=Math.floor(G.scoreB); $('score-ger').textContent=Math.floor(G.scoreG);
  $('tbar-brit').style.transform=`scaleX(${clamp(G.scoreB/WIN_SCORE,0,1)})`;
  $('tbar-ger').style.transform=`scaleX(${clamp(G.scoreG/WIN_SCORE,0,1)})`;
  const fill=$('cap-fill');
  const v=G.cap/100; // -1..1
  if(v>=0){ fill.style.left='50%'; fill.style.width=(v*50)+'%'; fill.style.background='linear-gradient(90deg,#4da3ff,#ffe9a8)'; }
  else { fill.style.left=(50+v*50)+'%'; fill.style.width=(-v*50)+'%'; fill.style.background='linear-gradient(90deg,#ff5a5a,#ffb0b0)'; }
  const inZone=G.player.alive&&Math.hypot(G.player.pos.x-Objective.pos.x,G.player.pos.z-Objective.pos.z)<Objective.radius;
  const banner=$('zone-banner');
  if(inZone&&(nb>0&&ng>0)){ banner.textContent='⚔ CONTESTED — CLEAR THE ENEMY'; banner.classList.remove('hidden'); }
  else if(inZone&&G.capOwner!=='brit'){ banner.textContent='⚑ CAPTURING …'; banner.classList.remove('hidden'); }
  else if(inZone&&G.capOwner==='brit'){ banner.textContent='⚑ HOLD THE FARMHOUSE'; banner.classList.remove('hidden'); }
  else banner.classList.add('hidden');
  if(G.capOwner==='brit')$('obj-text').textContent='HOLD THE FARMHOUSE — WE FLY THE FLAG';
  else if(G.capOwner==='ger')$('obj-text').textContent='RETake THE FARMHOUSE — ENEMY HOLDS IT';
  else $('obj-text').textContent='CAPTURE THE FARMHOUSE ◈';
  // timer
  G.elapsed+=dt;
  const left=Math.max(0,G.matchTime-G.elapsed);
  $('timer').textContent=`${Math.floor(left/60)}:${String(Math.floor(left%60)).padStart(2,'0')}`;
  // win
  if(G.scoreB>=WIN_SCORE) endMatch('brit','DECISIVE BREAKTHROUGH');
  else if(G.scoreG>=WIN_SCORE) endMatch('ger','LINE COLLAPSE');
  else if(left<=0) endMatch(G.scoreB===G.scoreG?(Math.random()<0.5?'brit':'ger'):G.scoreB>G.scoreG?'brit':'ger','WHISTLE — FULL TIME');
}

// flag pole flag color
let flagMesh=null;
{
  const g=new THREE.PlaneGeometry(2.6,1.5,1,1);
  flagMesh=new THREE.Mesh(g,new THREE.MeshStandardMaterial({color:0x4da3ff,side:THREE.DoubleSide,roughness:0.9}));
  flagMesh.position.set(1.35,8,1); scene.add(flagMesh);
}
function updateFlag(){
  if(!flagMesh)return;
  const c=G.capOwner==='brit'?0x3f6fd1:G.capOwner==='ger'?0x8c2b2b:0x9a917e;
  flagMesh.material.color.setHex(c);
  flagMesh.rotation.y=Math.sin(G.time*1.5)*0.3;
  for(const c of clouds){ c.s.position.x+=c.spd*0.016; if(c.s.position.x>240)c.s.position.x=-240; }
}

// distant artillery
function artillery(dt){
  artyT-=dt;
  if(artyT<=0){
    artyT=rand(5,13);
    const x=rand(-70,70),z=rand(-45,45);
    FX.spawnFlash(x,2,z,10); FX.spawnSmoke(x,3,z,{big:true,dark:true,life:7}); FX.spawnSmoke(x,1,z,{big:false,life:3});
    const d=camera.position.distanceTo(V3(x,0,z));
    AudioSys.explosion(d);
    if(d<40&&Settings.shake) G.shakeT=Math.min(0.7,G.shakeT+0.35);
    // may wound anyone very close
    for(const b of G.bots){ if(!b.alive)continue; const dd=Math.hypot(b.pos.x-x,b.pos.z-z);
      if(dd<6){ const atk=G.bots.find(o=>o.alive&&o!==b&&o.team!==b.team);
        hurtBot(b,rand(40,110),atk||{name:'SHRAPNEL',team:b.team==='brit'?'ger':'brit'},false); } }
    if(G.player.alive){ const dd=Math.hypot(G.player.pos.x-x,G.player.pos.z-z); if(dd<6) G.player.damage(rand(30,70),'shell'); }
  }
  // ambient smoke upkeep
  ambientT-=dt;
  if(ambientT<=0){ ambientT=1.2;
    if(FX.list.length<FX.smokeMax*0.7){ const f=fires[randi(0,fires.length-1)]; FX.spawnSmoke(f.pos.x+rand(-1,1),2,f.pos.z+rand(-1,1),{life:rand(3,6)}); }
    if(Math.random()<0.5) FX.spawnSmoke(rand(-80,80),rand(3,10),rand(-60,60),{big:true,life:rand(5,9)});
    if(Math.random()<0.25) AudioSys.distantShot();
  }
  for(const f of fires){ f.sprite.material.opacity=0.75+Math.sin(G.time*11+f.seed)*0.2; f.light.intensity=5+Math.sin(G.time*13+f.seed)*1.6; }
}

function updateNameplates(){
  // enemy nameplate when aimed at (readability)
  raycaster.set(camera.getWorldPosition(tmpV), V3(0,0,-1).applyQuaternion(camera.quaternion));
  raycaster.far=60;
  const meshes=[]; for(const b of G.bots){ if(b.alive){b.hitMesh.userData.bot=b;meshes.push(b.hitMesh);} }
  const h=raycaster.intersectObjects(meshes,false);
  if(h.length){ const b=h[0].object.userData.bot;
    $('hint').textContent=`${b.team==='brit'?'▣ '+b.name+' — OUR BOY':'◉ '+b.name+' — ENEMY'} · ${Math.round(h[0].distance)}m`;
    playerTarget=b;
  } else if(!$('hint').textContent.startsWith('RESUP')){ $('hint').textContent=''; playerTarget=null; }
}

// ---------- main loop ----------
let _fpsAcc=0,_fpsN=0,_fpsT=0,_degraded=0;
function autoDegrade(dt){
  _fpsAcc+=dt; _fpsN++; _fpsT+=dt;
  if(_fpsT>=4){
    const fps=_fpsN/_fpsAcc;
    if(fps<22&&_degraded===0){ _degraded=1; renderer.setPixelRatio(Math.min(devicePixelRatio,0.85)); }
    else if(fps<16&&_degraded===1){ _degraded=2; sun.castShadow=false; renderer.setPixelRatio(0.65); }
    else if(fps<12&&_degraded===2){ _degraded=3; renderer.setPixelRatio(0.5); scene.fog.density=0.006; }
    _fpsAcc=0;_fpsN=0;_fpsT=0;
  }
}
function loop(){
  requestAnimationFrame(loop);
  const rawDt=Math.min(clock.getDelta(),0.5);
  autoDegrade(rawDt);
  const dt=Math.min(rawDt,0.05);
  if(G.phase==='playing'){
    G.time+=dt;
    updatePlayer(dt);
    for(const b of G.bots) b.update(dt);
    updateObjective(dt);
    updateFlag();
    artillery(dt);
    updateNameplates();
    FX.update(dt); updateTracers(dt);
    mmT-=dt; if(mmT<=0){mmT=0.25;drawMinimap();updateCompass();}
    // muzzle light decay
    if(muzzleLight.intensity>0)muzzleLight.intensity*=0.7;
  } else if(G.phase==='menu'||G.phase==='deploy'){
    // slow cinematic orbit behind menu
    G.time+=dt;
    const t=G.time*0.05;
    camera.position.set(Math.sin(t)*40, 14, 60+Math.cos(t*0.7)*10);
    camera.lookAt(0,1,0);
    camera.fov=60;camera.updateProjectionMatrix();
    FX.update(dt); updateTracers(dt); artillery(dt);
    for(const b of G.bots) b.update(dt);
  } else {
    FX.update(dt); updateTracers(dt);
  }
  renderer.render(scene,camera);
}
// idle scene bots so menu shows life (spawned once models + textures are in)
G.player=new Player();
drawTacmap();
{
  const b=$('btn-single');
  b.classList.add('disabled'); b.disabled=true;
  b.querySelector('.mbtn-top').textContent='MUSTERING…';
  let done=false;
  const muster=()=>{
    if(done) return; done=true;
    b.classList.remove('disabled'); b.disabled=false;
    b.querySelector('.mbtn-top').textContent='SINGLE PLAYER';
    for(let i=0;i<4;i++){ G.bots.push(new Bot('brit',i)); G.bots.push(new Bot('ger',i)); }
  };
  loadManager.onLoad=muster;
  setTimeout(muster, 15000); // safety net
}
// debug/testing handle (used by automated verification; harmless in production)
window.__itt={G,WEAPONS,Objective,playerShoot,startMatch,startReload,switchWeapon,THREE};
loop();
