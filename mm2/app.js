// Version: 2.0.6
import * as THREE from "https://esm.sh/three@0.164.1";
import { OrbitControls } from "https://esm.sh/three@0.164.1/examples/jsm/controls/OrbitControls.js";
import { EffectComposer } from "https://esm.sh/three@0.164.1/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "https://esm.sh/three@0.164.1/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "https://esm.sh/three@0.164.1/examples/jsm/postprocessing/UnrealBloomPass.js";
import { FBXLoader } from "https://esm.sh/three@0.164.1/examples/jsm/loaders/FBXLoader.js";

const stage = document.getElementById("stage");
const phaseLabel = document.getElementById("phase-label");
const phaseCopy = document.getElementById("phase-copy");
const timerLabel = document.getElementById("timer-label");
const roundLabel = document.getElementById("round-label");
const destructionLabel = document.getElementById("destruction-label");
const remainingLabel = document.getElementById("remaining-label");
const leaderboardEl = document.getElementById("leaderboard");
const overlay = document.getElementById("overlay");
const overlayCopy = document.getElementById("overlay-copy");
const playerNameInput = document.getElementById("player-name");
const connectionLabel = document.getElementById("connection-label");
const appVersionEl = document.getElementById("app-version");
const APP_VERSION = "2.0.6";

if (appVersionEl) {
  appVersionEl.textContent = `Version ${APP_VERSION}`;
}

document.title = `Skyline MM2 v${APP_VERSION}`;

function createClientId() {
  if (window.crypto && typeof window.crypto.randomUUID === "function") {
    return `p-${window.crypto.randomUUID()}`;
  }
  return `p-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

const storedId = localStorage.getItem("mm2-player-id");
const playerId = storedId || createClientId();
if (!storedId) {
  localStorage.setItem("mm2-player-id", playerId);
}
playerNameInput.value = localStorage.getItem("mm2-player-name") || "";

const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2(0x071923, 0.01);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.25));
renderer.setSize(stage.clientWidth, stage.clientHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.26;
stage.prepend(renderer.domElement);

const camera = new THREE.PerspectiveCamera(42, stage.clientWidth / stage.clientHeight, 0.1, 500);
camera.position.set(-28, 22, 38);

const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(2, 3.5, 0);
controls.enableDamping = true;
controls.minDistance = 18;
controls.maxDistance = 120;
controls.maxPolarAngle = Math.PI * 0.48;
controls.minPolarAngle = Math.PI * 0.18;

const USE_BLOOM = false;
const composer = USE_BLOOM ? new EffectComposer(renderer) : null;
if (composer) {
  composer.addPass(new RenderPass(scene, camera));
  composer.addPass(new UnrealBloomPass(new THREE.Vector2(stage.clientWidth, stage.clientHeight), 0.55, 0.7, 0.24));
}

const root = new THREE.Group();
scene.add(root);

const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
const buildings = [];
const buildingMap = new Map();
const explosions = [];
const missiles = [];
const airplanes = [];
const trafficSystems = [];
const clock = new THREE.Clock();
let audioContext = null;
let airplaneTemplate = null;
const pendingAirplaneStrikes = [];

new FBXLoader().load(
  "./models/airplane.fbx",
  (asset) => {
    airplaneTemplate = normalizeAirplaneTemplate(asset);
    console.info("[Skyline MM2] Airplane FBX loaded.");
    while (pendingAirplaneStrikes.length) {
      const pending = pendingAirplaneStrikes.shift();
      if (pending.group && !pending.group.userData.exploded) {
        launchAirplane(pending.group, pending.seed, pending.outcome, pending.strikeMeta);
      }
    }
  },
  undefined,
  (error) => {
    airplaneTemplate = null;
    console.error("[Skyline MM2] Failed to load airplane FBX.", error);
  }
);

const cameraShake = {
  time: 0,
  duration: 0,
  strength: 0,
  offset: new THREE.Vector3()
};

function getAudioContext() {
  if (!audioContext) {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) {
      return null;
    }
    audioContext = new AudioContextClass();
  }
  if (audioContext.state === "suspended") {
    audioContext.resume().catch(() => {});
  }
  return audioContext;
}

function playBlastSound(intensity = 1) {
  const context = getAudioContext();
  if (!context) {
    return;
  }

  const now = context.currentTime;
  const pitchJitter = 0.9 + Math.random() * 0.25;
  const duration = 0.75 + Math.random() * 0.45;
  const noiseTone = 700 + Math.random() * 900;
  const tailTone = 120 + Math.random() * 120;
  const rumbleMix = 0.12 + Math.random() * 0.12;
  const gain = context.createGain();
  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.exponentialRampToValueAtTime((0.12 + Math.random() * 0.08) * intensity, now + 0.015 + Math.random() * 0.015);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
  gain.connect(context.destination);

  const lowOsc = context.createOscillator();
  lowOsc.type = Math.random() < 0.5 ? "triangle" : "sawtooth";
  lowOsc.frequency.setValueAtTime((62 + Math.random() * 42) * pitchJitter, now);
  lowOsc.frequency.exponentialRampToValueAtTime((26 + Math.random() * 18) * pitchJitter, now + duration);
  lowOsc.connect(gain);
  lowOsc.start(now);
  lowOsc.stop(now + duration);

  const rumble = context.createOscillator();
  rumble.type = "sine";
  rumble.frequency.setValueAtTime(34 + Math.random() * 18, now);
  rumble.frequency.exponentialRampToValueAtTime(18 + Math.random() * 10, now + duration);
  const rumbleGain = context.createGain();
  rumbleGain.gain.setValueAtTime(0.0001, now);
  rumbleGain.gain.exponentialRampToValueAtTime(rumbleMix * intensity, now + 0.03);
  rumbleGain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
  rumble.connect(rumbleGain);
  rumbleGain.connect(context.destination);
  rumble.start(now);
  rumble.stop(now + duration);

  const noiseBuffer = context.createBuffer(1, Math.floor(context.sampleRate * duration), context.sampleRate);
  const channel = noiseBuffer.getChannelData(0);
  for (let index = 0; index < channel.length; index += 1) {
    const falloff = 1 - index / channel.length;
    channel[index] = (Math.random() * 2 - 1) * falloff * (0.82 + Math.random() * 0.36);
  }

  const noiseSource = context.createBufferSource();
  noiseSource.buffer = noiseBuffer;
  const noiseFilter = context.createBiquadFilter();
  noiseFilter.type = "lowpass";
  noiseFilter.frequency.setValueAtTime(noiseTone, now);
  noiseFilter.frequency.exponentialRampToValueAtTime(tailTone, now + duration);
  const noiseGain = context.createGain();
  noiseGain.gain.setValueAtTime(0.0001, now);
  noiseGain.gain.exponentialRampToValueAtTime((0.18 + Math.random() * 0.16) * intensity, now + 0.008 + Math.random() * 0.02);
  noiseGain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
  noiseSource.connect(noiseFilter);
  noiseFilter.connect(noiseGain);
  noiseGain.connect(context.destination);
  noiseSource.start(now);
  noiseSource.stop(now + duration);
}

let appState = null;
let previousDestroyed = new Map();
const seenStrikeIds = new Set();
const activeStrikeBuildings = new Map();

const hemi = new THREE.HemisphereLight(0xc7f5ff, 0x071016, 1.28);
scene.add(hemi);

const keyLight = new THREE.DirectionalLight(0xfff1d2, 1.64);
keyLight.position.set(18, 28, 8);
scene.add(keyLight);

const fillLight = new THREE.PointLight(0x47d9ff, 54, 150, 2);
fillLight.position.set(8, 12, -12);
scene.add(fillLight);

const cyanAccent = new THREE.PointLight(0x45fff1, 62, 150, 2);
cyanAccent.position.set(-18, 10, 8);
scene.add(cyanAccent);

const magentaAccent = new THREE.PointLight(0xffb25c, 36, 110, 2);
magentaAccent.position.set(20, 8, 16);
scene.add(magentaAccent);

const sunsetGlow = new THREE.PointLight(0xffd08f, 76, 190, 2);
sunsetGlow.position.set(0, 26, -34);
scene.add(sunsetGlow);

function hashString(value) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function normalizeAirplaneTemplate(asset) {
  const wrapper = new THREE.Group();
  const plane = asset.clone(true);
  wrapper.add(plane);

  let bounds = new THREE.Box3().setFromObject(wrapper);
  const size = bounds.getSize(new THREE.Vector3());
  const longest = Math.max(size.x, size.y, size.z) || 1;
  wrapper.scale.setScalar(2.4 / longest);

  bounds = new THREE.Box3().setFromObject(wrapper);
  const center = bounds.getCenter(new THREE.Vector3());
  plane.position.sub(center);
  bounds = new THREE.Box3().setFromObject(wrapper);
  plane.position.y -= bounds.min.y;
  bounds = new THREE.Box3().setFromObject(wrapper);
  const normalizedSize = bounds.getSize(new THREE.Vector3());
  if (normalizedSize.z > normalizedSize.x) {
    plane.rotation.y = -Math.PI * 0.5;
  }
  plane.rotation.y -= Math.PI * 0.5;

  wrapper.traverse((child) => {
    if (child.isMesh) {
      const materials = Array.isArray(child.material) ? child.material : [child.material];
      const clonedMaterials = materials.map((material) => {
        if (!material || typeof material.clone !== "function") {
          return material;
        }
        const clone = material.clone();
        if ("emissive" in clone) {
          clone.emissive = new THREE.Color(0x201010);
          clone.emissiveIntensity = 0.08;
        }
        return clone;
      });
      child.material = Array.isArray(child.material) ? clonedMaterials : clonedMaterials[0];
    }
  });

  return wrapper;
}

function shortBuildingCode(value) {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ";
  let hash = hashString(value);
  let code = "";
  for (let index = 0; index < 3; index += 1) {
    code += alphabet[hash % alphabet.length];
    hash = Math.floor(hash / alphabet.length);
  }
  return code;
}

function mulberry32(seed) {
  let value = seed >>> 0;
  return function rand() {
    value += 0x6d2b79f5;
    let next = value;
    next = Math.imul(next ^ (next >>> 15), next | 1);
    next ^= next + Math.imul(next ^ (next >>> 7), next | 61);
    return ((next ^ (next >>> 14)) >>> 0) / 4294967296;
  };
}

function formatMs(ms) {
  const clamped = Math.max(0, ms);
  const minutes = Math.floor(clamped / 60000);
  const seconds = Math.floor((clamped % 60000) / 1000);
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function makeWindowTexture(seed = 1) {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 512;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#090d1c";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  let value = seed * 9973;
  const rand = () => {
    value = (value * 48271) % 0x7fffffff;
    return value / 0x7fffffff;
  };

  for (let y = 8; y < canvas.height; y += 12) {
    for (let x = 8; x < canvas.width; x += 10) {
      const lit = rand() > 0.34;
      if (lit) {
        const hue = rand() > 0.5 ? 188 + rand() * 22 : 305 + rand() * 28;
        const light = 64 + rand() * 24;
        ctx.fillStyle = `hsla(${hue}, 90%, ${light}%, ${0.6 + rand() * 0.35})`;
        ctx.fillRect(x, y, 5, 8);
      } else {
        ctx.fillStyle = "rgba(6, 12, 24, 0.85)";
        ctx.fillRect(x, y, 5, 8);
      }
    }
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  return texture;
}

function makeParticleTexture(stops) {
  const canvas = document.createElement("canvas");
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext("2d");
  const gradient = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  stops.forEach(([offset, color]) => gradient.addColorStop(offset, color));
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 128, 128);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function makeLabelSprite(text) {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 128;
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "rgba(7, 10, 20, 0.6)";
  ctx.strokeStyle = "rgba(110, 242, 255, 0.22)";
  ctx.lineWidth = 1.5;
  const radius = 20;
  ctx.beginPath();
  ctx.moveTo(radius, 16);
  ctx.lineTo(canvas.width - radius, 16);
  ctx.quadraticCurveTo(canvas.width - 16, 16, canvas.width - 16, radius);
  ctx.lineTo(canvas.width - 16, canvas.height - radius);
  ctx.quadraticCurveTo(canvas.width - 16, canvas.height - 16, canvas.width - radius, canvas.height - 16);
  ctx.lineTo(radius, canvas.height - 16);
  ctx.quadraticCurveTo(16, canvas.height - 16, 16, canvas.height - radius);
  ctx.lineTo(16, radius);
  ctx.quadraticCurveTo(16, 16, radius, 16);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.font = "700 44px Avenir Next, Arial, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = "#f4ecff";
  ctx.fillText(text, canvas.width / 2, canvas.height / 2 + 2);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const material = new THREE.SpriteMaterial({
    map: texture,
    transparent: true,
    depthWrite: false,
    depthTest: true
  });
  const sprite = new THREE.Sprite(material);
  sprite.scale.set(1.45, 0.58, 1);
  return sprite;
}

function resolveBuildingGroup(object) {
  let current = object;
  while (current) {
    if (current.userData?.isBuilding) {
      return current;
    }
    if (current.userData?.buildingGroup) {
      return current.userData.buildingGroup;
    }
    current = current.parent;
  }
  return null;
}

const windowTextures = [1, 2, 3, 4, 5].map(makeWindowTexture);
const fireParticleTexture = makeParticleTexture([
  [0.0, "rgba(255,255,255,1)"],
  [0.18, "rgba(255,248,210,1)"],
  [0.38, "rgba(255,170,40,0.95)"],
  [0.68, "rgba(255,70,10,0.45)"],
  [1.0, "rgba(0,0,0,0)"]
]);
const smokeParticleTexture = makeParticleTexture([
  [0.0, "rgba(255,255,255,0.75)"],
  [0.25, "rgba(160,160,160,0.45)"],
  [0.7, "rgba(45,45,45,0.22)"],
  [1.0, "rgba(0,0,0,0)"]
]);

function makeGroundTexture() {
  const canvas = document.createElement("canvas");
  canvas.width = 1024;
  canvas.height = 1024;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#073045";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  for (let y = 0; y < canvas.height; y += 18) {
    const alpha = 0.05 + ((y / 18) % 3) * 0.018;
    ctx.fillStyle = `rgba(126, 231, 255, ${alpha})`;
    ctx.fillRect(0, y + Math.sin(y * 0.03) * 8, canvas.width, 2);
  }
  for (let index = 0; index < 340; index += 1) {
    const x = Math.random() * canvas.width;
    const y = Math.random() * canvas.height;
    ctx.fillStyle = `rgba(210, 250, 255, ${0.04 + Math.random() * 0.08})`;
    ctx.fillRect(x, y, 1 + Math.random() * 4, 1);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(2, 2);
  return texture;
}

const groundTexture = makeGroundTexture();

function addFlatShape(points, material, y = 0.2) {
  const shape = new THREE.Shape();
  points.forEach(([x, z], index) => {
    if (index === 0) {
      shape.moveTo(x, z);
    } else {
      shape.lineTo(x, z);
    }
  });
  shape.closePath();
  const mesh = new THREE.Mesh(new THREE.ShapeGeometry(shape), material);
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.y = y;
  root.add(mesh);
  return mesh;
}

function addMapText(text, x, z, options = {}) {
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 128;
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.font = `${options.weight || 700} ${options.size || 42}px Avenir Next, Arial, sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = options.color || "rgba(32, 95, 145, 0.86)";
  ctx.fillText(text, canvas.width / 2, canvas.height / 2);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
    map: texture,
    transparent: true,
    depthWrite: false
  }));
  sprite.position.set(x, options.y || 0.36, z);
  sprite.scale.set(options.width || 8, options.height || 2, 1);
  root.add(sprite);
  return sprite;
}

