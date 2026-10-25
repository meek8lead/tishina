import * as THREE from 'three';
import { PointerLockControls } from 'three/addons/controls/PointerLockControls.js';
import { createComposer } from './effects.js';

const SWIM_TOLERANCE = 0.6;

const state = {
  playing: false,
  oxygen: 100,
  battery: 100,
  flashlightOn: true,
  isSwimming: false,
  charging: false,
  dead: false,
  finished: false,
  finalSequence: false,
  finaleTime: 0,
  finaleTriggered: false,
  sluiceState: 'idle',
  sluiceTimer: 0,
  terminalOpen: false,
  inVoid: false,
  finalTextShown: false,
  roared: false,
  impacted: false,
};

const keys = { w: false, a: false, s: false, d: false, shift: false };

const waterZones = [
  { minX: -5, maxX: 5, minZ: 7, maxZ: 17, level: 1.5, active: true },
  { minX: -4, maxX: 4, minZ: 20, maxZ: 28, level: -2, active: false },
  { minX: -1.1, maxX: 1.1, minZ: 28, maxZ: 32, level: -2, active: false },
  { minX: -200, maxX: 200, minZ: 32, maxZ: 250, level: 12, active: true, noSurface: true },
];

let currentWaterLevel = -Infinity;

const dom = {
  o2Fill: document.getElementById('o2-fill'),
  vignette: document.getElementById('vignette'),
  segs: Array.from(document.querySelectorAll('.seg')),
  chargingOverlay: document.getElementById('charging-overlay'),
  interactPrompt: document.getElementById('interact-prompt'),
  startScreen: document.getElementById('start-screen'),
  deathScreen: document.getElementById('death-screen'),
  finalScreen: document.getElementById('final-screen'),
  finalText: document.querySelector('#final-screen .final-text'),
  restartBtn: document.getElementById('restart-btn'),
  terminalOverlay: document.getElementById('terminal-overlay'),
  terminalText: document.getElementById('terminal-text'),
  terminalBody: document.getElementById('terminal-body'),
  sluicePrompt: document.getElementById('sluice-prompt'),
  fadeOverlay: document.getElementById('fade-overlay'),
  messageFlash: document.getElementById('message-flash'),
};

// ─── Renderer / Scene / Camera ───
const canvas = document.getElementById('game-canvas');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x000000);
scene.fog = new THREE.FogExp2(0x02080a, 0.07);

const camera = new THREE.PerspectiveCamera(72, window.innerWidth / window.innerHeight, 0.05, 300);
scene.add(camera);

const controls = new PointerLockControls(camera, document.body);
const { composer, fxPass } = createComposer(renderer, scene, camera);

// ─── Player ───
const player = {
  pos: new THREE.Vector3(0, 1.6, 2),
  vel: new THREE.Vector3(),
  radius: 0.28,
  eyeHeight: 1.55,
  headClearance: 0.1,
  walkSpeed: 1.8,
  runSpeed: 3.0,
  swimSpeed: 1.4,
  bobTime: 0,
  bobAmount: 0,
};

// ─── Flashlight ───
const flashlight = new THREE.SpotLight(0xfff2cc, 22, 20, Math.PI / 6.5, 0.55, 1.0);
flashlight.position.set(0.1, -0.1, 0);
flashlight.target.position.set(0.1, -0.1, -1);
flashlight.castShadow = true;
flashlight.shadow.mapSize.set(1024, 1024);
flashlight.shadow.camera.near = 0.1;
flashlight.shadow.camera.far = 18;
flashlight.shadow.bias = -0.0008;
camera.add(flashlight);
camera.add(flashlight.target);
camera.add(new THREE.PointLight(0x334a55, 0.35, 3, 1.5));

// ════════════════════════════════════════════════════════════
//   WORLD BUILDERS
// ════════════════════════════════════════════════════════════
const colliders = [];

function addBox(cx, cy, cz, w, h, d, mat, collide = true, castShadow = false) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  mesh.position.set(cx, cy, cz);
  mesh.receiveShadow = true;
  mesh.castShadow = castShadow;
  scene.add(mesh);
  if (collide) {
    colliders.push(new THREE.Box3(
      new THREE.Vector3(cx - w / 2, cy - h / 2, cz - d / 2),
      new THREE.Vector3(cx + w / 2, cy + h / 2, cz + d / 2),
    ));
  }
  return mesh;
}
function addFloor(cx, cy, cz, w, d) { return addBox(cx, cy - 0.1, cz, w, 0.2, d, floorMat, true); }
function addCeiling(cx, cy, cz, w, d) { return addBox(cx, cy + 0.1, cz, w, 0.2, d, ceilMat, true); }

function wallX(zw, cx, w, h, cy, door) {
  if (!door) { addBox(cx, cy + h / 2, zw, w, h, 0.15, wallMat); return; }
  const xMin = cx - w / 2, xMax = cx + w / 2;
  const yMin = cy, yMax = cy + h;
  const { x1, x2, y1, y2 } = door;
  if (x1 > xMin) addBox((xMin + x1) / 2, (yMin + yMax) / 2, zw, x1 - xMin, h, 0.15, wallMat);
  if (x2 < xMax) addBox((x2 + xMax) / 2, (yMin + yMax) / 2, zw, xMax - x2, h, 0.15, wallMat);
  if (y1 > yMin) addBox((x1 + x2) / 2, (yMin + y1) / 2, zw, x2 - x1, y1 - yMin, 0.15, wallMat);
  if (y2 < yMax) addBox((x1 + x2) / 2, (y2 + yMax) / 2, zw, x2 - x1, yMax - y2, 0.15, wallMat);
}
function wallZ(xw, cz, d, h, cy, door) {
  if (!door) { addBox(xw, cy + h / 2, cz, 0.15, h, d, wallMat); return; }
  const zMin = cz - d / 2, zMax = cz + d / 2;
  const yMin = cy, yMax = cy + h;
  const { z1, z2, y1, y2 } = door;
  if (z1 > zMin) addBox(xw, (yMin + yMax) / 2, (zMin + z1) / 2, 0.15, h, z1 - zMin, wallMat);
  if (z2 < zMax) addBox(xw, (yMin + yMax) / 2, (z2 + zMax) / 2, 0.15, h, zMax - z2, wallMat);
  if (y1 > yMin) addBox(xw, (yMin + y1) / 2, (z1 + z2) / 2, 0.15, y1 - yMin, z2 - z1, wallMat);
  if (y2 < yMax) addBox(xw, (y2 + yMax) / 2, (z1 + z2) / 2, 0.15, yMax - y2, z2 - z1, wallMat);
}

function makeMetalTexture(size = 512) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#1c1c20';
  ctx.fillRect(0, 0, size, size);
  const img = ctx.getImageData(0, 0, size, size);
  const data = img.data;
  for (let i = 0; i < data.length; i += 4) {
    const n = (Math.random() - 0.5) * 34;
    data[i] = Math.max(0, Math.min(255, data[i] + n));
    data[i + 1] = Math.max(0, Math.min(255, data[i + 1] + n));
    data[i + 2] = Math.max(0, Math.min(255, data[i + 2] + n));
  }
  ctx.putImageData(img, 0, 0);
  for (let i = 0; i < 55; i++) {
    const x = Math.random() * size, y = Math.random() * size, r = Math.random() * 35 + 6;
    const grad = ctx.createRadialGradient(x, y, 0, x, y, r);
    grad.addColorStop(0, `rgba(95, 48, 22, ${0.15 + Math.random() * 0.2})`);
    grad.addColorStop(1, 'rgba(95, 48, 22, 0)');
    ctx.fillStyle = grad;
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
  }
  ctx.fillStyle = 'rgba(85, 85, 90, 0.85)';
  for (let i = 0; i < 8; i++) for (let j = 0; j < 8; j++) {
    const x = 32 + i * 56 + (Math.random() - 0.5) * 4;
    const y = 32 + j * 56 + (Math.random() - 0.5) * 4;
    ctx.beginPath(); ctx.arc(x, y, 2.2, 0, Math.PI * 2); ctx.fill();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 4;
  return tex;
}
const baseMetalTex = makeMetalTexture();

function makeMetalMaterial(rx = 1, ry = 1, tint = 0x8a8a90) {
  const t = baseMetalTex.clone();
  t.needsUpdate = true;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(rx, ry);
  return new THREE.MeshStandardMaterial({ map: t, roughness: 0.78, metalness: 0.5, color: tint });
}
const floorMat = makeMetalMaterial(4, 4);
const wallMat = makeMetalMaterial(3, 1.5);
const ceilMat = makeMetalMaterial(3, 3);
const crateMat = makeMetalMaterial(1, 1, 0x6a5a4a);
const doorMat = makeMetalMaterial(2, 2, 0x5a4a3a);

// ════════════════════════════════════════════════════════════
//   LEVEL GEOMETRY
// ════════════════════════════════════════════════════════════
addFloor(0, 0, 0, 6, 6);
addCeiling(0, 3, 0, 6, 6);
wallX(-3, 0, 6, 3, 0, null);
wallX(3, 0, 6, 3, 0, { x1: -1, x2: 1, y1: 0, y2: 2.2 });
wallZ(-3, 0, 6, 3, 0, null);
wallZ(3, 0, 6, 3, 0, null);