function addSky() {
  const skyGeo = new THREE.SphereGeometry(220, 48, 32);
  const skyMat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    uniforms: {
      topColor: { value: new THREE.Color(0x262235) },
      bottomColor: { value: new THREE.Color(0x06131b) },
      horizonColor: { value: new THREE.Color(0x4d7c88) }
    },
    vertexShader: `
      varying vec3 vWorldPosition;
      void main() {
        vec4 worldPosition = modelMatrix * vec4(position, 1.0);
        vWorldPosition = worldPosition.xyz;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform vec3 topColor;
      uniform vec3 bottomColor;
      uniform vec3 horizonColor;
      varying vec3 vWorldPosition;
      void main() {
        float h = normalize(vWorldPosition + vec3(0.0, 50.0, 0.0)).y;
        vec3 sky = mix(bottomColor, horizonColor, smoothstep(-0.3, 0.15, h));
        sky = mix(sky, topColor, smoothstep(0.0, 0.9, h));
        gl_FragColor = vec4(sky, 1.0);
      }
    `
  });
  scene.add(new THREE.Mesh(skyGeo, skyMat));
}

function addBackdrop() {
  [
    [124, 54, 0x75dfff, 0.07, 4, 16, -44],
    [118, 46, 0xffd08b, 0.045, -2, 18, -42],
    [104, 30, 0x2bb6d1, 0.05, 2, 12, -36]
  ].forEach(([w, h, color, opacity, x, y, z]) => {
    const mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(w, h),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity })
    );
    mesh.position.set(x, y, z);
    root.add(mesh);
  });

  const glow = new THREE.Mesh(
    new THREE.CircleGeometry(20, 48),
    new THREE.MeshBasicMaterial({
      color: 0xffc06e,
      transparent: true,
      opacity: 0.09
    })
  );
  glow.position.set(0, 20, -46);
  root.add(glow);
}

function addBase() {
}

function addGroundGlow() {
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(62, 44),
    new THREE.MeshStandardMaterial({
      color: 0x8fcae6,
      map: groundTexture,
      emissive: 0x2e89bb,
      emissiveMap: groundTexture,
      emissiveIntensity: 0.18,
      metalness: 0.02,
      roughness: 0.7
    })
  );
  ground.rotation.x = -Math.PI / 2;
  root.add(ground);

  const landMaterial = new THREE.MeshStandardMaterial({
    color: 0xe5c34c,
    roughness: 0.86,
    metalness: 0.02,
    emissive: 0x4a3810,
    emissiveIntensity: 0.1
  });
  const coastMaterial = new THREE.MeshBasicMaterial({
    color: 0x5f5933,
    transparent: true,
    opacity: 0.52,
    side: THREE.DoubleSide
  });

  const northLand = [
    [-30, -30], [30, -30], [30, -5.4], [25, -5.1], [20, -4.6], [15.2, -4.8],
    [11.5, -3.4], [8.4, -1.4], [5.6, -2.2], [2.4, -4.2], [-2.7, -5.6],
    [-8.5, -6.2], [-14.2, -7.9], [-20.4, -10.6], [-25.7, -14.4], [-30, -15.8]
  ];
  const southLand = [
    [-30, 30], [30, 30], [30, 8.8], [25.8, 8.2], [22.8, 6.8], [19.4, 7.6],
    [15.2, 10.3], [11.3, 13.8], [6.4, 13.0], [2.2, 9.2], [-2.6, 9.8],
    [-8.7, 12.8], [-15.2, 12.1], [-21.4, 8.0], [-25.8, 4.0], [-30, 4.6]
  ];
  const omanLand = [
    [6.4, 2.8], [10.7, 5.0], [15.8, 6.6], [22.2, 8.4], [26.8, 12.8],
    [26.0, 21.7], [20.0, 26.5], [11.6, 25.4], [5.0, 20.4], [2.8, 13.8], [4.1, 8.4]
  ];
  const qatar = [
    [-14.2, 6.6], [-12.7, 4.2], [-11.0, 2.8], [-9.8, 4.5], [-10.2, 8.0], [-12.2, 10.0]
  ];
  const island = [
    [3.7, -1.8], [5.6, -2.8], [7.0, -2.1], [6.1, -0.9], [4.1, -0.6]
  ];
  const widenWater = (points) => points.map(([x, z]) => [x, z < 0 ? z * 1.8 - 1.8 : z * 1.8 + 1.8]);

  [northLand, southLand, omanLand, qatar, island].map(widenWater).forEach((points) => addFlatShape(points, landMaterial, 0.21));
  [northLand, southLand, omanLand, qatar, island].map(widenWater).forEach((points) => addFlatShape(points, coastMaterial, 0.225));

  addMapText("Persian Gulf", -15.5, -0.8, { width: 9.2, height: 2.3, size: 38 });
  addMapText("Strait of Hormuz", 8.8, 1.0, { width: 8.8, height: 1.55, size: 30 });
  addMapText("Gulf of Oman", 18.0, 14.5, { width: 9.6, height: 2.0, size: 36 });
  addMapText("Iran", 8.5, -18.6, { width: 5.2, height: 1.5, size: 38, color: "rgba(88, 70, 28, 0.82)" });
  addMapText("Kuwait", -24.0, -20.8, { width: 4.8, height: 1.2, size: 30, color: "rgba(88, 70, 28, 0.82)" });
  addMapText("Saudi Arabia", -21.0, 23.0, { width: 9.8, height: 1.6, size: 34, color: "rgba(88, 70, 28, 0.82)" });
  addMapText("Qatar", -11.8, 14.0, { width: 4.2, height: 1.1, size: 28, color: "rgba(88, 70, 28, 0.82)" });
  addMapText("United Arab Emirates", -2.4, 19.2, { width: 9.2, height: 1.35, size: 28, color: "rgba(88, 70, 28, 0.82)" });
  addMapText("Oman", 17.5, 23.0, { width: 5.6, height: 1.4, size: 36, color: "rgba(88, 70, 28, 0.82)" });
  addMapText("Pakistan", 25.2, -18.2, { width: 6.5, height: 1.25, size: 30, color: "rgba(88, 70, 28, 0.82)" });
}

function buildRoad(curve, color, elevation) {
  const points = curve.getPoints(200).map((point) => new THREE.Vector3(point.x, elevation, point.z));
  return new THREE.Line(
    new THREE.BufferGeometry().setFromPoints(points),
    new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.95 })
  );
}

function makeRibbon(curve, width, elevation, color, opacity) {
  const samples = 180;
  const positions = [];
  for (let index = 0; index < samples; index += 1) {
    const t = index / (samples - 1);
    const point = curve.getPoint(t);
    const tangent = curve.getTangent(t).clone().setY(0).normalize();
    const normal = new THREE.Vector3(-tangent.z, 0, tangent.x).normalize();
    const left = new THREE.Vector3(point.x, elevation, point.z).addScaledVector(normal, width * 0.5);
    const right = new THREE.Vector3(point.x, elevation, point.z).addScaledVector(normal, -width * 0.5);
    positions.push(left.x, left.y, left.z, right.x, right.y, right.z);
  }

  const indices = [];
  for (let index = 0; index < samples - 1; index += 1) {
    const a = index * 2;
    indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setIndex(indices);
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.computeVertexNormals();

  return new THREE.Mesh(
    geometry,
    new THREE.MeshStandardMaterial({
      color,
      transparent: true,
      opacity,
      metalness: 0.18,
      roughness: 0.42,
      emissive: 0xff7f7f,
      emissiveIntensity: 0.22
    })
  );
}

function addTraffic(curve, options) {
  const count = options.count;
  const positions = new Float32Array(count * 3);
  const offsets = new Float32Array(count);
  const speeds = new Float32Array(count);
  const colors = new Float32Array(count * 3);
  const color = new THREE.Color();
  for (let index = 0; index < count; index += 1) {
    offsets[index] = Math.random();
    speeds[index] = options.speedMin + Math.random() * (options.speedMax - options.speedMin);
    color.set(index % 4 === 0 ? 0xffdca8 : options.color);
    colors[index * 3] = color.r;
    colors[index * 3 + 1] = color.g;
    colors[index * 3 + 2] = color.b;
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));

  const points = new THREE.Points(
    geometry,
    new THREE.PointsMaterial({
      size: options.size,
      vertexColors: true,
      transparent: true,
      opacity: 1,
      sizeAttenuation: true,
      blending: THREE.AdditiveBlending
    })
  );
  root.add(points);
  trafficSystems.push({
    curve,
    points,
    positions,
    offsets,
    speeds,
    laneOffset: options.laneOffset,
    elevation: options.elevation
  });
}

function addRoads() {
  const half = 30;
  const laneZ = [-11, -6.2, -1.2, 3.8, 9.1];

  laneZ.forEach((z, index) => {
    const lane = new THREE.Mesh(
      new THREE.BoxGeometry(half * 1.75, 0.035, 0.12),
      new THREE.MeshBasicMaterial({
        color: index % 2 === 0 ? 0x93f1ff : 0xffca76,
        transparent: true,
        opacity: 0.26
      })
    );
    lane.position.set(0, 0.18, z);
    root.add(lane);

    const curve = new THREE.LineCurve3(new THREE.Vector3(-half * 0.82, 0, z), new THREE.Vector3(half * 0.82, 0, z));
    addTraffic(curve, { count: 16, color: index % 2 === 0 ? 0x9df6ff : 0xffbd6a, size: 0.12, speedMin: 0.012, speedMax: 0.032, laneOffset: 0.38, elevation: 0.32 });
    addTraffic(curve, { count: 12, color: 0xffffff, size: 0.08, speedMin: 0.01, speedMax: 0.026, laneOffset: -0.38, elevation: 0.32 });
  });

  const straitLine = new THREE.Mesh(
    new THREE.BoxGeometry(5.5, 0.035, 0.1),
    new THREE.MeshBasicMaterial({ color: 0x2b6f9d, transparent: true, opacity: 0.32 })
  );
  straitLine.position.set(8.2, 0.27, 0.2);
  straitLine.rotation.y = -0.18;
  root.add(straitLine);
}

function updateTraffic(time) {
  trafficSystems.forEach((system) => {
    for (let index = 0; index < system.offsets.length; index += 1) {
      const t = (system.offsets[index] + time * system.speeds[index]) % 1;
      const point = system.curve.getPoint(t);
      const tangent = system.curve.getTangent(t).clone().setY(0).normalize();
      const normal = new THREE.Vector3(-tangent.z, 0, tangent.x).normalize();
      const position = new THREE.Vector3(point.x, system.elevation, point.z).addScaledVector(normal, system.laneOffset);
      system.positions[index * 3] = position.x;
      system.positions[index * 3 + 1] = position.y;
      system.positions[index * 3 + 2] = position.z;
    }
    system.points.geometry.attributes.position.needsUpdate = true;
  });
}

function updateBoatDrift(delta, elapsed) {
  buildings.forEach((group) => {
    if (!group.visible || !group.userData || group.userData.exploded || !group.userData.basePosition) {
      return;
    }
    const limit = group.userData.mapLimitX || 29.5;
    group.userData.basePosition.addScaledVector(group.userData.driftDirection, group.userData.moveSpeed * delta);
    if (group.userData.basePosition.x > limit) {
      group.userData.basePosition.x = -limit;
    } else if (group.userData.basePosition.x < -limit) {
      group.userData.basePosition.x = limit;
    }
    const bob = Math.sin(elapsed * 0.7 + group.userData.driftPhase) * 0.035;
    group.position.copy(group.userData.basePosition);
    group.position.y = bob;
    group.rotation.z = Math.sin(elapsed * 0.55 + group.userData.driftPhase) * 0.012;
  });
}

function addForegroundGlow() {
  const group = new THREE.Group();
  for (let index = 0; index < 34; index += 1) {
    const glint = new THREE.Mesh(
      new THREE.PlaneGeometry(0.2 + Math.random() * 0.55, 0.018),
      new THREE.MeshBasicMaterial({
        color: index % 3 === 0 ? 0xffd28a : 0x83f4ff,
        transparent: true,
        opacity: 0.38
      })
    );
    const angle = Math.random() * Math.PI * 2;
    const radius = 4 + Math.random() * 22;
    glint.position.set(Math.cos(angle) * radius, 0.24 + Math.random() * 0.12, Math.sin(angle) * radius * 0.58);
    glint.rotation.x = -Math.PI / 2;
    glint.rotation.z = angle;
    group.add(glint);
  }
  root.add(group);
}

function addStreetLights() {
  const palette = [0x4dfff2, 0xffb36b, 0xffe89d];
  for (let index = 0; index < 24; index += 1) {
    const group = new THREE.Group();
    const row = index % 3;
    const column = Math.floor(index / 3);
    group.position.set(-24 + column * 6.7, 0, [-12.7, 0.8, 12.6][row] + Math.sin(column) * 0.35);

    const color = palette[index % palette.length];
    const height = 0.42 + (index % 2) * 0.08;
    const pole = new THREE.Mesh(
      new THREE.CylinderGeometry(0.025, 0.045, height, 8),
      new THREE.MeshStandardMaterial({ color: 0x263844, emissive: 0x102a34, emissiveIntensity: 0.24, metalness: 0.35, roughness: 0.48 })
    );
    pole.position.y = height * 0.5;
    group.add(pole);

    const head = new THREE.Mesh(
      new THREE.SphereGeometry(0.12, 10, 10),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.95 })
    );
    head.position.y = height;
    group.add(head);
    root.add(group);
  }
}

function addLowRoof(group, w, h, d, rng) {
  const roof = new THREE.Mesh(
    new THREE.BoxGeometry(w * 0.72, 0.06, d * 0.72),
    new THREE.MeshBasicMaterial({
      color: rng() > 0.5 ? 0x4ce8ff : 0xff67da,
      transparent: true,
      opacity: 0.38
    })
  );
  roof.position.y = h + 0.05;
  group.add(roof);
}

function addAntenna(group, x, y, z, height, color = 0x55ebff) {
  const mast = new THREE.Mesh(
    new THREE.BoxGeometry(0.06, height, 0.06),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9 })
  );
  mast.position.set(x, y + height * 0.5, z);
  group.add(mast);
}