addFloor(0, 0, 5, 2, 4);
addCeiling(0, 3, 5, 2, 4);
wallZ(-1, 5, 4, 3, 0, null);
wallZ(1, 5, 4, 3, 0, null);

addFloor(0, -2, 12, 10, 10);
addCeiling(0, 3, 12, 10, 10);
wallX(7, 0, 10, 5, -2, { x1: -1, x2: 1, y1: 0, y2: 2.2 });
wallX(17, 0, 10, 5, -2, { x1: -1.5, x2: 1.5, y1: 0, y2: 2.5 });
wallZ(-5, 12, 10, 5, -2, null);
wallZ(5, 12, 10, 5, -2, null);

addFloor(0, 0, 18.5, 3, 3);
addCeiling(0, 2.5, 18.5, 3, 3);
wallZ(-1.5, 18.5, 3, 2.5, 0, null);
wallZ(1.5, 18.5, 3, 2.5, 0, null);

addFloor(0, 0, 24, 8, 8);
addCeiling(0, 3, 24, 8, 8);
wallX(20, 0, 8, 3, 0, { x1: -1.5, x2: 1.5, y1: 0, y2: 2.5 });
wallX(28, 0, 8, 3, 0, { x1: -1, x2: 1, y1: 0, y2: 2.5 });
wallZ(-4, 24, 8, 3, 0, null);
wallZ(4, 24, 8, 3, 0, null);

addFloor(0, 0, 30, 2, 4);
addCeiling(0, 3, 30, 2, 4);
wallZ(-1, 30, 4, 3, 0, null);
wallZ(1, 30, 4, 3, 0, null);

const outerDoorMesh = addBox(0, 1.25, 32, 2, 2.5, 0.15, doorMat, true);
const outerDoorCollider = colliders[colliders.length - 1];

const sluiceBackDoor = new THREE.Mesh(new THREE.BoxGeometry(3, 2.5, 0.2), doorMat);
sluiceBackDoor.position.set(0, 1.25, 20);
sluiceBackDoor.visible = false;
scene.add(sluiceBackDoor);
let backDoorCollider = null;

// ─── Props ───
function makePipe(x1, y1, z1, x2, y2, z2, r = 0.07) {
  const a = new THREE.Vector3(x1, y1, z1), b = new THREE.Vector3(x2, y2, z2);
  const dir = b.clone().sub(a);
  const mesh = new THREE.Mesh(
    new THREE.CylinderGeometry(r, r, dir.length(), 8, 1),
    new THREE.MeshStandardMaterial({ color: 0x2f2f34, roughness: 0.55, metalness: 0.75 }),
  );
  mesh.position.copy(a).addScaledVector(dir, 0.5);
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.clone().normalize());
  scene.add(mesh);
  return mesh;
}
makePipe(-2.9, 2.6, -2, -2.9, 2.6, 2);
makePipe(-2.8, 2.4, -2, -2.8, 2.4, 2, 0.05);
makePipe(-4.9, 2.7, 8, -4.9, 2.7, 16);
makePipe(4.9, 2.5, 8, 4.9, 2.5, 16, 0.06);
makePipe(-3.9, 2.7, 20.5, -3.9, 2.7, 27.5);
makePipe(-3.8, 2.5, 20.5, -3.8, 2.5, 27.5, 0.05);

{
  const curve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(-2, 3, 0), new THREE.Vector3(-1, 2.4, 0.2),
    new THREE.Vector3(0, 2.2, -0.1), new THREE.Vector3(1, 2.5, 0.1),
    new THREE.Vector3(2, 3, 0),
  ]);
  scene.add(new THREE.Mesh(new THREE.TubeGeometry(curve, 24, 0.04, 6, false),
    new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.9 })));
}

addBox(3, -1.65, 10, 0.7, 0.7, 0.7, crateMat, true, true);
addBox(-3, -1.65, 14, 0.7, 0.7, 0.7, crateMat, true, true);
addBox(2.5, 0.45, 26, 0.9, 0.9, 0.9, crateMat, true, true);
addBox(2.5, 1.05, 26, 0.6, 0.3, 0.6, crateMat, true, true);

// ─── Water surfaces ───
const waterMat = new THREE.ShaderMaterial({
  uniforms: {
    uTime: { value: 0 },
    uDeep: { value: new THREE.Color(0x041018) },
    uShallow: { value: new THREE.Color(0x0d3a48) },
  },
  vertexShader: `
    uniform float uTime;
    varying vec2 vUv;
    void main() {
      vUv = uv;
      vec3 p = position;
      p.z += sin(p.x * 2.5 + uTime * 1.2) * 0.06;
      p.z += cos(p.y * 2.0 + uTime * 0.9) * 0.06;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
    }
  `,
  fragmentShader: `
    uniform float uTime;
    uniform vec3 uDeep;
    uniform vec3 uShallow;
    varying vec2 vUv;
    void main() {
      float r1 = sin(vUv.x * 18.0 + uTime * 1.5) * 0.5 + 0.5;
      float r2 = cos(vUv.y * 15.0 - uTime * 1.1) * 0.5 + 0.5;
      vec3 col = mix(uDeep, uShallow, (r1 + r2) * 0.5);
      gl_FragColor = vec4(col, 0.82);
    }
  `,
  transparent: true,
  side: THREE.DoubleSide,
});

const waterSurfaces = [];
for (const z of waterZones) {
  if (z.noSurface) continue;
  const geo = new THREE.PlaneGeometry(z.maxX - z.minX, z.maxZ - z.minZ, 24, 24);
  const mesh = new THREE.Mesh(geo, waterMat);
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.set((z.minX + z.maxX) / 2, z.level, (z.minZ + z.maxZ) / 2);
  mesh.visible = !!z.active;
  scene.add(mesh);
  waterSurfaces.push({ zone: z, mesh });
}

// ─── Lights ───
scene.add(new THREE.AmbientLight(0x0a1018, 0.5));
const emergencyLight = new THREE.PointLight(0xff2200, 0.9, 8, 1.6);
emergencyLight.position.set(4.2, 2.7, 5.2);
scene.add(emergencyLight);
const emergencyLight2 = new THREE.PointLight(0xff3300, 0.5, 8, 1.8);
emergencyLight2.position.set(-3.5, 2.5, 24);
scene.add(emergencyLight2);
const underwaterLight = new THREE.PointLight(0x2a1010, 0.6, 10, 2);
underwaterLight.position.set(0, -1.5, 12);
scene.add(underwaterLight);
const terminalGlow = new THREE.PointLight(0x33ff55, 0.55, 3.5, 1.8);
terminalGlow.position.set(-3.5, 1.6, 26.5);
scene.add(terminalGlow);

// ════════════════════════════════════════════════════════════
//   DUST PARTICLES
// ════════════════════════════════════════════════════════════
const DUST_COUNT = 260;
const dustGeo = new THREE.BufferGeometry();
const dustPositions = new Float32Array(DUST_COUNT * 3);
const dustSeeds = new Float32Array(DUST_COUNT);
for (let i = 0; i < DUST_COUNT; i++) {
  dustPositions[i * 3]     = (Math.random() - 0.5) * 7;
  dustPositions[i * 3 + 1] = (Math.random() - 0.5) * 5;
  dustPositions[i * 3 + 2] = (Math.random() - 0.5) * 7;
  dustSeeds[i] = Math.random();
}
dustGeo.setAttribute('position', new THREE.BufferAttribute(dustPositions, 3));
dustGeo.setAttribute('seed', new THREE.BufferAttribute(dustSeeds, 1));

const dustMat = new THREE.ShaderMaterial({
  uniforms: {
    uTime: { value: 0 },
    uOpacity: { value: 0.0 },
    uColor: { value: new THREE.Color(0xfff0d4) },
    uSize: { value: 0.028 },
  },
  vertexShader: `
    attribute float seed;
    uniform float uTime;
    uniform float uSize;
    varying float vAlpha;
    void main() {
      vec3 p = position;
      float t = uTime + seed * 100.0;
      p.x += sin(t * 0.15 + seed * 6.28) * 0.7;
      p.y += cos(t * 0.11 + seed * 3.14) * 0.5 + mod(t * 0.03, 4.0) * 0.08;
      p.z += sin(t * 0.12 + seed * 2.0) * 0.7;
      vec4 mv = modelViewMatrix * vec4(p, 1.0);
      gl_Position = projectionMatrix * mv;
      float dist = length(mv.xyz);
      gl_PointSize = uSize * (260.0 / max(dist, 0.01));
      vAlpha = smoothstep(10.0, 0.3, dist) * (0.35 + 0.65 * abs(sin(t * 1.4 + seed * 9.1)));
    }
  `,
  fragmentShader: `
    uniform vec3 uColor;
    uniform float uOpacity;
    varying float vAlpha;
    void main() {
      vec2 uv = gl_PointCoord - 0.5;
      if (length(uv) > 0.5) discard;
      float a = smoothstep(0.5, 0.0, length(uv)) * vAlpha * uOpacity;
      gl_FragColor = vec4(uColor, a);
    }
  `,
  transparent: true,
  depthWrite: false,
  blending: THREE.AdditiveBlending,
});