function addNeonAccents(group, w, h, d, rng) {
  if (h < 2.4 || rng() > 0.42) {
    return;
  }
  const palette = [0x49fff2, 0xff62d6, 0xffb347, 0x9dff4c];
  const pick = () => palette[Math.floor(rng() * palette.length)];
  const edge = new THREE.Mesh(
    new THREE.BoxGeometry(0.08, h * (0.55 + rng() * 0.35), 0.08),
    new THREE.MeshBasicMaterial({ color: pick(), transparent: true, opacity: 0.88 })
  );
  edge.position.set((rng() > 0.5 ? -1 : 1) * (w * 0.5 + 0.02), h * (0.45 + rng() * 0.18), (rng() - 0.5) * d * 0.35);
  group.add(edge);
  if (h > 6 && rng() > 0.25) {
    const band = new THREE.Mesh(
      new THREE.BoxGeometry(w * (0.55 + rng() * 0.35), 0.08, 0.08),
      new THREE.MeshBasicMaterial({ color: pick(), transparent: true, opacity: 0.82 })
    );
    band.position.set(0, h * (0.58 + rng() * 0.18), d * 0.5 + 0.02);
    group.add(band);
  }
  if (h > 9 && rng() > 0.3) {
    addAntenna(group, (rng() - 0.5) * w * 0.18, h, (rng() - 0.5) * d * 0.18, 1.6 + rng() * 3.8, pick());
  }
}

function addBuildingFeatures(group, w, h, d, rng) {
  const palette = [0x49fff2, 0xff62d6, 0xffb347, 0x9dff4c];
  const pick = () => palette[Math.floor(rng() * palette.length)];
  if (h > 5 && rng() > 0.3) {
    const count = 1 + Math.floor(rng() * 3);
    for (let index = 0; index < count; index += 1) {
      const slit = new THREE.Mesh(
        new THREE.BoxGeometry(0.06, h * (0.12 + rng() * 0.18), d * (0.08 + rng() * 0.12)),
        new THREE.MeshBasicMaterial({ color: pick(), transparent: true, opacity: 0.88 })
      );
      slit.position.set((rng() > 0.5 ? -1 : 1) * (w * 0.5 + 0.04), h * (0.24 + rng() * 0.52), (rng() - 0.5) * d * 0.42);
      group.add(slit);
    }
  }
}

function addBuilding(serverBuilding) {
  const hash = hashString(serverBuilding.id);
  const rng = mulberry32(hash);
  const group = new THREE.Group();
  const scale = 15;
  const vesselScale = 0.62;
  const w = Math.max(0.22, (serverBuilding.width / scale) * vesselScale);
  const d = Math.max(0.5, (serverBuilding.depth / scale) * vesselScale);
  const h = Math.max(0.24, (serverBuilding.height / 14) * vesselScale);
  const x = serverBuilding.x / scale;
  const z = serverBuilding.z / scale;
  const heading = serverBuilding.heading || 0;
  const zonePalettes = {
    supertanker: {
      hull: [0x6b2530, 0x7c2c24, 0x4d5964],
      deck: [0xd4d0bd, 0xc8c4ad],
      emissive: [0xffcc7a, 0x9df6ff]
    },
    container: {
      hull: [0x234c67, 0x2d5868, 0x3e4754],
      deck: [0xd96f42, 0x3fa4b8, 0xe1b857],
      emissive: [0x9df6ff, 0xffc66e]
    },
    cargo: {
      hull: [0x2f4856, 0x365763, 0x5b5045],
      deck: [0xd7d0bc, 0xb9c3bd],
      emissive: [0xffc66e, 0xa8f6ff]
    },
    patrol: {
      hull: [0x586878, 0x677887, 0x44525d],
      deck: [0xdbe3e3, 0xbfc9c9],
      emissive: [0x9df6ff, 0xff4f4f]
    },
    fastboat: {
      hull: [0x39424a, 0x4b5961, 0x2b343b],
      deck: [0xd8d2c4, 0xf0e7d4],
      emissive: [0xffd875, 0x9df6ff]
    },
    dhow: {
      hull: [0x6b4a2f, 0x7a5737, 0x4f3a27],
      deck: [0xd1b47d, 0xc59a5b],
      emissive: [0xffd875]
    }
  };
  const palette = zonePalettes[serverBuilding.zone] || zonePalettes.cargo;
  const hullMaterial = new THREE.MeshStandardMaterial({
    color: palette.hull[hash % palette.hull.length],
    emissive: palette.emissive[(hash >>> 3) % palette.emissive.length],
    emissiveIntensity: 0.16 + rng() * 0.12,
    metalness: 0.26,
    roughness: 0.44
  });
  const deckMaterial = new THREE.MeshStandardMaterial({
    color: palette.deck[(hash >>> 4) % palette.deck.length],
    metalness: 0.18,
    roughness: 0.5
  });

  const hull = new THREE.Mesh(new THREE.BoxGeometry(w, h * 0.62, d * 0.86), hullMaterial);
  hull.position.y = h * 0.34;
  hull.userData.buildingGroup = group;
  group.position.set(x, 0, z);
  group.rotation.y = heading;
  group.add(hull);

  const bow = new THREE.Mesh(
    new THREE.ConeGeometry(w * 0.51, d * 0.16, 4),
    hullMaterial
  );
  bow.rotation.x = Math.PI * 0.5;
  bow.rotation.y = Math.PI * 0.25;
  bow.scale.y = 0.68;
  bow.position.set(0, h * 0.34, d * 0.5);
  bow.userData.buildingGroup = group;
  group.add(bow);

  const stern = new THREE.Mesh(new THREE.BoxGeometry(w * 0.82, h * 0.48, d * 0.13), hullMaterial);
  stern.position.set(0, h * 0.34, -d * 0.49);
  stern.userData.buildingGroup = group;
  group.add(stern);

  const deck = new THREE.Mesh(new THREE.BoxGeometry(w * 0.78, h * 0.1, d * 0.7), deckMaterial);
  deck.position.y = h * 0.72;
  deck.userData.buildingGroup = group;
  group.add(deck);

  const bridge = new THREE.Mesh(
    new THREE.BoxGeometry(w * (serverBuilding.zone === "fastboat" ? 0.44 : 0.34), h * 0.46, d * 0.14),
    deckMaterial
  );
  bridge.position.set(0, h * 1.0, -d * (serverBuilding.zone === "fastboat" ? 0.04 : 0.26));
  bridge.userData.buildingGroup = group;
  group.add(bridge);

  if (serverBuilding.zone === "container") {
    const colors = [0xdc5d3f, 0x3aa0b5, 0xe0b84d, 0x6f8a96];
    for (let row = 0; row < 2; row += 1) {
      for (let col = 0; col < 3; col += 1) {
        if (rng() < 0.14) {
          continue;
        }
        const box = new THREE.Mesh(
          new THREE.BoxGeometry(w * 0.25, h * 0.16, d * 0.105),
          new THREE.MeshStandardMaterial({ color: colors[(row + col + hash) % colors.length], roughness: 0.58 })
        );
        box.position.set((col - 1) * w * 0.2, h * (0.86 + row * 0.17), d * 0.05);
        box.userData.buildingGroup = group;
        group.add(box);
      }
    }
  }

  if (serverBuilding.zone === "supertanker") {
    for (let index = 0; index < 4; index += 1) {
      const pipe = new THREE.Mesh(
        new THREE.CylinderGeometry(0.025, 0.025, d * 0.42, 8),
        new THREE.MeshBasicMaterial({ color: 0xd7d1b8, transparent: true, opacity: 0.82 })
      );
      pipe.rotation.x = Math.PI * 0.5;
      pipe.position.set((index - 1.5) * w * 0.16, h * 0.9, d * 0.02);
      pipe.userData.buildingGroup = group;
      group.add(pipe);
    }
  }

  if (serverBuilding.zone === "dhow") {
    const mast = new THREE.Mesh(
      new THREE.CylinderGeometry(0.025, 0.035, h * 1.6, 8),
      new THREE.MeshStandardMaterial({ color: 0x8b673d, roughness: 0.72 })
    );
    mast.position.y = h * 1.35;
    mast.userData.buildingGroup = group;
    group.add(mast);
    const sail = new THREE.Mesh(
      new THREE.PlaneGeometry(w * 0.9, h * 1.05),
      new THREE.MeshBasicMaterial({ color: 0xe8d8ad, transparent: true, opacity: 0.72, side: THREE.DoubleSide })
    );
    sail.position.set(w * 0.15, h * 1.36, 0);
    sail.rotation.y = -0.25;
    sail.userData.buildingGroup = group;
    group.add(sail);
  }

  const wake = new THREE.Mesh(
    new THREE.PlaneGeometry(w * 1.55, d * 0.7),
    new THREE.MeshBasicMaterial({ color: 0xc9f8ff, transparent: true, opacity: 0.16, side: THREE.DoubleSide })
  );
  wake.rotation.x = -Math.PI / 2;
  wake.position.set(0, 0.045, -d * 0.58);
  wake.userData.buildingGroup = group;
  group.add(wake);

  if (rng() > 0.2) {
    const marker = new THREE.Mesh(
      new THREE.SphereGeometry(0.055, 8, 8),
      new THREE.MeshBasicMaterial({ color: palette.emissive[0], transparent: true, opacity: 0.92 })
    );
    marker.position.set(0, h * 1.12, d * 0.38);
    marker.userData.buildingGroup = group;
    group.add(marker);
  }

  if (d > 2.8 || serverBuilding.zone === "patrol") {
    const label = makeLabelSprite(shortBuildingCode(serverBuilding.id));
    label.position.set(0, h + 0.85, 0);
    label.userData.buildingGroup = group;
    group.add(label);
  }

  group.userData = {
    id: serverBuilding.id,
    isBuilding: true,
    exploded: Boolean(serverBuilding.destroyedAt),
    pendingStrike: false,
    destroyedAt: serverBuilding.destroyedAt,
    basePosition: new THREE.Vector3(x, 0, z),
    driftPhase: rng() * Math.PI * 2,
    moveSpeed: 0.12 + rng() * 0.08,
    mapLimitX: 29.5,
    driftDirection: new THREE.Vector3(Math.sin(heading), 0, Math.cos(heading)),
    size: { w, h, d }
  };

  group.visible = !serverBuilding.destroyedAt;
  buildings.push(group);
  buildingMap.set(serverBuilding.id, group);
  root.add(group);
}

function rebuildCity(state) {
  explosions.splice(0, explosions.length);
  missiles.splice(0, missiles.length);
  buildings.splice(0, buildings.length);
  buildingMap.clear();
  trafficSystems.splice(0, trafficSystems.length);

  for (let index = root.children.length - 1; index >= 0; index -= 1) {
    const child = root.children[index];
    root.remove(child);
  }

  addBackdrop();
  addBase();
  addGroundGlow();
  addRoads();
  addStreetLights();
  addForegroundGlow();
  state.buildings.forEach(addBuilding);
  previousDestroyed = new Map(state.buildings.map((building) => [building.id, building.destroyedAt]));
}

function createMissile(group, start, control, target, duration, options = {}) {
  const missileScale = options.missileScale || 1;
  const trailScale = options.trailScale || 1;
  const exhaustIntensity = options.exhaustIntensity || 2.8;
  const canExplode = options.canExplode !== false;
  const arc = options.arc || "curve";
  const outcome = options.outcome || "destroyed";
  const interceptAt = options.interceptAt || 0.68;
  const startDelay = options.startDelay || 0;
  const missileGroup = new THREE.Group();
  const body = new THREE.Mesh(
    new THREE.CylinderGeometry(0.06 * missileScale, 0.09 * missileScale, 1.15 * missileScale, 10),
    new THREE.MeshStandardMaterial({ color: 0xd7e6ff, emissive: 0x5decff, emissiveIntensity: 0.7, metalness: 0.4, roughness: 0.28 })
  );
  body.rotation.z = Math.PI * 0.5;
  missileGroup.add(body);
  const nose = new THREE.Mesh(
    new THREE.ConeGeometry(0.12 * missileScale, 0.28 * missileScale, 10),
    new THREE.MeshBasicMaterial({ color: 0xff73d8, transparent: true, opacity: 0.95 })
  );
  nose.position.x = 0.68 * missileScale;
  nose.rotation.z = -Math.PI * 0.5;
  missileGroup.add(nose);
  const exhaust = new THREE.PointLight(0xff8fd8, exhaustIntensity, 3.2 + trailScale * 1.1, 2);
  exhaust.position.x = -0.55 * missileScale;
  missileGroup.add(exhaust);
  root.add(missileGroup);

  const trailCount = 28;
  const trailPositions = new Float32Array(trailCount * 3);
  const trailColors = new Float32Array(trailCount * 3);
  const trailSizes = new Float32Array(trailCount);
  for (let index = 0; index < trailCount; index += 1) {
    trailPositions[index * 3] = start.x;
    trailPositions[index * 3 + 1] = start.y;
    trailPositions[index * 3 + 2] = start.z;
    const t = index / Math.max(1, trailCount - 1);
    const color = new THREE.Color().lerpColors(new THREE.Color(0xff6dd6), new THREE.Color(0x55edff), t);
    trailColors[index * 3] = color.r;
    trailColors[index * 3 + 1] = color.g;
    trailColors[index * 3 + 2] = color.b;
    trailSizes[index] = 18 * trailScale * (1 - t * 0.72);
  }
  const trailGeometry = new THREE.BufferGeometry();
  trailGeometry.setAttribute("position", new THREE.BufferAttribute(trailPositions, 3));
  trailGeometry.setAttribute("color", new THREE.BufferAttribute(trailColors, 3));
  trailGeometry.setAttribute("aSize", new THREE.BufferAttribute(trailSizes, 1));
  const trailMaterial = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: {
      pointTexture: { value: fireParticleTexture },
      globalAlpha: { value: 0.9 }
    },
    vertexShader: `
      attribute float aSize;
      varying vec3 vColor;
      void main() {
        vColor = color;
        vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
        gl_PointSize = min(aSize * (70.0 / -mvPosition.z), 16.0);
        gl_Position = projectionMatrix * mvPosition;
      }
    `,
    fragmentShader: `
      uniform sampler2D pointTexture;
      uniform float globalAlpha;
      varying vec3 vColor;
      void main() {
        vec4 tex = texture2D(pointTexture, gl_PointCoord);
        gl_FragColor = vec4(vColor, tex.a * globalAlpha);
      }
    `,
    vertexColors: true
  });
  const trail = new THREE.Points(trailGeometry, trailMaterial);
  root.add(trail);
  const history = Array.from({ length: trailCount }, () => start.clone());
  const missile = {
    group,
    canExplode,
    trailScale,
    timingProfile: options.timingProfile || "linear",
    arc,
    outcome,
    interceptAt,
    startDelay,
    orbitCenter: options.orbitCenter || null,
    orbitRadius: options.orbitRadius || 0,
    start,
    control,
    target,
    missileGroup,
    exhaust,
    trail,
    trailPositions,
    history,
    curve: arc === "horizontalDive" || arc === "orbitDive"
      ? null
      : new THREE.QuadraticBezierCurve3(start, control, target),
    elapsed: 0,
    duration
  };
  if (startDelay > 0) {
    missileGroup.visible = false;
    trail.visible = false;
  }
  missiles.push(missile);
  return missile;
}

function createAirplaneStrike(group, start, control, target, duration, options = {}) {
  if (!airplaneTemplate) {
    return null;
  }

  const planeWrapper = airplaneTemplate.clone(true);
  const engineGlow = new THREE.PointLight(0xffb86c, 1.7, 4.4, 2);
  engineGlow.position.set(-0.95, 0.34, 0);
  planeWrapper.add(engineGlow);
  planeWrapper.position.copy(start);
  root.add(planeWrapper);

  const trailCount = 20;
  const trailPositions = new Float32Array(trailCount * 3);
  const trailColors = new Float32Array(trailCount * 3);
  const trailSizes = new Float32Array(trailCount);
  for (let index = 0; index < trailCount; index += 1) {
    trailPositions[index * 3] = start.x;
    trailPositions[index * 3 + 1] = start.y;
    trailPositions[index * 3 + 2] = start.z;
    const t = index / Math.max(1, trailCount - 1);
    const color = new THREE.Color().lerpColors(new THREE.Color(0xffd98d), new THREE.Color(0xff764c), t);
    trailColors[index * 3] = color.r;
    trailColors[index * 3 + 1] = color.g;
    trailColors[index * 3 + 2] = color.b;
    trailSizes[index] = 16 * (1 - t * 0.74);
  }
  const trailGeometry = new THREE.BufferGeometry();
  trailGeometry.setAttribute("position", new THREE.BufferAttribute(trailPositions, 3));
  trailGeometry.setAttribute("color", new THREE.BufferAttribute(trailColors, 3));
  trailGeometry.setAttribute("aSize", new THREE.BufferAttribute(trailSizes, 1));
  const trailMaterial = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: {
      pointTexture: { value: smokeParticleTexture },
      globalAlpha: { value: 0.72 }
    },
    vertexShader: `
      attribute float aSize;
      varying vec3 vColor;
      void main() {
        vColor = color;
        vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
        gl_PointSize = min(aSize * (70.0 / -mvPosition.z), 18.0);
        gl_Position = projectionMatrix * mvPosition;
      }
    `,
    fragmentShader: `
      uniform sampler2D pointTexture;
      uniform float globalAlpha;
      varying vec3 vColor;
      void main() {
        vec4 tex = texture2D(pointTexture, gl_PointCoord);
        gl_FragColor = vec4(vColor, tex.a * globalAlpha);
      }
    `,
    vertexColors: true
  });
  const trail = new THREE.Points(trailGeometry, trailMaterial);
  root.add(trail);

  const history = Array.from({ length: trailCount }, () => start.clone());
  const airplane = {
    group,
    outcome: options.outcome || "destroyed",
    canExplode: options.canExplode !== false,
    interceptAt: options.interceptAt || 0.72,
    startDelay: options.startDelay || 0,
    planeWrapper,
    engineGlow,
    trail,
    trailPositions,
    history,
    start,
    target,
    direction: target.clone().sub(start).normalize(),
    elapsed: 0,
    duration
  };
  if (airplane.startDelay > 0) {
    planeWrapper.visible = false;
    trail.visible = false;
  }
  airplanes.push(airplane);
  return airplane;
}

function getMissilePose(missile, rawT) {
  let t = rawT;
  if (missile.timingProfile === "delayedBurst") {
    if (rawT < 0.66) {
      t = rawT * 0.5;
    } else {
      const burstT = (rawT - 0.66) / 0.34;
      const easedBurst = 1 - Math.pow(1 - burstT, 1.75);
      t = 0.33 + (1 - 0.33) * easedBurst;
    }
  } else if (missile.timingProfile === "patriotChase") {
    if (rawT < 0.66) {
      t = rawT * 0.34;
    } else {
      const burstT = (rawT - 0.66) / 0.34;
      const easedBurst = 1 - Math.pow(1 - burstT, 2.2);
      t = 0.2244 + (1 - 0.2244) * easedBurst;
    }
  }

  let current;
  let tangent;
  if (missile.arc === "horizontalDive") {
    const diveStart = 0.78;
    if (t < diveStart) {
      const cruiseT = t / diveStart;
      current = new THREE.Vector3().lerpVectors(missile.start, missile.control, cruiseT);
      tangent = missile.control.clone().sub(missile.start).normalize();
    } else {
      const diveT = THREE.MathUtils.smoothstep((t - diveStart) / (1 - diveStart), 0, 1);
      current = new THREE.Vector3().lerpVectors(missile.control, missile.target, diveT);
      tangent = missile.target.clone().sub(missile.control).normalize();
    }
  } else if (missile.arc === "orbitDive") {
    const approachEnd = 0.24;
    const orbitEnd = 0.82;
    if (t < approachEnd) {
      const approachT = t / approachEnd;
      current = new THREE.Vector3().lerpVectors(missile.start, missile.control, approachT);
      tangent = missile.control.clone().sub(missile.start).normalize();
    } else if (t < orbitEnd) {
      const orbitT = (t - approachEnd) / (orbitEnd - approachEnd);
      const angle = orbitT * Math.PI * 4;
      const center = missile.orbitCenter || missile.control;
      const radius = missile.orbitRadius || 4.8;
      current = new THREE.Vector3(
        center.x + Math.cos(angle) * radius,
        center.y + Math.sin(orbitT * Math.PI) * 0.8,
        center.z + Math.sin(angle) * radius
      );
      const nextAngle = angle + 0.05;
      const nextPoint = new THREE.Vector3(
        center.x + Math.cos(nextAngle) * radius,
        center.y + Math.sin(Math.min(1, orbitT + 0.01) * Math.PI) * 0.8,
        center.z + Math.sin(nextAngle) * radius
      );
      tangent = nextPoint.sub(current).normalize();
    } else {
      const orbitAngle = Math.PI * 4;
      const center = missile.orbitCenter || missile.control;
      const radius = missile.orbitRadius || 4.8;
      const diveStartPoint = new THREE.Vector3(
        center.x + Math.cos(orbitAngle) * radius,
        center.y,
        center.z + Math.sin(orbitAngle) * radius
      );
      const diveT = THREE.MathUtils.smoothstep((t - orbitEnd) / (1 - orbitEnd), 0, 1);
      current = new THREE.Vector3().lerpVectors(diveStartPoint, missile.target, diveT);
      tangent = missile.target.clone().sub(diveStartPoint).normalize();
    }
  } else {
    current = missile.curve.getPoint(t);
    tangent = missile.curve.getTangent(Math.min(0.999, t + 0.001)).normalize();
  }

  return { current, tangent, t };
}