const dustCloud = new THREE.Points(dustGeo, dustMat);
scene.add(dustCloud);

// ════════════════════════════════════════════════════════════
//   INTERACTABLES
// ════════════════════════════════════════════════════════════
const interactables = [];
let currentInteractable = null;
const raycaster = new THREE.Raycaster();
raycaster.far = 2.5;

function addInteractable(mesh, onInteract, prompt) {
  const obj = { mesh, onInteract, prompt };
  interactables.push(obj);
  return obj;
}

const tankSpecs = [
  { x: 3, y: -1.05, z: 10, onPickup: null },
  { x: -3, y: -1.05, z: 14, onPickup: null },
  { x: -2.5, y: 0.3, z: 26, onPickup: () => setTimeout(triggerScare, 2200) },
];
const allTanks = [];

function createO2Tank(spec) {
  const mesh = new THREE.Mesh(
    new THREE.CylinderGeometry(0.14, 0.16, 0.55, 10),
    new THREE.MeshStandardMaterial({
      color: 0xd4a017, roughness: 0.55, metalness: 0.7,
      emissive: 0x331800, emissiveIntensity: 0.4,
    }),
  );
  mesh.position.set(spec.x, spec.y, spec.z);
  mesh.castShadow = true;
  mesh.userData.collected = false;
  mesh.userData.baseY = spec.y;
  const valve = new THREE.Mesh(
    new THREE.CylinderGeometry(0.05, 0.05, 0.08, 8),
    new THREE.MeshStandardMaterial({ color: 0x333333, roughness: 0.5, metalness: 0.9 }),
  );
  valve.position.set(0, 0.3, 0);
  mesh.add(valve);
  scene.add(mesh);

  addInteractable(mesh, () => {
    if (mesh.userData.collected) return;
    mesh.userData.collected = true;
    mesh.visible = false;
    state.oxygen = 100;
    playTankPickup();
    if (spec.onPickup) spec.onPickup();
  }, '[E] Использовать баллон O₂');

  allTanks.push(mesh);
  return mesh;
}
tankSpecs.forEach(createO2Tank);

// Terminal
const terminalScreen = new THREE.Mesh(
  new THREE.PlaneGeometry(0.55, 0.35),
  new THREE.MeshBasicMaterial({ color: 0x0a2010 }),
);
terminalScreen.position.set(-3.7, 1.6, 26.5);
terminalScreen.rotation.y = Math.PI / 2;
scene.add(terminalScreen);

const termCasing = new THREE.Mesh(
  new THREE.BoxGeometry(0.6, 0.45, 0.15),
  new THREE.MeshStandardMaterial({ color: 0x2a2a2e, roughness: 0.6, metalness: 0.7 }),
);
termCasing.position.set(-3.7, 1.6, 26.5);
termCasing.rotation.y = Math.PI / 2;
scene.add(termCasing);

const terminalProxy = new THREE.Mesh(
  new THREE.BoxGeometry(0.1, 0.5, 0.6),
  new THREE.MeshBasicMaterial({ visible: false }),
);
terminalProxy.position.set(-3.6, 1.6, 26.5);
scene.add(terminalProxy);
addInteractable(terminalProxy, () => openTerminal(), '[E] Использовать терминал');

// ─── Scare pipe ───
let scarePipe = null, scarePipeActive = false, scarePipeTime = 0;
{
  scarePipe = new THREE.Mesh(
    new THREE.CylinderGeometry(0.09, 0.09, 1.3, 8),
    new THREE.MeshStandardMaterial({ color: 0x3a2a1a, roughness: 0.7, metalness: 0.6 }),
  );
  scarePipe.position.set(-2, 3.5, 22.5);
  scarePipe.visible = false;
  scarePipe.castShadow = true;
  scene.add(scarePipe);
}
function triggerScare() {
  if (state.dead || state.finished || state.finalSequence) return;
  playScareSound();
  scarePipe.visible = true;
  scarePipe.position.set(-2, 3.5, 22.5);
  scarePipe.rotation.set(0, 0, 0);
  scarePipeTime = 0;
  scarePipeActive = true;
  emergencyLight2.intensity = 0;
  setTimeout(() => { emergencyLight2.intensity = 0.5; }, 80);
  setTimeout(() => { emergencyLight2.intensity = 0; }, 150);
  setTimeout(() => { emergencyLight2.intensity = 0.5; }, 300);
}

// ════════════════════════════════════════════════════════════
//   THE FACE — redesigned
// ════════════════════════════════════════════════════════════
const FACE_Z = 90;
const FACE_Y = 4;
const faceGroup = new THREE.Group();
faceGroup.position.set(0, FACE_Y, FACE_Z);
scene.add(faceGroup);
const faceOriginalZ = FACE_Z;

// Head with Fresnel rim-glow shader (silhouette visible through fog)
const headMat = new THREE.ShaderMaterial({
  uniforms: {
    uColor: { value: new THREE.Color(0x0a0a14) },
    uRimColor: { value: new THREE.Color(0x4488cc) },
    uRimPower: { value: 2.5 },
    uGlowIntensity: { value: 0.55 },
    uFogColor: { value: new THREE.Color(0x00121a) },
    uFogDensity: { value: 0.016 },
  },
  vertexShader: `
    varying vec3 vNormal;
    varying vec3 vViewPos;
    varying float vDist;
    void main() {
      vNormal = normalize(normalMatrix * normal);
      vec4 mv = modelViewMatrix * vec4(position, 1.0);
      vViewPos = -mv.xyz;
      vDist = length(mv.xyz);
      gl_Position = projectionMatrix * mv;
    }
  `,
  fragmentShader: `
    uniform vec3 uColor;
    uniform vec3 uRimColor;
    uniform float uRimPower;
    uniform float uGlowIntensity;
    uniform vec3 uFogColor;
    uniform float uFogDensity;
    varying vec3 vNormal;
    varying vec3 vViewPos;
    varying float vDist;
    void main() {
      vec3 viewDir = normalize(vViewPos);
      float fresnel = pow(1.0 - max(dot(viewDir, vNormal), 0.0), uRimPower);
      vec3 col = uColor + uRimColor * fresnel * uGlowIntensity;
      float fogFactor = 1.0 - exp(-pow(vDist * uFogDensity, 2.0));
      col = mix(col, uFogColor, fogFactor);
      gl_FragColor = vec4(col, 1.0);
    }
  `,
});

{
  // Head geometry — noisy icosahedron radius 15
  const headGeo = new THREE.IcosahedronGeometry(15, 5);
  const pos = headGeo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const v = new THREE.Vector3().fromBufferAttribute(pos, i);
    const n = v.clone().normalize();
    const noise =
      Math.sin(v.x * 0.3) * Math.cos(v.y * 0.4) * Math.sin(v.z * 0.35) * 2.4 +
      Math.sin(v.x * 1.1 + v.z * 0.7) * 0.5 +
      (Math.random() - 0.5) * 0.6;
    v.addScaledVector(n, noise);
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  headGeo.computeVertexNormals();
  faceGroup.add(new THREE.Mesh(headGeo, headMat));
}

// Mouth — dark red, clearly IN FRONT of head surface (head front z ≈ -15)
const mouthMat = new THREE.MeshStandardMaterial({
  color: 0x1a0006,
  roughness: 0.7,
  metalness: 0.1,
  emissive: 0x550010,
  emissiveIntensity: 0.8,
  fog: true,
});
const mouth = new THREE.Mesh(new THREE.SphereGeometry(5.5, 24, 18), mouthMat);
mouth.position.set(0, -2.5, -19);
mouth.scale.set(1.2, 1.6, 0.65);
faceGroup.add(mouth);

// Glow inside mouth
const mouthLight = new THREE.PointLight(0xff2200, 0.9, 25, 2);
mouthLight.position.set(0, -2.5, -18);
faceGroup.add(mouthLight);

// Teeth — ring around mouth front edge (z ≈ -17, in front of head surface at -15)
for (let i = 0; i < 28; i++) {
  const angle = (i / 28) * Math.PI * 2;
  const rx = 5.6;
  const ry = 6.2;
  const x = Math.cos(angle) * rx;
  const y = -2.5 + Math.sin(angle) * ry;
  const z = -17;
  const tooth = new THREE.Mesh(
    new THREE.ConeGeometry(0.35, 1.9, 4),
    new THREE.MeshStandardMaterial({
      color: 0x3a2f28, roughness: 0.85, metalness: 0.05,
      emissive: 0x1a0808, emissiveIntensity: 0.4,
    }),
  );
  tooth.position.set(x, y, z);
  tooth.lookAt(x * 1.5, y, z - 5);
  faceGroup.add(tooth);
}

// Eyes — bright orbs clearly IN FRONT of head surface (z ≈ -17)
function makeEyeTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0.0, 'rgba(255, 255, 245, 1)');
  g.addColorStop(0.15, 'rgba(255, 240, 200, 1)');
  g.addColorStop(0.35, 'rgba(255, 190, 90, 0.9)');
  g.addColorStop(0.6, 'rgba(220, 90, 30, 0.45)');
  g.addColorStop(1.0, 'rgba(60, 0, 0, 0)');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(64, 64, 64, 0, Math.PI * 2);
  ctx.fill();
  return new THREE.CanvasTexture(c);
}

const eyeTex = makeEyeTexture();
const eyeMatProto = new THREE.SpriteMaterial({
  map: eyeTex,
  color: 0xffffff,
  fog: false,
  transparent: true,
  depthWrite: false,
  depthTest: false,
  blending: THREE.AdditiveBlending,
  opacity: 0.85,
});
const eye1 = new THREE.Sprite(eyeMatProto.clone());
eye1.position.set(-5, 3.5, -17.5);
eye1.scale.set(3.2, 3.2, 1);
faceGroup.add(eye1);

const eye2 = new THREE.Sprite(eyeMatProto.clone());
eye2.position.set(5, 3.5, -17.5);
eye2.scale.set(3.2, 3.2, 1);
faceGroup.add(eye2);

// Front key light — warm, illuminates the face from player's side
const faceKeyLight = new THREE.PointLight(0x99aacc, 1.8, 70, 1.5);
faceKeyLight.position.set(0, 4, -30);
faceGroup.add(faceKeyLight);

// Back rim light — dark purple, silhouettes the head from behind
const faceRimLight = new THREE.PointLight(0x3344aa, 2.5, 60, 1.6);
faceRimLight.position.set(0, 6, 12);
faceGroup.add(faceRimLight);

// Bioluminescent particles around the face — atmospheric glow
const bioGeo = new THREE.BufferGeometry();
const BIO_COUNT = 200;
const bioPos = new Float32Array(BIO_COUNT * 3);
const bioSeed = new Float32Array(BIO_COUNT);
for (let i = 0; i < BIO_COUNT; i++) {
  const r = 10 + Math.random() * 20;
  const theta = Math.random() * Math.PI * 2;
  const phi = Math.acos(2 * Math.random() - 1);
  bioPos[i * 3]     = r * Math.sin(phi) * Math.cos(theta);
  bioPos[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta) * 0.7;
  bioPos[i * 3 + 2] = r * Math.cos(phi);
  bioSeed[i] = Math.random();
}
bioGeo.setAttribute('position', new THREE.BufferAttribute(bioPos, 3));
bioGeo.setAttribute('seed', new THREE.BufferAttribute(bioSeed, 1));

const bioMat = new THREE.ShaderMaterial({
  uniforms: {
    uTime: { value: 0 },
    uOpacity: { value: 0.35 },
    uColor: { value: new THREE.Color(0x4488ff) },
  },
  vertexShader: `
    attribute float seed;
    uniform float uTime;
    varying float vAlpha;
    void main() {
      vec3 p = position;
      float t = uTime + seed * 100.0;
      p.x += sin(t * 0.25 + seed * 6.0) * 1.5;
      p.y += cos(t * 0.2 + seed * 3.0) * 1.2;
      p.z += sin(t * 0.3 + seed * 8.0) * 1.5;
      vec4 mv = modelViewMatrix * vec4(p, 1.0);
      gl_Position = projectionMatrix * mv;
      gl_PointSize = (2.0 + seed * 3.0) * (200.0 / max(length(mv.xyz), 1.0));
      vAlpha = 0.4 + 0.6 * sin(t * 2.0 + seed * 10.0);
    }
  `,
  fragmentShader: `
    uniform vec3 uColor;
    uniform float uOpacity;
    varying float vAlpha;
    void main() {
      vec2 uv = gl_PointCoord - 0.5;
      if (length(uv) > 0.5) discard;
      float a = smoothstep(0.5, 0.0, length(uv)) * vAlpha * uOpacity;
      gl_FragColor = vec4(uColor, a);
    }
  `,
  transparent: true,
  depthWrite: false,
  blending: THREE.AdditiveBlending,
});

const bioParticles = new THREE.Points(bioGeo, bioMat);
faceGroup.add(bioParticles);

// Store eye light refs so we can brighten during finale
const eyeLights = [eye1, eye2];

// ════════════════════════════════════════════════════════════
//   COLLISION
// ════════════════════════════════════════════════════════════
const playerAABB = new THREE.Box3();
function updatePlayerAABB() {
  playerAABB.min.set(player.pos.x - player.radius, player.pos.y - player.eyeHeight, player.pos.z - player.radius);
  playerAABB.max.set(player.pos.x + player.radius, player.pos.y + player.headClearance, player.pos.z + player.radius);
}
function isAABBNowFree() {
  for (const b of colliders) if (playerAABB.intersectsBox(b)) return false;
  return true;
}
function resolveCollisions() {
  updatePlayerAABB();
  for (const box of colliders) {
    if (!playerAABB.intersectsBox(box)) continue;
    const overlapX = Math.min(playerAABB.max.x - box.min.x, box.max.x - playerAABB.min.x);
    const overlapY = Math.min(playerAABB.max.y - box.min.y, box.max.y - playerAABB.min.y);
    const overlapZ = Math.min(playerAABB.max.z - box.min.z, box.max.z - playerAABB.min.z);
    if (state.isSwimming && (overlapX < overlapY || overlapZ < overlapY)) {
      const playerFeet = player.pos.y - player.eyeHeight;
      const boxTop = box.max.y;
      if (boxTop >= playerFeet - 0.15 && boxTop < playerFeet + 2.0) {
        const testY = boxTop + player.eyeHeight + 0.03;
        const oldY = player.pos.y;
        player.pos.y = testY;
        updatePlayerAABB();
        if (isAABBNowFree()) { player.vel.y = 0; continue; }
        player.pos.y = oldY;
        updatePlayerAABB();
      }
    }
    if (overlapX < overlapY && overlapX < overlapZ) {
      const pc = (playerAABB.min.x + playerAABB.max.x) / 2, bc = (box.min.x + box.max.x) / 2;
      const dir = pc < bc ? -1 : 1;
      player.pos.x += dir * overlapX;
      if (dir * player.vel.x < 0) player.vel.x = 0;
    } else if (overlapY < overlapZ) {
      const pc = (playerAABB.min.y + playerAABB.max.y) / 2, bc = (box.min.y + box.max.y) / 2;
      const dir = pc < bc ? -1 : 1;
      player.pos.y += dir * overlapY;
      if (dir * player.vel.y < 0) player.vel.y = 0;
    } else {
      const pc = (playerAABB.min.z + playerAABB.max.z) / 2, bc = (box.min.z + box.max.z) / 2;
      const dir = pc < bc ? -1 : 1;
      player.pos.z += dir * overlapZ;
      if (dir * player.vel.z < 0) player.vel.z = 0;
    }
    updatePlayerAABB();
  }
}

// ════════════════════════════════════════════════════════════
//   INPUT
// ════════════════════════════════════════════════════════════
document.addEventListener('keydown', (e) => {
  if (e.repeat) return;
  const k = e.key.toLowerCase();
  if (state.terminalOpen) {
    if (k === 'y' && !dom.sluicePrompt.classList.contains('hidden')) confirmSluice();
    else if (k === 'n' && !dom.sluicePrompt.classList.contains('hidden')) closeTerminal();
    return;
  }
  if (k === 'w') keys.w = true;
  else if (k === 'a') keys.a = true;
  else if (k === 's') keys.s = true;
  else if (k === 'd') keys.d = true;
  else if (k === 'shift') keys.shift = true;
  else if (k === 'f') toggleFlashlight();
  else if (k === 'r') startCharging();
  else if (k === 'e') tryInteract();
});
document.addEventListener('keyup', (e) => {
  const k = e.key.toLowerCase();
  if (k === 'w') keys.w = false;
  else if (k === 'a') keys.a = false;
  else if (k === 's') keys.s = false;
  else if (k === 'd') keys.d = false;
  else if (k === 'shift') keys.shift = false;
  else if (k === 'r') stopCharging();
});
function tryInteract() {
  if (!state.playing || state.dead || state.finished || state.finalSequence) return;
  if (currentInteractable) currentInteractable.onInteract();
}

// ─── Flashlight ───
let flashlightBeforeCharging = false;
function toggleFlashlight() {
  if (!state.playing || state.dead || state.finished || state.charging || state.finalSequence) return;
  if (state.battery <= 0 && !state.flashlightOn) return;
  state.flashlightOn = !state.flashlightOn;
  flashlight.visible = state.flashlightOn;
  playClick();
}
function startCharging() {
  if (!state.playing || state.dead || state.finished || state.charging || state.finalSequence) return;
  if (state.battery >= 100) return;
  state.charging = true;
  flashlightBeforeCharging = state.flashlightOn;
  state.flashlightOn = false;
  flashlight.visible = false;
  dom.chargingOverlay.classList.add('visible', 'spinning');
  playCrank();
}
function stopCharging() {
  if (!state.charging) return;
  state.charging = false;
  dom.chargingOverlay.classList.remove('visible', 'spinning');
  stopCrank();
  state.flashlightOn = flashlightBeforeCharging && state.battery > 0;
  flashlight.visible = state.flashlightOn;
}