function launchPatriotInterceptor(group, interceptPoint, duration, seed) {
  const rand = mulberry32(seed);
  const launchBase = group.position.clone().add(new THREE.Vector3(
    (rand() - 0.5) * 5,
    0.8 + rand() * 0.8,
    (rand() - 0.5) * 5
  ));
  const control = launchBase.clone().lerp(interceptPoint, 0.45).add(new THREE.Vector3(
    (rand() - 0.5) * 1.2,
    6 + rand() * 5,
    (rand() - 0.5) * 1.2
  ));
  createMissile(group, launchBase, control, interceptPoint, duration, {
    missileScale: 0.72,
    trailScale: 0.82,
    exhaustIntensity: 2.1,
    canExplode: false,
    timingProfile: "patriotChase",
    arc: "curve",
    outcome: "interceptor"
  });
}

function hasActiveStrikeVisualForGroup(group) {
  return missiles.some((missile) => missile.group === group) || airplanes.some((airplane) => airplane.group === group);
}

function handleStrikeStarted(strikePayload) {
  if (!strikePayload || !strikePayload.strike || !appState) {
    return;
  }
  if (strikePayload.roundId !== appState.roundId) {
    return;
  }
  if (seenStrikeIds.has(strikePayload.strike.strikeId)) {
    return;
  }
  seenStrikeIds.add(strikePayload.strike.strikeId);
  activeStrikeBuildings.set(strikePayload.strike.strikeId, strikePayload.strike.buildingId);
  const strikeGroup = buildingMap.get(strikePayload.strike.buildingId);
  if (!strikeGroup) {
    return;
  }
  strikeGroup.userData.pendingStrike = true;
  launchStrikeVehicle(strikeGroup, strikePayload.strike);
}

function handleStrikeResolved(strikePayload) {
  if (!strikePayload || !strikePayload.strike || !appState) {
    return;
  }
  if (strikePayload.roundId !== appState.roundId) {
    return;
  }
  activeStrikeBuildings.delete(strikePayload.strike.strikeId);
  const strikeGroup = buildingMap.get(strikePayload.strike.buildingId);
  if (!strikeGroup) {
    return;
  }
  strikeGroup.userData.pendingStrike = false;
  if (strikePayload.strike.outcome === "destroyed") {
    strikeGroup.userData.destroyedAt = strikePayload.strike.resolvedAt || Date.now();
    if (!hasActiveStrikeVisualForGroup(strikeGroup)) {
      explodeBuilding(strikeGroup);
    }
  }
}

function launchStrikeVehicle(group, strikeMeta) {
  const seed = hashString(`${strikeMeta.buildingId}:${strikeMeta.startedAt}:${strikeMeta.vehicle || "missile"}:${strikeMeta.outcome}`);
  if (strikeMeta.vehicle === "airplane") {
    if (airplaneTemplate) {
      launchAirplane(group, seed, strikeMeta.outcome, strikeMeta);
    } else {
      pendingAirplaneStrikes.push({
        group,
        seed,
        outcome: strikeMeta.outcome,
        strikeMeta
      });
      console.warn("[Skyline MM2] Airplane requested before FBX was ready; queued strike.", strikeMeta);
    }
    return;
  }
  launchMissile(group, seed, strikeMeta.outcome, strikeMeta);
}

function launchMissile(group, seed, outcome = "destroyed", strikeMeta) {
  if (!group || group.userData.exploded) {
    return;
  }
  const rand = mulberry32(seed || hashString(group.userData.id));
  const { w, h, d } = group.userData.size;
  const target = group.position.clone().add(new THREE.Vector3(0, h * 0.72, 0));
  const angle = rand() * Math.PI * 2;
  const radius = 20 + rand() * 10;
  const footprint = Math.max(w, d);
  const cluster = footprint > 1.35 && rand() < 0.6;
  const clusterCount = cluster ? (rand() < 0.5 ? 3 : 5) : 1;
  const arcRoll = rand();
  const baseArc = outcome === "intercepted"
    ? "curve"
    : arcRoll < 0.2
      ? "horizontalDive"
      : arcRoll < 0.3
        ? "orbitDive"
        : "curve";
  const baseStart = baseArc === "horizontalDive"
    ? target.clone().add(new THREE.Vector3(Math.cos(angle) * (26 + rand() * 10), 17 + rand() * 5, Math.sin(angle) * (26 + rand() * 10)))
    : baseArc === "orbitDive"
      ? target.clone().add(new THREE.Vector3(Math.cos(angle) * (30 + rand() * 12), 17 + rand() * 4, Math.sin(angle) * (30 + rand() * 12)))
      : target.clone().add(new THREE.Vector3(Math.cos(angle) * radius, 24 + rand() * 10, Math.sin(angle) * radius));
  const baseControl = baseArc === "horizontalDive"
    ? target.clone().add(new THREE.Vector3(Math.cos(angle) * (10 + rand() * 5), 18 + rand() * 4, Math.sin(angle) * (10 + rand() * 5)))
    : baseArc === "orbitDive"
      ? target.clone().add(new THREE.Vector3(0, 15 + rand() * 4, 0))
      : target.clone().add(new THREE.Vector3(Math.cos(angle) * (6 + rand() * 5), 11 + rand() * 7, Math.sin(angle) * (6 + rand() * 5)));
  const direction = target.clone().sub(baseStart).normalize();
  const side = new THREE.Vector3(-direction.z, 0, direction.x).normalize();
  const up = new THREE.Vector3().crossVectors(side, direction).normalize();
  const spacing = 0.34 + footprint * 0.08;
  const attackerStartDelay = outcome === "intercepted" ? 0.7 : 0;
  const travelDuration = strikeMeta && strikeMeta.impactAt
    ? Math.max(0.25, (strikeMeta.impactAt - Date.now()) / 1000)
    : null;
  const orbitCenter = target.clone().add(new THREE.Vector3(0, 14 + rand() * 4, 0));
  const orbitRadius = 3.8 + rand() * 2.8;

  for (let index = 0; index < clusterCount; index += 1) {
    const row = cluster ? Math.floor(index / 2) : 0;
    const col = cluster ? (index % 2 === 0 ? -1 : 1) : 0;
    const offset = cluster
      ? side.clone().multiplyScalar(col * spacing * (0.7 + row * 0.16))
          .add(up.clone().multiplyScalar((1.3 - row) * spacing * 0.22))
      : new THREE.Vector3();

    if (cluster && index === clusterCount - 1 && clusterCount % 2 === 1) {
      offset.set(0, -spacing * 0.15, 0);
    }

    const targetOffset = cluster && index > 0
      ? side.clone().multiplyScalar((rand() - 0.5) * 0.45)
          .add(new THREE.Vector3(0, (rand() - 0.5) * 0.22, 0))
      : new THREE.Vector3();

    const missile = createMissile(
      group,
      baseStart.clone().add(offset),
      baseControl.clone().add(offset.clone().multiplyScalar(0.55)),
      target.clone().add(targetOffset),
      travelDuration || (0.9 + rand() * 0.35 - (cluster ? rand() * 0.06 : 0)),
      {
        missileScale: cluster ? 0.84 + rand() * 0.08 : 1,
        trailScale: cluster ? 0.92 + rand() * 0.16 : 1.04,
        exhaustIntensity: cluster ? 2.2 + rand() * 0.6 : 2.8,
        canExplode: index === 0 && outcome === "destroyed",
        timingProfile: outcome === "intercepted" ? "linear" : (rand() < 0.125 ? "delayedBurst" : "linear"),
        arc: baseArc,
        outcome,
        interceptAt: 0.62 + rand() * 0.14,
        startDelay: attackerStartDelay,
        orbitCenter,
        orbitRadius
      }
    );

    if (outcome === "intercepted" && index === 0) {
      const interceptPose = getMissilePose(missile, missile.interceptAt);
      launchPatriotInterceptor(
        group,
        interceptPose.current.clone(),
        Math.max(0.42, missile.startDelay + missile.duration * missile.interceptAt),
        hashString(`${group.userData.id}:patriot:${seed}`)
      );
    }
  }
}