// ════════════════════════════════════════════════════════════
//   AUDIO
// ════════════════════════════════════════════════════════════
let audioCtx = null, ambientGain = null, masterFilter = null;
let crankOsc = null, crankLfo = null;
let alarmOsc = null, alarmLfo = null, alarmGain = null;
let voidHumOsc = null, voidHumGain = null;
let lastHeartbeat = 0;

function initAudio() {
  if (audioCtx) return;
  audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  startAmbient();
  scheduleAmbientRandom();
}
function startAmbient() {
  const master = audioCtx.createGain();
  master.gain.value = 0.14;
  ambientGain = master;
  masterFilter = audioCtx.createBiquadFilter();
  masterFilter.type = 'lowpass';
  masterFilter.frequency.value = 20000;
  masterFilter.Q.value = 0.7;
  master.connect(masterFilter);
  masterFilter.connect(audioCtx.destination);
  [38, 41.5].forEach((f) => {
    const osc = audioCtx.createOscillator();
    osc.type = 'sine'; osc.frequency.value = f;
    const g = audioCtx.createGain(); g.gain.value = 0.35;
    osc.connect(g); g.connect(master); osc.start();
  });
  const buf = audioCtx.createBuffer(1, audioCtx.sampleRate * 4, audioCtx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * 0.3;
  const noise = audioCtx.createBufferSource();
  noise.buffer = buf; noise.loop = true;
  const lp = audioCtx.createBiquadFilter();
  lp.type = 'lowpass'; lp.frequency.value = 180;
  noise.connect(lp); lp.connect(master); noise.start();
}
function playClick() {
  if (!audioCtx) return;
  const t = audioCtx.currentTime;
  const osc = audioCtx.createOscillator();
  osc.type = 'square';
  osc.frequency.setValueAtTime(1400, t);
  osc.frequency.exponentialRampToValueAtTime(350, t + 0.04);
  const g = audioCtx.createGain();
  g.gain.setValueAtTime(0.18, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + 0.08);
  osc.connect(g); g.connect(audioCtx.destination);
  osc.start(t); osc.stop(t + 0.09);
}
function playCrank() {
  if (!audioCtx || crankOsc) return;
  crankOsc = audioCtx.createOscillator();
  crankOsc.type = 'sawtooth'; crankOsc.frequency.value = 70;
  crankLfo = audioCtx.createOscillator();
  crankLfo.type = 'sawtooth'; crankLfo.frequency.value = 9;
  const lfoGain = audioCtx.createGain(); lfoGain.gain.value = 25;
  crankLfo.connect(lfoGain); lfoGain.connect(crankOsc.frequency);
  const g = audioCtx.createGain(); g.gain.value = 0.07;
  crankOsc.connect(g); g.connect(audioCtx.destination);
  crankOsc.start(); crankLfo.start();
}
function stopCrank() {
  if (!crankOsc) return;
  try { crankOsc.stop(); crankLfo.stop(); } catch (e) {}
  crankOsc = null; crankLfo = null;
}
function playSplash() {
  if (!audioCtx) return;
  const t = audioCtx.currentTime;
  const buf = audioCtx.createBuffer(1, audioCtx.sampleRate * 0.5, audioCtx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * Math.exp(-i / 8000);
  const noise = audioCtx.createBufferSource();
  noise.buffer = buf;
  const f = audioCtx.createBiquadFilter();
  f.type = 'bandpass'; f.frequency.value = 700; f.Q.value = 1.2;
  const g = audioCtx.createGain(); g.gain.value = 0.45;
  noise.connect(f); f.connect(g); g.connect(audioCtx.destination);
  noise.start(t);
}
function playTankPickup() {
  if (!audioCtx) return;
  const t = audioCtx.currentTime;
  const osc = audioCtx.createOscillator();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(880, t);
  osc.frequency.exponentialRampToValueAtTime(440, t + 0.15);
  const g = audioCtx.createGain();
  g.gain.setValueAtTime(0.15, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + 0.3);
  osc.connect(g); g.connect(audioCtx.destination);
  osc.start(t); osc.stop(t + 0.32);
}
function playScareSound() {
  if (!audioCtx) return;
  const t = audioCtx.currentTime;
  [180, 227, 305, 412, 88].forEach((freq) => {
    const osc = audioCtx.createOscillator();
    osc.type = 'sawtooth'; osc.frequency.value = freq;
    const g = audioCtx.createGain();
    g.gain.setValueAtTime(0.14, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.9);
    osc.connect(g); g.connect(audioCtx.destination);
    osc.start(t); osc.stop(t + 1.0);
  });
  const buf = audioCtx.createBuffer(1, audioCtx.sampleRate * 0.5, audioCtx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * Math.exp(-i / 6000);
  const noise = audioCtx.createBufferSource();
  noise.buffer = buf;
  const ng = audioCtx.createGain(); ng.gain.value = 0.35;
  noise.connect(ng); ng.connect(audioCtx.destination);
  noise.start(t);
}
function playTypeSound() {
  if (!audioCtx) return;
  const t = audioCtx.currentTime;
  const osc = audioCtx.createOscillator();
  osc.type = 'square'; osc.frequency.value = 1400 + Math.random() * 200;
  const g = audioCtx.createGain();
  g.gain.setValueAtTime(0.025, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + 0.02);
  osc.connect(g); g.connect(audioCtx.destination);
  osc.start(t); osc.stop(t + 0.025);
}
function startAlarm() {
  if (!audioCtx || alarmOsc) return;
  alarmOsc = audioCtx.createOscillator();
  alarmOsc.type = 'sawtooth'; alarmOsc.frequency.value = 440;
  alarmLfo = audioCtx.createOscillator();
  alarmLfo.type = 'sine'; alarmLfo.frequency.value = 4;
  const lfoGain = audioCtx.createGain(); lfoGain.gain.value = 200;
  alarmLfo.connect(lfoGain); lfoGain.connect(alarmOsc.frequency);
  alarmGain = audioCtx.createGain(); alarmGain.gain.value = 0.08;
  alarmOsc.connect(alarmGain); alarmGain.connect(audioCtx.destination);
  alarmOsc.start(); alarmLfo.start();
}
function stopAlarm() {
  if (!alarmOsc) return;
  try { alarmOsc.stop(); alarmLfo.stop(); } catch (e) {}
  alarmOsc = null; alarmLfo = null; alarmGain = null;
}
function playRoar() {
  if (!audioCtx) return;
  const t = audioCtx.currentTime;
  [30, 42, 55, 78, 120, 180, 900, 1800].forEach((freq) => {
    const osc = audioCtx.createOscillator();
    osc.type = freq < 200 ? 'sawtooth' : 'square';
    osc.frequency.setValueAtTime(freq, t);
    osc.frequency.exponentialRampToValueAtTime(Math.max(20, freq * 0.35), t + 1.2);
    const g = audioCtx.createGain();
    g.gain.setValueAtTime(0.2, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 1.3);
    const dist = audioCtx.createWaveShaper();
    const curve = new Float32Array(256);
    for (let i = 0; i < 256; i++) {
      const x = i / 128 - 1;
      curve[i] = (Math.PI + 6) * x / (Math.PI + 6 * Math.abs(x));
    }
    dist.curve = curve;
    osc.connect(dist); dist.connect(g); g.connect(audioCtx.destination);
    osc.start(t); osc.stop(t + 1.35);
  });
  const buf = audioCtx.createBuffer(1, audioCtx.sampleRate * 1.5, audioCtx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) {
    const env = Math.pow(1 - i / d.length, 0.7);
    d[i] = (Math.random() * 2 - 1) * env;
  }
  const noise = audioCtx.createBufferSource();
  noise.buffer = buf;
  const ng = audioCtx.createGain(); ng.gain.value = 0.4;
  noise.connect(ng); ng.connect(audioCtx.destination);
  noise.start(t);
}
function playHeartbeat() {
  if (!audioCtx) return;
  const t = audioCtx.currentTime;
  [0, 0.32].forEach((offset) => {
    const osc = audioCtx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(65, t + offset);
    osc.frequency.exponentialRampToValueAtTime(38, t + offset + 0.16);
    const g = audioCtx.createGain();
    g.gain.setValueAtTime(0, t + offset);
    g.gain.linearRampToValueAtTime(0.28, t + offset + 0.02);
    g.gain.exponentialRampToValueAtTime(0.001, t + offset + 0.25);
    osc.connect(g); g.connect(audioCtx.destination);
    osc.start(t + offset); osc.stop(t + offset + 0.3);
  });
}
function playDistantCreak() {
  if (!audioCtx) return;
  const t = audioCtx.currentTime;
  const buf = audioCtx.createBuffer(1, audioCtx.sampleRate * 1.5, audioCtx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) {
    const env = Math.sin((i / d.length) * Math.PI);
    d[i] = (Math.random() * 2 - 1) * env * 0.4;
  }
  const noise = audioCtx.createBufferSource();
  noise.buffer = buf;
  const f = audioCtx.createBiquadFilter();
  f.type = 'bandpass';
  f.frequency.setValueAtTime(180, t);
  f.frequency.linearRampToValueAtTime(90, t + 1.4);
  f.Q.value = 8;
  const g = audioCtx.createGain(); g.gain.value = 0.12;
  noise.connect(f); f.connect(g); g.connect(audioCtx.destination);
  noise.start(t);
}
function playDrip() {
  if (!audioCtx) return;
  const t = audioCtx.currentTime;
  const osc = audioCtx.createOscillator();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(1800 + Math.random() * 800, t);
  osc.frequency.exponentialRampToValueAtTime(600, t + 0.08);
  const g = audioCtx.createGain();
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(0.1, t + 0.005);
  g.gain.exponentialRampToValueAtTime(0.001, t + 0.15);
  osc.connect(g); g.connect(audioCtx.destination);
  osc.start(t); osc.stop(t + 0.16);
}
function playMetalGroan() {
  if (!audioCtx) return;
  const t = audioCtx.currentTime;
  [42, 58].forEach((f) => {
    const osc = audioCtx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(f, t);
    osc.frequency.linearRampToValueAtTime(f * 0.7, t + 1.2);
    const lp = audioCtx.createBiquadFilter();
    lp.type = 'lowpass'; lp.frequency.value = 300;
    const g = audioCtx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.08, t + 0.3);
    g.gain.exponentialRampToValueAtTime(0.001, t + 1.3);
    osc.connect(lp); lp.connect(g); g.connect(audioCtx.destination);
    osc.start(t); osc.stop(t + 1.4);
  });
}
function scheduleAmbientRandom() {
  const delay = 4000 + Math.random() * 14000;
  setTimeout(() => {
    if (state.playing && !state.dead && !state.finished && !state.finalSequence && audioCtx) {
      const pick = Math.random();
      if (pick < 0.3) playDistantCreak();
      else if (pick < 0.6) playDrip();
      else if (pick < 0.8) playMetalGroan();
    }
    scheduleAmbientRandom();
  }, delay);
}

// ════════════════════════════════════════════════════════════
//   PLAYER UPDATE
// ════════════════════════════════════════════════════════════
const WORLD_UP = new THREE.Vector3(0, 1, 0);
const vForward = new THREE.Vector3();
const vRight = new THREE.Vector3();
const vMove = new THREE.Vector3();

function updatePlayer(dt) {
  if (!state.playing || state.dead || state.finished || state.finalSequence || state.terminalOpen) return;

  camera.getWorldDirection(vForward);
  const ix = (keys.d ? 1 : 0) - (keys.a ? 1 : 0);
  const iz = (keys.w ? 1 : 0) - (keys.s ? 1 : 0);
  const moving = ix !== 0 || iz !== 0;

  if (state.isSwimming) {
    vRight.crossVectors(vForward, WORLD_UP).normalize();
    vMove.set(0, 0, 0);
    vMove.addScaledVector(vForward, iz);
    vMove.addScaledVector(vRight, ix);
    if (moving) vMove.normalize().multiplyScalar(player.swimSpeed);
    player.vel.x += (vMove.x - player.vel.x) * 3.0 * dt;
    player.vel.z += (vMove.z - player.vel.z) * 3.0 * dt;
    player.vel.y += (vMove.y - player.vel.y) * 3.0 * dt;
    player.vel.y -= 0.25 * dt;
    player.vel.multiplyScalar(1 - 1.6 * dt);
  } else {
    vForward.y = 0;
    if (vForward.lengthSq() < 1e-4) vForward.set(0, 0, -1);
    vForward.normalize();
    vRight.crossVectors(vForward, WORLD_UP).normalize();
    vMove.set(0, 0, 0);
    vMove.addScaledVector(vForward, iz);
    vMove.addScaledVector(vRight, ix);
    if (moving) vMove.normalize();
    const sp = keys.shift ? player.runSpeed : player.walkSpeed;
    player.vel.x = vMove.x * sp;
    player.vel.z = vMove.z * sp;
    player.vel.y -= 20 * dt;
  }

  player.pos.addScaledVector(player.vel, dt);
  resolveCollisions();

  const wasSwimming = state.isSwimming;
  state.isSwimming = false;
  for (const z of waterZones) {
    if (z.active === false) continue;
    if (player.pos.x >= z.minX && player.pos.x <= z.maxX &&
        player.pos.z >= z.minZ && player.pos.z <= z.maxZ &&
        player.pos.y < z.level + SWIM_TOLERANCE) {
      state.isSwimming = true;
      currentWaterLevel = z.level;
      break;
    }
  }
  if (wasSwimming !== state.isSwimming) onWaterStateChange(wasSwimming);

  if (!state.inVoid && player.pos.z > 32.5) {
    state.inVoid = true;
    onEnterVoid();
  }

  if (!state.isSwimming && moving) {
    const rate = keys.shift ? 11 : 8;
    player.bobTime += dt * rate;
    player.bobAmount += (0.028 - player.bobAmount) * 6 * dt;
  } else {
    player.bobAmount += (0 - player.bobAmount) * 6 * dt;
  }
  const bob = Math.sin(player.bobTime) * player.bobAmount;

  camera.position.set(player.pos.x, player.pos.y + bob, player.pos.z);
  if (state.isSwimming) camera.position.y += Math.sin(performance.now() * 0.001) * 0.015;
}

function onWaterStateChange(wasSwimming) {
  if (state.isSwimming) {
    scene.fog.color.setHex(0x031a20);
    scene.fog.density = state.inVoid ? 0.016 : 0.16;
    document.body.classList.add('underwater');
    if (audioCtx) {
      ambientGain.gain.setTargetAtTime(0.08, audioCtx.currentTime, 0.3);
      masterFilter.frequency.setTargetAtTime(500, audioCtx.currentTime, 0.2);
    }
    playSplash();
  } else if (wasSwimming) {
    scene.fog.color.setHex(0x02080a);
    scene.fog.density = 0.07;
    document.body.classList.remove('underwater');
    if (audioCtx) {
      ambientGain.gain.setTargetAtTime(0.14, audioCtx.currentTime, 0.3);
      masterFilter.frequency.setTargetAtTime(20000, audioCtx.currentTime, 0.3);
    }
    playSplash();
  }
}

function onEnterVoid() {
  scene.fog.color.setHex(0x00121a);
  scene.fog.density = 0.016;
  if (audioCtx) {
    voidHumOsc = audioCtx.createOscillator();
    voidHumOsc.type = 'sine';
    voidHumOsc.frequency.value = 22;
    voidHumGain = audioCtx.createGain();
    voidHumGain.gain.value = 0.35;
    voidHumOsc.connect(voidHumGain); voidHumGain.connect(audioCtx.destination);
    voidHumOsc.start();
    ambientGain.gain.setTargetAtTime(0.04, audioCtx.currentTime, 1.0);
  }
}

// ════════════════════════════════════════════════════════════
//   RESOURCES UPDATE
// ════════════════════════════════════════════════════════════
function updateResources(dt) {
  if (!state.playing || state.dead || state.finished || state.finalSequence) return;
  if (!state.terminalOpen) state.oxygen = Math.max(0, state.oxygen - 1.0 * dt);

  if (state.flashlightOn) {
    state.battery = Math.max(0, state.battery - (100 / 60) * dt);
    if (state.battery <= 0) { state.flashlightOn = false; flashlight.visible = false; }
  }
  if (state.charging) {
    state.battery = Math.min(100, state.battery + (100 / 6) * dt);
    if (state.battery >= 100) stopCharging();
  }
  if (state.oxygen <= 0) die();

  dom.o2Fill.style.width = state.oxygen + '%';
  dom.o2Fill.classList.toggle('low', state.oxygen < 50 && state.oxygen >= 25);
  dom.o2Fill.classList.toggle('critical', state.oxygen < 25);
  dom.vignette.classList.toggle('critical', state.oxygen < 25);

  const filled = Math.ceil(state.battery / 25);
  for (let i = 0; i < dom.segs.length; i++) dom.segs[i].classList.toggle('on', i < filled);

  if (state.oxygen < 25 && !state.finalSequence) {
    const now = performance.now() * 0.001;
    const interval = state.oxygen < 10 ? 0.55 : 0.85;
    if (now - lastHeartbeat > interval) { lastHeartbeat = now; playHeartbeat(); }
  }
}

// ════════════════════════════════════════════════════════════
//   INTERACTION
// ════════════════════════════════════════════════════════════
function checkInteraction() {
  if (!state.playing || state.dead || state.finished || state.finalSequence || state.terminalOpen) {
    if (!state.terminalOpen) dom.interactPrompt.classList.remove('visible');
    return;
  }
  raycaster.setFromCamera(new THREE.Vector2(0, 0), camera);
  const meshes = interactables.filter(i => i.mesh.visible && !i.mesh.userData.collected).map(i => i.mesh);
  const hits = raycaster.intersectObjects(meshes);
  if (hits.length > 0) {
    const obj = interactables.find(i => i.mesh === hits[0].object);
    if (obj) {
      dom.interactPrompt.textContent = obj.prompt;
      dom.interactPrompt.classList.add('visible');
      currentInteractable = obj;
      return;
    }
  }
  dom.interactPrompt.classList.remove('visible');
  currentInteractable = null;
}

// ════════════════════════════════════════════════════════════
//   TERMINAL
// ════════════════════════════════════════════════════════════
const TERMINAL_TEXT =
`> ЗАПИСЬ ЭКИПАЖА // 11.03 // 04:47

> КАПИТАН ПРИКАЗАЛ ЗАКРЫТЬ НИЖНИЙ ШЛЮЗ.

> ПОСЛЕ ТРЕТЬЕГО ПОГРУЖЕНИЯ ПОКАЗАНИЯ
  СОНАРА ПЕРЕСТАЛИ СХОДИТЬСЯ.
  ОНО НЕ НА ДНЕ. ОНО ВИСИТ.
  МЕЖДУ НАМИ И ПОВЕРХНОСТЬЮ.

> МЫ СЛЫШИМ, КАК ОНО ТРЁТСЯ О БОРТ
  УЖЕ 11 ЧАСОВ. ОНО ДЫШИТ.
  У НЕГО НЕТ ЖАБР. ГОСПОДИ,
  У НЕГО НЕТ ЖАБР, НО ОНО ДЫШИТ.

> ЕСЛИ ТЫ ЭТО ЧИТАЕШЬ — НЕ ОТКРЫВАЙ
  ШЛЮЗ. ОНО ЖДЁТ, ЧТОБЫ МЫ ОТКРЫЛИ.

> [КОНЕЦ ЗАПИСИ]`;

let typewriterTimer = null;
function openTerminal() {
  if (state.terminalOpen) return;
  state.terminalOpen = true;
  if (controls.isLocked) controls.unlock();
  dom.terminalOverlay.classList.remove('hidden');
  dom.sluicePrompt.classList.add('hidden');
  dom.terminalText.textContent = '';
  dom.terminalBody.scrollTop = 0;
  let i = 0;
  typewriterTimer = setInterval(() => {
    if (i >= TERMINAL_TEXT.length) {
      clearInterval(typewriterTimer);
      typewriterTimer = null;
      setTimeout(() => {
        if (state.terminalOpen) {
          dom.sluicePrompt.classList.remove('hidden');
          dom.terminalBody.scrollTop = dom.terminalBody.scrollHeight;
        }
      }, 1200);
      return;
    }
    dom.terminalText.textContent += TERMINAL_TEXT[i++];
    if (i % 3 === 0) playTypeSound();
    dom.terminalBody.scrollTop = dom.terminalBody.scrollHeight;
  }, 35);
}
function closeTerminal() {
  state.terminalOpen = false;
  dom.terminalOverlay.classList.add('hidden');
  if (typewriterTimer) { clearInterval(typewriterTimer); typewriterTimer = null; }
  if (state.playing && !state.dead && !state.finished) controls.lock();
}
function confirmSluice() {
  closeTerminal();
  activateSluice();
}

// ════════════════════════════════════════════════════════════
//   SLUICE
// ════════════════════════════════════════════════════════════
let outerDoorRemoved = false;
function activateSluice() {
  if (state.sluiceState !== 'idle') return;
  state.sluiceState = 'filling';
  state.sluiceTimer = 0;
  state.oxygen = 100;

  sluiceBackDoor.visible = true;
  backDoorCollider = new THREE.Box3(
    new THREE.Vector3(-1.5, 0, 19.9),
    new THREE.Vector3(1.5, 2.5, 20.1),
  );
  colliders.push(backDoorCollider);

  waterZones[1].active = true;
  waterZones[2].active = true;
  for (const s of waterSurfaces) {
    if (s.zone === waterZones[1] || s.zone === waterZones[2]) s.mesh.visible = true;
  }
  startAlarm();
  dom.messageFlash.textContent = 'ВОДА ПОСТУПАЕТ В ОТСЕК';
  dom.messageFlash.classList.add('visible');
  setTimeout(() => {
    dom.messageFlash.textContent = 'ДВИГАЙСЯ К ШЛЮЗУ';
    setTimeout(() => dom.messageFlash.classList.remove('visible'), 2500);
  }, 2000);
}
function updateSluice(dt) {
  if (state.sluiceState === 'filling') {
    state.sluiceTimer += dt;
    const t = Math.min(state.sluiceTimer / 3.5, 1);
    const newLevel = -2 + 5.0 * t;
    waterZones[1].level = newLevel;
    waterZones[2].level = newLevel;
    for (const s of waterSurfaces) {
      if (s.zone === waterZones[1] || s.zone === waterZones[2]) s.mesh.position.y = newLevel;
    }
    if (t >= 1) { state.sluiceState = 'opening'; state.sluiceTimer = 0; }
  } else if (state.sluiceState === 'opening') {
    state.sluiceTimer += dt;
    const t = Math.min(state.sluiceTimer / 2.0, 1);
    outerDoorMesh.position.y = 1.25 + t * 3.5;
    if (!outerDoorRemoved) {
      const idx = colliders.indexOf(outerDoorCollider);
      if (idx >= 0) colliders.splice(idx, 1);
      outerDoorRemoved = true;
    }
    if (t >= 1) { state.sluiceState = 'open'; stopAlarm(); }
  }
}
function resetSluice() {
  state.sluiceState = 'idle';
  state.sluiceTimer = 0;
  sluiceBackDoor.visible = false;
  if (backDoorCollider) {
    const idx = colliders.indexOf(backDoorCollider);
    if (idx >= 0) colliders.splice(idx, 1);
    backDoorCollider = null;
  }
  outerDoorMesh.position.y = 1.25;
  if (outerDoorRemoved) {
    colliders.push(outerDoorCollider);
    outerDoorRemoved = false;
  }
  waterZones[1].active = false;
  waterZones[2].active = false;
  waterZones[1].level = -2;
  waterZones[2].level = -2;
  for (const s of waterSurfaces) {
    if (s.zone === waterZones[1] || s.zone === waterZones[2]) {
      s.mesh.visible = false;
      s.mesh.position.y = -2;
    }
  }
  stopAlarm();
}

// ════════════════════════════════════════════════════════════
//   FINALE — redesigned
// ════════════════════════════════════════════════════════════
const faceLookAt = new THREE.Vector3();
const finaleTargetPos = new THREE.Vector3();
const finaleDummy = new THREE.Object3D();

function checkFinaleTrigger() {
  if (state.finalSequence || state.finaleTriggered) return;
  if (!state.inVoid) return;
  const dist = player.pos.distanceTo(new THREE.Vector3(0, FACE_Y, faceGroup.position.z));
  if (dist < 22) {
    state.finaleTriggered = true;
    triggerFinale();
  }
}

function triggerFinale() {
  state.finalSequence = true;
  state.finaleTime = 0;
  state.oxygen = 100;
  if (controls.isLocked) controls.unlock();
  stopAlarm();
  if (audioCtx) ambientGain.gain.setTargetAtTime(0.02, audioCtx.currentTime, 0.3);
}

function updateFinale(dt) {
  if (!state.finalSequence || state.finished) return;
  state.finaleTime += dt;
  const t = state.finaleTime;

  // Camera smooth look-at (0 → 0.35s), then hard-lock to face
  finaleTargetPos.copy(faceGroup.position);
  finaleTargetPos.y += 2;
  if (t < 0.35) {
    const k = Math.min(t / 0.35, 1) * 0.6;
    finaleDummy.position.copy(camera.position);
    finaleDummy.lookAt(finaleTargetPos);
    camera.quaternion.slerp(finaleDummy.quaternion, k);
  } else {
    finaleDummy.position.copy(camera.position);
    finaleDummy.lookAt(finaleTargetPos);
    camera.quaternion.slerp(finaleDummy.quaternion, 0.5);
  }

  // Face "wakes up" — 0.1 → 0.55s: emissive/lights ramp up
  if (t > 0.1 && t < 0.55) {
    const k = Math.min((t - 0.1) / 0.45, 1);
    headMat.uniforms.uGlowIntensity.value = 0.55 + k * 2.5;
    headMat.uniforms.uRimPower.value = 2.5 - k * 1.2;
    headMat.uniforms.uRimColor.value.setRGB(
      0.27 + k * 0.4, 0.53 - k * 0.2, 0.8 + k * 0.2
    );
    eye1.scale.setScalar(3.2 + k * 2.8);
    eye2.scale.setScalar(3.2 + k * 2.8);
    eye1.material.opacity = 0.85 + k * 0.15;
    eye2.material.opacity = 0.85 + k * 0.15;
    mouthMat.emissiveIntensity = 0.8 + k * 2.2;
    mouthLight.intensity = 0.9 + k * 3.5;
    faceKeyLight.intensity = 1.8 + k * 2.5;
    faceRimLight.intensity = 2.5 + k * 2.0;
    bioMat.uniforms.uOpacity.value = 0.35 + k * 0.5;
  }

  // Flashlight dies when face wakes
  if (t > 0.3) flashlight.visible = false;

  // Lunge — 0.55 → 1.05s
  if (t > 0.55 && t < 1.05) {
    const lt = (t - 0.55) / 0.5;
    const eased = lt * lt * lt; // ease-in: slow, then violent
    faceGroup.position.z = faceOriginalZ - eased * 45; // moves 45 units toward player
    faceGroup.position.y = FACE_Y - eased * 1.5;
    // FOV zoom-in for dramatic effect
    camera.fov = 72 - eased * 22;
    camera.updateProjectionMatrix();
  }

  // Roar at 0.85 (just before impact)
  if (t > 0.85 && !state.roared) {
    state.roared = true;
    playRoar();
  }

  // Screen shake ramps up during approach
  if (t > 0.75 && t < 1.05) {
    fxPass.uniforms.uScreenShake.value = Math.min((t - 0.75) * 4, 1.2);
  }

  // Impact at 1.05
  if (t > 1.05 && !state.impacted) {
    state.impacted = true;
    fxPass.uniforms.uFlash.value = 1.0;
    fxPass.uniforms.uScreenShake.value = 1.0;
  }

  // Flash decay + fade to black
  if (t > 1.05) {
    fxPass.uniforms.uFlash.value = Math.max(0, 1.0 - (t - 1.05) * 4);
    fxPass.uniforms.uScreenShake.value = Math.max(0, 1.0 - (t - 1.05) * 3);
    if (t > 1.2) dom.fadeOverlay.style.opacity = 1;
  }

  // Final screen
  if (t > 2.0 && !state.finalTextShown) {
    state.finalTextShown = true;
    state.finished = true;
    showFinalScreen();
  }
}

function showFinalScreen() {
  dom.finalText.textContent =
    'Оно не было голодным.\nОно просто хотело, чтобы мы открыли.\n\n\n— КОНЕЦ —';
  dom.finalScreen.classList.remove('hidden');
  dom.fadeOverlay.style.opacity = 1;
  setTimeout(() => {
    dom.finalText.classList.add('visible');
    dom.restartBtn.classList.remove('hidden');
  }, 500);
}

// ════════════════════════════════════════════════════════════
//   DEATH / RESPAWN
// ════════════════════════════════════════════════════════════
function die() {
  if (state.dead || state.finalSequence) return;
  state.dead = true;
  controls.unlock();
  document.body.classList.remove('playing', 'underwater');
  dom.deathScreen.classList.remove('hidden');
}
function respawn() {
  state.dead = false;
  state.oxygen = 100;
  state.battery = 100;
  state.flashlightOn = true;
  flashlight.visible = true;
  state.isSwimming = false;
  player.vel.set(0, 0, 0);
  state.inVoid = false;
  state.finalSequence = false;
  state.finaleTriggered = false;
  state.finaleTime = 0;
  state.roared = false;
  state.impacted = false;
  state.finalTextShown = false;

  // Reset face
  faceGroup.position.set(0, FACE_Y, faceOriginalZ);
  faceGroup.scale.setScalar(1);
  headMat.uniforms.uGlowIntensity.value = 0.55;
  headMat.uniforms.uRimPower.value = 2.5;
  headMat.uniforms.uRimColor.value.setRGB(0.27, 0.53, 0.8);
  eye1.scale.setScalar(3.2);
  eye2.scale.setScalar(3.2);
  eye1.material.opacity = 0.85;
  eye2.material.opacity = 0.85;
  mouthMat.emissiveIntensity = 0.8;
  mouthLight.intensity = 0.9;
  faceKeyLight.intensity = 1.8;
  faceRimLight.intensity = 2.5;
  bioMat.uniforms.uOpacity.value = 0.35;
  camera.fov = 72;
  camera.updateProjectionMatrix();
  fxPass.uniforms.uFlash.value = 0;
  fxPass.uniforms.uScreenShake.value = 0;
  dom.fadeOverlay.style.opacity = 0;

  if (state.sluiceState === 'open') {
    player.pos.set(0, 3, 33);
  } else {
    player.pos.set(0, 1.6, 2);
    resetSluice();
    for (const tk of allTanks) {
      tk.visible = true;
      tk.userData.collected = false;
      tk.position.y = tk.userData.baseY;
    }
    scarePipeActive = false;
    scarePipe.visible = false;
  }

  dom.deathScreen.classList.add('hidden');
  document.body.classList.add('playing');
  controls.lock();
}

// ════════════════════════════════════════════════════════════
//   SCREEN TRANSITIONS
// ════════════════════════════════════════════════════════════
document.getElementById('start-btn').addEventListener('click', () => {
  initAudio();
  if (audioCtx.state === 'suspended') audioCtx.resume();
  dom.startScreen.classList.add('hidden');
  dom.fadeOverlay.style.opacity = '1';
  setTimeout(() => { dom.fadeOverlay.style.opacity = '0'; }, 200);
  document.body.classList.add('playing');
  state.playing = true;
  controls.lock();
});
document.getElementById('respawn-btn').addEventListener('click', respawn);
dom.restartBtn.addEventListener('click', () => location.reload());
document.addEventListener('click', () => {
  if (state.playing && !state.dead && !state.finished && !state.terminalOpen && !state.finalSequence && !controls.isLocked) controls.lock();
});
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  composer.setSize(window.innerWidth, window.innerHeight);
});

// ════════════════════════════════════════════════════════════
//   MAIN LOOP
// ════════════════════════════════════════════════════════════
let lastTime = performance.now();

function animate() {
  requestAnimationFrame(animate);
  const now = performance.now();
  let dt = (now - lastTime) / 1000;
  lastTime = now;
  dt = Math.min(dt, 0.05);

  updatePlayer(dt);
  updateResources(dt);
  checkInteraction();
  updateSluice(dt);
  checkFinaleTrigger();
  updateFinale(dt);

  waterMat.uniforms.uTime.value = now * 0.001;

  // Dust
  dustMat.uniforms.uTime.value = now * 0.001;
  const targetOpacity = (state.flashlightOn && state.playing && !state.dead) ? 0.55 : 0.04;
  dustMat.uniforms.uOpacity.value += (targetOpacity - dustMat.uniforms.uOpacity.value) * Math.min(1, 4 * dt);
  dustCloud.position.copy(camera.position);

  // Tank float
  for (const tk of allTanks) {
    if (tk.visible) {
      tk.rotation.y += 0.6 * dt;
      tk.position.y = tk.userData.baseY + Math.sin(now * 0.0015 + tk.userData.baseY * 3) * 0.03;
    }
  }

  // Lights flicker
  const flick = Math.sin(now * 0.005) * 0.15;
  const glitch = Math.random() < 0.02 ? 0.35 : 0;
  emergencyLight.intensity = 0.85 + flick + glitch;
  if (state.sluiceState !== 'idle') {
    emergencyLight2.intensity = 0.5 + Math.sin(now * 0.02) * 0.5;
  }
  underwaterLight.intensity = 0.5 + Math.sin(now * 0.002) * 0.2;
  terminalGlow.intensity = 0.5 + Math.sin(now * 0.004) * 0.15;

  // Flashlight flicker
  if (state.flashlightOn && state.battery < 20) {
    if (Math.random() < 0.06) {
      flashlight.visible = false;
      setTimeout(() => { flashlight.visible = state.flashlightOn; }, 40 + Math.random() * 120);
    }
  }

  // Scare pipe
  if (scarePipeActive) {
    scarePipeTime += dt;
    const t = Math.min(scarePipeTime, 0.7);
    scarePipe.position.y = 3.5 - t * 3.8;
    scarePipe.rotation.z = t * 2.5;
    scarePipe.rotation.x = t * 1.2;
    if (scarePipeTime > 0.7) { scarePipe.visible = false; scarePipeActive = false; }
  }

  // Face idle motion + proximity-based pre-finale awakening
  if (!state.finalSequence) {
    const ft = now * 0.001;
    faceGroup.rotation.y = Math.sin(ft * 0.2) * 0.04;
    if (!state.inVoid) {
      faceGroup.position.y = FACE_Y + Math.sin(ft * 0.3) * 0.3;
    }
    // Bio particles shimmer
    bioMat.uniforms.uTime.value = ft;
    // Eye pulse
    const pulse = 0.9 + Math.sin(ft * 1.2) * 0.1;
    eye1.material.opacity = pulse;
    eye2.material.opacity = pulse;

    // Proximity "noticing": as player approaches, wake up the face gradually
    if (state.inVoid) {
      const d = player.pos.distanceTo(new THREE.Vector3(0, FACE_Y, faceGroup.position.z));
      if (d < 40 && d > 22) {
        const k = (40 - d) / 18; // 0 at 40, 1 at 22
        headMat.uniforms.uGlowIntensity.value = 0.55 + k * 0.9;
        faceKeyLight.intensity = 1.8 + k * 0.8;
        bioMat.uniforms.uOpacity.value = 0.35 + k * 0.25;
        mouthMat.emissiveIntensity = 0.8 + k * 0.6;
      }
    }
  }

  // FX
  fxPass.uniforms.uTime.value = now * 0.001;
  fxPass.uniforms.uUnderwater.value = state.isSwimming ? 1 : 0;
  fxPass.uniforms.uDanger.value = (state.oxygen < 25 && !state.finalSequence) ? 1 : 0;

  composer.render();
}
animate();