function launchAirplane(group, seed, outcome = "destroyed", strikeMeta) {
  if (!group || group.userData.exploded || !airplaneTemplate) {
    return;
  }
  const rand = mulberry32(seed || hashString(group.userData.id));
  const { h } = group.userData.size;
  const target = group.position.clone().add(new THREE.Vector3(0, h * (2 / 3), 0));
  const startDistance = 34 + rand() * 14;
  const edge = Math.floor(rand() * 4);
  const lateralOffset = (rand() - 0.5) * 18;
  const start = target.clone();
  if (edge === 0) {
    start.x += startDistance;
    start.z += lateralOffset;
  } else if (edge === 1) {
    start.x -= startDistance;
    start.z += lateralOffset;
  } else if (edge === 2) {
    start.z += startDistance;
    start.x += lateralOffset;
  } else {
    start.z -= startDistance;
    start.x += lateralOffset;
  }
  start.y = target.y;
  const duration = strikeMeta && strikeMeta.impactAt
    ? Math.max(1.8, (strikeMeta.impactAt - Date.now()) / 1000)
    : 4.8;
  const airplane = createAirplaneStrike(group, start, start.clone().lerp(target, 0.5), target, duration, {
    outcome,
    interceptAt: 0.64 + rand() * 0.12
  });

  if (outcome === "intercepted" && airplane) {
    launchPatriotInterceptor(
      group,
      new THREE.Vector3().lerpVectors(airplane.start, airplane.target, airplane.interceptAt),
      Math.max(0.42, airplane.duration * airplane.interceptAt),
      hashString(`${group.userData.id}:patriot-plane:${seed}`)
    );
  }
}

function explodeBuilding(group) {
  if (!group || group.userData.exploded) {
    return;
  }
  const { w, h, d } = group.userData.size;
  group.userData.exploded = true;
  group.visible = false;

  const origin = group.position.clone().add(new THREE.Vector3(0, h * 0.45, 0));
  const flash = new THREE.PointLight(0xffcfa0, 8, 10, 1.7);
  flash.position.copy(origin);
  root.add(flash);

  const createCloud = (count, texture, size, colorA, colorB, rise) => {
    const positions = new Float32Array(count * 3);
    const velocities = new Float32Array(count * 3);
    const sizes = new Float32Array(count);
    const alphas = new Float32Array(count);
    const colors = new Float32Array(count * 3);
    const color = new THREE.Color();
    for (let index = 0; index < count; index += 1) {
      const theta = Math.random() * Math.PI * 2;
      const radial = Math.random() * 0.9;
      positions[index * 3] = origin.x + Math.cos(theta) * radial;
      positions[index * 3 + 1] = origin.y + Math.random() * 0.6;
      positions[index * 3 + 2] = origin.z + Math.sin(theta) * radial;
      velocities[index * 3] = (Math.random() - 0.5) * 2;
      velocities[index * 3 + 1] = rise + Math.random() * 2;
      velocities[index * 3 + 2] = (Math.random() - 0.5) * 2;
      sizes[index] = size * (0.65 + Math.random() * 1.4);
      alphas[index] = 0.85;
      color.lerpColors(new THREE.Color(colorA), new THREE.Color(colorB), Math.random());
      colors[index * 3] = color.r;
      colors[index * 3 + 1] = color.g;
      colors[index * 3 + 2] = color.b;
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    geometry.setAttribute("aSize", new THREE.BufferAttribute(sizes, 1));
    geometry.setAttribute("aAlpha", new THREE.BufferAttribute(alphas, 1));
    const material = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: { pointTexture: { value: texture }, globalAlpha: { value: 1 } },
      vertexShader: `
        attribute float aSize;
        attribute float aAlpha;
        varying vec3 vColor;
        varying float vAlpha;
        void main() {
          vColor = color;
          vAlpha = aAlpha;
          vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = aSize * (260.0 / -mvPosition.z);
          gl_Position = projectionMatrix * mvPosition;
        }
      `,
      fragmentShader: `
        uniform sampler2D pointTexture;
        uniform float globalAlpha;
        varying vec3 vColor;
        varying float vAlpha;
        void main() {
          vec4 tex = texture2D(pointTexture, gl_PointCoord);
          gl_FragColor = vec4(vColor, tex.a * vAlpha * globalAlpha);
        }
      `,
      vertexColors: true
    });
    const points = new THREE.Points(geometry, material);
    root.add(points);
    return { points, positions, velocities, material, alphas };
  };

  explosions.push({
    type: "blast",
    life: 0,
    maxLife: 2.8,
    flash,
    fire: createCloud(90, fireParticleTexture, 12, 0xffe6b5, 0xff5b16, 0.8),
    smoke: createCloud(120, smokeParticleTexture, 16, 0x5a5a5a, 0x171717, 1.2)
  });

  const addedStrength = Math.min(0.3, Math.max(w, d) * 0.045);
  cameraShake.time = 0;
  cameraShake.duration = Math.min(0.9, cameraShake.duration + 0.16, 0.42 + addedStrength * 0.9);
  cameraShake.strength = Math.min(1.2, cameraShake.strength + addedStrength);
  playBlastSound(Math.min(1.4, 0.8 + addedStrength * 2.4));
}

function updateExplosions(delta) {
  for (let index = explosions.length - 1; index >= 0; index -= 1) {
    const item = explosions[index];
    item.life += delta;
    const t = item.life / item.maxLife;
    if (item.type === "escortFlash") {
      item.flash.intensity = Math.max(0, 1.4 * (1 - t));
      if (item.life >= item.maxLife) {
        item.flash.parent?.remove(item.flash);
        explosions.splice(index, 1);
      }
      continue;
    }

    [item.fire, item.smoke].forEach((cloud, cloudIndex) => {
      for (let particle = 0; particle < cloud.alphas.length; particle += 1) {
        cloud.positions[particle * 3] += cloud.velocities[particle * 3] * delta;
        cloud.positions[particle * 3 + 1] += cloud.velocities[particle * 3 + 1] * delta;
        cloud.positions[particle * 3 + 2] += cloud.velocities[particle * 3 + 2] * delta;
        cloud.velocities[particle * 3] *= 1 - 0.2 * delta;
        cloud.velocities[particle * 3 + 1] += (cloudIndex === 0 ? 0.18 : 0.42) * delta;
        cloud.velocities[particle * 3 + 2] *= 1 - 0.2 * delta;
      }
      cloud.points.geometry.attributes.position.needsUpdate = true;
      cloud.material.uniforms.globalAlpha.value = Math.max(0, 1 - t * (cloudIndex === 0 ? 1.4 : 1.05));
    });
    item.flash.intensity = Math.max(0, 8 * (1 - t * 1.5));
    if (item.life >= item.maxLife) {
      [item.flash, item.fire.points, item.smoke.points].forEach((obj) => obj.parent?.remove(obj));
      explosions.splice(index, 1);
    }
  }
}

function updateMissiles(delta) {
  for (let index = missiles.length - 1; index >= 0; index -= 1) {
    const missile = missiles[index];
    missile.elapsed += delta;
    const activeElapsed = Math.max(0, missile.elapsed - missile.startDelay);
    const rawT = Math.min(1, activeElapsed / missile.duration);
    if (missile.elapsed < missile.startDelay) {
      missile.missileGroup.visible = false;
      missile.trail.visible = false;
      continue;
    }
    missile.missileGroup.visible = true;
    missile.trail.visible = true;
    const { current, tangent } = getMissilePose(missile, rawT);
    missile.missileGroup.position.copy(current);
    missile.missileGroup.quaternion.setFromUnitVectors(new THREE.Vector3(1, 0, 0), tangent);
    let burstBoost = 0;
    if (missile.timingProfile === "delayedBurst" && rawT > 0.66) {
      burstBoost = 0.45 + ((rawT - 0.66) / 0.34) * 0.75;
    } else if (missile.timingProfile === "patriotChase" && rawT > 0.66) {
      burstBoost = 0.35 + ((rawT - 0.66) / 0.34) * 0.95;
    }
    missile.exhaust.intensity = 1.4 + missile.trailScale * 0.7 + burstBoost + Math.sin(missile.elapsed * 50) * 0.35;
    missile.history.pop();
    missile.history.unshift(current.clone());
    for (let trailIndex = 0; trailIndex < missile.history.length; trailIndex += 1) {
      const point = missile.history[trailIndex];
      missile.trailPositions[trailIndex * 3] = point.x;
      missile.trailPositions[trailIndex * 3 + 1] = point.y;
      missile.trailPositions[trailIndex * 3 + 2] = point.z;
    }
    missile.trail.geometry.attributes.position.needsUpdate = true;
    missile.trail.material.uniforms.globalAlpha.value = 0.72 + missile.trailScale * 0.12 + (1 - rawT) * 0.14;
    if (missile.outcome === "intercepted" && rawT >= missile.interceptAt) {
      missile.missileGroup.parent?.remove(missile.missileGroup);
      missile.trail.parent?.remove(missile.trail);
      const patriotFlash = new THREE.PointLight(0x8cefff, 2.2, 4.2, 2);
      patriotFlash.position.copy(current);
      root.add(patriotFlash);
      explosions.push({
        type: "escortFlash",
        life: 0,
        maxLife: 0.18,
        flash: patriotFlash
      });
      missiles.splice(index, 1);
      continue;
    }
    if (rawT >= 1) {
      missile.missileGroup.parent?.remove(missile.missileGroup);
      missile.trail.parent?.remove(missile.trail);
      if (missile.outcome === "interceptor") {
        const interceptFlash = new THREE.PointLight(0x8cefff, 1.2, 2.8, 2);
        interceptFlash.position.copy(current);
        root.add(interceptFlash);
        explosions.push({
          type: "escortFlash",
          life: 0,
          maxLife: 0.1,
          flash: interceptFlash
        });
      } else if (missile.canExplode) {
        explodeBuilding(missile.group);
      } else if (missile.group && !missile.group.userData.exploded) {
        const escortFlash = new THREE.PointLight(0xff85de, 1.4, 3.2, 2);
        escortFlash.position.copy(current);
        root.add(escortFlash);
        explosions.push({
          type: "escortFlash",
          life: 0,
          maxLife: 0.12,
          flash: escortFlash
        });
      }
      missiles.splice(index, 1);
    }
  }
}

function updateAirplanes(delta) {
  for (let index = airplanes.length - 1; index >= 0; index -= 1) {
    const airplane = airplanes[index];
    airplane.elapsed += delta;
    const activeElapsed = Math.max(0, airplane.elapsed - airplane.startDelay);
    const rawT = Math.min(1, activeElapsed / airplane.duration);
    if (airplane.elapsed < airplane.startDelay) {
      airplane.planeWrapper.visible = false;
      airplane.trail.visible = false;
      continue;
    }

    airplane.planeWrapper.visible = true;
    airplane.trail.visible = true;
    const current = new THREE.Vector3().lerpVectors(airplane.start, airplane.target, rawT);
    const tangent = airplane.direction;
    airplane.planeWrapper.position.copy(current);
    airplane.planeWrapper.quaternion.setFromUnitVectors(new THREE.Vector3(1, 0, 0), tangent);
    airplane.planeWrapper.rotateX(Math.sin(airplane.elapsed * 2.2) * 0.8);
    airplane.engineGlow.intensity = 1.8 + Math.sin(airplane.elapsed * 28) * 0.25;

    airplane.history.pop();
    airplane.history.unshift(current.clone());
    for (let trailIndex = 0; trailIndex < airplane.history.length; trailIndex += 1) {
      const point = airplane.history[trailIndex];
      airplane.trailPositions[trailIndex * 3] = point.x;
      airplane.trailPositions[trailIndex * 3 + 1] = point.y;
      airplane.trailPositions[trailIndex * 3 + 2] = point.z;
    }
    airplane.trail.geometry.attributes.position.needsUpdate = true;
    airplane.trail.material.uniforms.globalAlpha.value = 0.62 + (1 - rawT) * 0.18;

    if (airplane.outcome === "intercepted" && rawT >= airplane.interceptAt) {
      airplane.planeWrapper.parent?.remove(airplane.planeWrapper);
      airplane.trail.parent?.remove(airplane.trail);
      const interceptFlash = new THREE.PointLight(0x8cefff, 2.4, 5.2, 2);
      interceptFlash.position.copy(current);
      root.add(interceptFlash);
      explosions.push({
        type: "escortFlash",
        life: 0,
        maxLife: 0.2,
        flash: interceptFlash
      });
      airplanes.splice(index, 1);
      continue;
    }

    if (rawT >= 1) {
      airplane.planeWrapper.parent?.remove(airplane.planeWrapper);
      airplane.trail.parent?.remove(airplane.trail);
      if (airplane.canExplode) {
        explodeBuilding(airplane.group);
      }
      airplanes.splice(index, 1);
    }
  }
}

function applyCameraShake(delta, elapsed) {
  camera.position.sub(cameraShake.offset);
  cameraShake.offset.set(0, 0, 0);
  if (cameraShake.time >= cameraShake.duration) {
    return;
  }
  cameraShake.time += delta;
  const progress = cameraShake.time / cameraShake.duration;
  const envelope = (1 - progress) * cameraShake.strength;
  const shakeX = Math.sin(elapsed * 85) * envelope;
  const shakeY = Math.cos(elapsed * 110) * envelope * 0.6;
  const shakeZ = Math.sin(elapsed * 72) * envelope * 0.35;
  cameraShake.offset.set(shakeX, shakeY, shakeZ);
  camera.position.add(cameraShake.offset);
}

function updateHud() {
  if (!appState) {
    return;
  }
  const remaining = appState.remainingBuildings;
  phaseLabel.textContent = appState.phase === "active" ? "Round Live" : "Cooldown";
  phaseCopy.textContent = appState.phase === "active"
    ? "Click vessels in the Strait of Hormuz to call in a strike."
    : "The strait is clear. New traffic enters when the cooldown ends.";
  roundLabel.textContent = `Round ${appState.roundId}`;
  destructionLabel.textContent = `${appState.destroyedCount} / ${appState.totalBuildings}`;
  remainingLabel.textContent = `${remaining} vessel${remaining === 1 ? "" : "s"} left`;
  overlay.classList.toggle("visible", appState.phase === "cooldown");
  overlayCopy.textContent = appState.phase === "cooldown" ? `New traffic in ${formatMs(appState.cooldownEndsAt - Date.now())}.` : "";
  leaderboardEl.innerHTML = "";
  const entries = appState.leaderboard.length ? appState.leaderboard : [{ name: "No strikes yet", strikes: 0 }];
  entries.forEach((entry) => {
    const item = document.createElement("li");
    item.textContent = `${entry.name} • ${entry.strikes}`;
    leaderboardEl.appendChild(item);
  });
}

function updateTimer() {
  if (!appState) {
    timerLabel.textContent = "--:--";
    return;
  }
  if (appState.phase === "cooldown") {
    const remaining = Math.max(0, appState.cooldownEndsAt - Date.now());
    timerLabel.textContent = formatMs(remaining);
    overlayCopy.textContent = `New traffic in ${formatMs(remaining)}.`;
    return;
  }
  timerLabel.textContent = "LIVE";
}

async function postJson(url, payload) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error || "Request failed");
  }
  return data;
}

async function syncIdentity() {
  localStorage.setItem("mm2-player-name", playerNameInput.value.trim());
  try {
    await postJson("/api/register", { playerId, playerName: playerNameInput.value.trim() });
  } catch {
    connectionLabel.textContent = "Identity unsynced";
  }
}

function syncSceneState(nextState) {
  const isNewRound = !appState || appState.roundId !== nextState.roundId;
  appState = nextState;
  if (isNewRound) {
    rebuildCity(nextState);
    previousDestroyed = new Map();
    seenStrikeIds.clear();
    activeStrikeBuildings.clear();
  }
  const pendingIds = new Set(activeStrikeBuildings.values());
  nextState.buildings.forEach((serverBuilding) => {
    const group = buildingMap.get(serverBuilding.id);
    const wasDestroyed = previousDestroyed.get(serverBuilding.id);
    previousDestroyed.set(serverBuilding.id, serverBuilding.destroyedAt);
    if (!group) {
      return;
    }
    group.userData.pendingStrike = pendingIds.has(serverBuilding.id);
    group.userData.destroyedAt = serverBuilding.destroyedAt;
    if (serverBuilding.destroyedAt && !wasDestroyed) {
      if (!hasActiveStrikeVisualForGroup(group)) {
        group.userData.exploded = true;
        group.visible = false;
      } else {
        group.userData.exploded = false;
      }
    } else if (!serverBuilding.destroyedAt) {
      group.userData.exploded = false;
      group.visible = true;
    }
  });
  updateHud();
  updateTimer();
}

async function loadState() {
  const response = await fetch("/api/state", { cache: "no-store" });
  const state = await response.json();
  syncSceneState(state);
}

function connectEvents() {
  const events = new EventSource("/api/events");
  connectionLabel.textContent = "Live";
  ["snapshot", "round_reset", "leaderboard"].forEach((eventName) => {
    events.addEventListener(eventName, (event) => {
      connectionLabel.textContent = "Live";
      syncSceneState(JSON.parse(event.data));
    });
  });
  events.addEventListener("strike_started", (event) => {
    connectionLabel.textContent = "Live";
    handleStrikeStarted(JSON.parse(event.data));
  });
  events.addEventListener("strike_resolved", (event) => {
    connectionLabel.textContent = "Live";
    handleStrikeResolved(JSON.parse(event.data));
  });
  events.onerror = () => {
    connectionLabel.textContent = "Reconnecting";
  };
}

function pickBuilding(event) {
  if (!appState || appState.phase !== "active") {
    return;
  }
  const rect = renderer.domElement.getBoundingClientRect();
  pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
  raycaster.setFromCamera(pointer, camera);
  const hits = raycaster.intersectObjects(buildings, true);
  if (!hits.length) {
    return;
  }
  const group = hits
    .map((hit) => resolveBuildingGroup(hit.object))
    .find((candidate) => candidate && candidate.userData && candidate.userData.isBuilding && !candidate.userData.exploded && !candidate.userData.pendingStrike);
  if (!group || !group.userData || !group.userData.isBuilding || group.userData.exploded || group.userData.pendingStrike) {
    return;
  }
  postJson("/api/strike", {
    buildingId: group.userData.id,
    playerId,
    playerName: playerNameInput.value.trim()
  }).then(syncSceneState).catch((error) => {
    phaseCopy.textContent = error.message;
    setTimeout(updateHud, 1600);
  });
}

function updatePointerCursor(event) {
  const rect = renderer.domElement.getBoundingClientRect();
  pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
  raycaster.setFromCamera(pointer, camera);
  const hits = raycaster.intersectObjects(buildings, true);
  const group = hits
    .map((hit) => resolveBuildingGroup(hit.object))
    .find((candidate) => candidate && candidate.userData && candidate.userData.isBuilding && !candidate.userData.exploded && !candidate.userData.pendingStrike);
  renderer.domElement.style.cursor = group && appState && appState.phase === "active" && !group.userData.exploded && !group.userData.pendingStrike ? "pointer" : "crosshair";
}

function resize() {
  const width = stage.clientWidth;
  const height = stage.clientHeight;
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
  renderer.setSize(width, height);
  if (composer) {
    composer.setSize(width, height);
  }
}

function animate() {
  requestAnimationFrame(animate);
  const delta = clock.getDelta();
  const elapsed = clock.elapsedTime;
  updateMissiles(delta);
  updateAirplanes(delta);
  updateTraffic(elapsed * 0.12);
  updateBoatDrift(delta, elapsed);
  updateExplosions(delta);
  root.rotation.y = Math.sin(elapsed * 0.12) * 0.015;
  controls.update();
  applyCameraShake(delta, elapsed);
  if (composer) {
    composer.render();
  } else {
    renderer.render(scene, camera);
  }
}

addSky();
loadState().then(connectEvents).then(syncIdentity);
playerNameInput.addEventListener("change", syncIdentity);
playerNameInput.addEventListener("blur", syncIdentity);
renderer.domElement.addEventListener("click", pickBuilding);
renderer.domElement.addEventListener("pointermove", updatePointerCursor);
window.addEventListener("resize", resize);
setInterval(updateTimer, 250);
animate();
