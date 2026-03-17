// Version: 1.0.4
import * as THREE from "https://esm.sh/three@0.164.1";
import { OrbitControls } from "https://esm.sh/three@0.164.1/examples/jsm/controls/OrbitControls.js";
import { EffectComposer } from "https://esm.sh/three@0.164.1/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "https://esm.sh/three@0.164.1/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "https://esm.sh/three@0.164.1/examples/jsm/postprocessing/UnrealBloomPass.js";

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
const APP_VERSION = "1.0.4";

if (appVersionEl) {
  appVersionEl.textContent = `Version ${APP_VERSION}`;
}

document.title = `Skyline MM v${APP_VERSION}`;

function createClientId() {
  if (window.crypto && typeof window.crypto.randomUUID === "function") {
    return `p-${window.crypto.randomUUID()}`;
  }
  return `p-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

const storedId = localStorage.getItem("mm-player-id");
const playerId = storedId || createClientId();
if (!storedId) {
  localStorage.setItem("mm-player-id", playerId);
}
playerNameInput.value = localStorage.getItem("mm-player-name") || "";

const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2(0x25142f, 0.011);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(stage.clientWidth, stage.clientHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.26;
stage.prepend(renderer.domElement);

const camera = new THREE.PerspectiveCamera(42, stage.clientWidth / stage.clientHeight, 0.1, 500);
camera.position.set(-22, 18, 34);

const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(4, 7, 0);
controls.enableDamping = true;
controls.minDistance = 18;
controls.maxDistance = 120;
controls.maxPolarAngle = Math.PI * 0.48;
controls.minPolarAngle = Math.PI * 0.18;

const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
composer.addPass(new UnrealBloomPass(new THREE.Vector2(stage.clientWidth, stage.clientHeight), 1.1, 0.9, 0.15));

const root = new THREE.Group();
scene.add(root);

const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
const buildings = [];
const buildingMap = new Map();
const explosions = [];
const missiles = [];
const trafficSystems = [];
const clock = new THREE.Clock();
let audioContext = null;

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

const hemi = new THREE.HemisphereLight(0xffc1d7, 0x120614, 1.34);
scene.add(hemi);

const keyLight = new THREE.DirectionalLight(0xffd6cc, 1.72);
keyLight.position.set(18, 28, 8);
scene.add(keyLight);

const fillLight = new THREE.PointLight(0xff78cb, 60, 150, 2);
fillLight.position.set(8, 16, -10);
scene.add(fillLight);

const cyanAccent = new THREE.PointLight(0x45fff1, 56, 130, 2);
cyanAccent.position.set(-18, 10, 8);
scene.add(cyanAccent);

const magentaAccent = new THREE.PointLight(0xff5cb7, 44, 110, 2);
magentaAccent.position.set(20, 8, 16);
scene.add(magentaAccent);

const sunsetGlow = new THREE.PointLight(0xffb08f, 72, 180, 2);
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
  ctx.fillStyle = "#131827";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

const groundTexture = makeGroundTexture();

function addSky() {
  const skyGeo = new THREE.SphereGeometry(220, 48, 32);
  const skyMat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    uniforms: {
      topColor: { value: new THREE.Color(0x262235) },
      bottomColor: { value: new THREE.Color(0x0d050b) },
      horizonColor: { value: new THREE.Color(0x8d5963) }
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
    [124, 54, 0xff93c7, 0.075, 4, 16, -44],
    [118, 46, 0x78fff2, 0.05, -2, 18, -42],
    [104, 30, 0xffb496, 0.055, 2, 12, -36]
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
      color: 0xff8fd3,
      transparent: true,
      opacity: 0.09
    })
  );
  glow.position.set(0, 20, -46);
  root.add(glow);
}

function addBase() {
  const base = new THREE.Mesh(
    new THREE.CylinderGeometry(32, 35, 3.6, 96),
    new THREE.MeshStandardMaterial({
      color: 0x09101b,
      metalness: 0.45,
      roughness: 0.55,
      emissive: 0x150b20,
      emissiveIntensity: 0.36
    })
  );
  base.position.y = -1.85;
  root.add(base);

  const topPlate = new THREE.Mesh(
    new THREE.CylinderGeometry(31.6, 31.9, 0.36, 96),
    new THREE.MeshStandardMaterial({ color: 0x0d1726, metalness: 0.2, roughness: 0.7 })
  );
  topPlate.position.y = -0.02;
  root.add(topPlate);

  const rim = new THREE.Mesh(
    new THREE.TorusGeometry(31.95, 0.22, 16, 140),
    new THREE.MeshStandardMaterial({
      color: 0xff65d9,
      emissive: 0x49dfff,
      emissiveIntensity: 0.95,
      metalness: 0.55,
      roughness: 0.28
    })
  );
  rim.rotation.x = Math.PI / 2;
  rim.position.y = 0.18;
  root.add(rim);
}

function addGroundGlow() {
  const ground = new THREE.Mesh(
    new THREE.CircleGeometry(28.8, 96),
    new THREE.MeshStandardMaterial({
      color: 0x182033,
      map: groundTexture,
      emissive: 0x271226,
      emissiveMap: groundTexture,
      emissiveIntensity: 0.22,
      metalness: 0.1,
      roughness: 0.88
    })
  );
  ground.rotation.x = -Math.PI / 2;
  root.add(ground);

  [
    [25.8, 0xffb582, 0.035, 0.01],
    [29.2, 0xb63cff, 0.07, 0.02],
    [24.5, 0x34e7ff, 0.04, 0.03]
  ].forEach(([radius, color, opacity, y]) => {
    const mesh = new THREE.Mesh(
      new THREE.CircleGeometry(radius, 96),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity })
    );
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.y = y;
    root.add(mesh);
  });
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
  const scale = 15;
  const half = 450 / scale;
  const majorPositions = [];

  for (let value = -420; value <= 420; value += 90) {
    majorPositions.push(value / scale);
  }

  majorPositions.forEach((x) => {
    const road = new THREE.Mesh(
      new THREE.BoxGeometry(1.28, 0.14, half * 2.05),
      new THREE.MeshStandardMaterial({ color: 0x2b1431, transparent: true, opacity: 0.96, metalness: 0.18, roughness: 0.45, emissive: 0xff7f7f, emissiveIntensity: 0.18 })
    );
    road.position.set(x, 0.16, 0);
    root.add(road);
    const line = new THREE.Mesh(
      new THREE.BoxGeometry(0.12, 0.03, half * 1.7),
      new THREE.MeshBasicMaterial({ color: 0xffaf74, transparent: true, opacity: 0.55 })
    );
    line.position.set(x, 0.25, 0);
    root.add(line);
  });

  majorPositions.forEach((z) => {
    const road = new THREE.Mesh(
      new THREE.BoxGeometry(half * 2.05, 0.14, 1.28),
      new THREE.MeshStandardMaterial({ color: 0x2b1431, transparent: true, opacity: 0.96, metalness: 0.18, roughness: 0.45, emissive: 0xff7f7f, emissiveIntensity: 0.18 })
    );
    road.position.set(0, 0.16, z);
    root.add(road);
    const line = new THREE.Mesh(
      new THREE.BoxGeometry(half * 1.7, 0.03, 0.12),
      new THREE.MeshBasicMaterial({ color: 0xffaf74, transparent: true, opacity: 0.55 })
    );
    line.position.set(0, 0.25, z);
    root.add(line);
  });

  majorPositions.slice(1, -1).forEach((x) => {
    const curve = new THREE.LineCurve3(new THREE.Vector3(x, 0, -half * 0.9), new THREE.Vector3(x, 0, half * 0.9));
    addTraffic(curve, { count: 46, color: 0xffae72, size: 0.16, speedMin: 0.032, speedMax: 0.075, laneOffset: 0.28, elevation: 0.24 });
    addTraffic(curve, { count: 40, color: 0xff6fc2, size: 0.14, speedMin: 0.028, speedMax: 0.068, laneOffset: -0.28, elevation: 0.24 });
  });
  majorPositions.slice(1, -1).forEach((z) => {
    const curve = new THREE.LineCurve3(new THREE.Vector3(-half * 0.9, 0, z), new THREE.Vector3(half * 0.9, 0, z));
    addTraffic(curve, { count: 46, color: 0xff8f63, size: 0.16, speedMin: 0.032, speedMax: 0.075, laneOffset: 0.28, elevation: 0.24 });
    addTraffic(curve, { count: 40, color: 0xffb97d, size: 0.14, speedMin: 0.028, speedMax: 0.068, laneOffset: -0.28, elevation: 0.24 });
  });
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

function addForegroundGlow() {
  const group = new THREE.Group();
  for (let index = 0; index < 26; index += 1) {
    const orb = new THREE.Mesh(
      new THREE.SphereGeometry(0.08 + Math.random() * 0.18, 12, 12),
      new THREE.MeshBasicMaterial({
        color: index % 3 === 0 ? 0xff67d4 : 0x58ebff,
        transparent: true,
        opacity: 0.85
      })
    );
    const angle = Math.random() * Math.PI * 2;
    const radius = 4 + Math.random() * 22;
    orb.position.set(Math.cos(angle) * radius, 0.3 + Math.random() * 0.6, Math.sin(angle) * radius * 0.65 + 2);
    group.add(orb);
  }
  root.add(group);
}

function addStreetLights() {
  const palette = [0x4dfff2, 0xff77d8, 0xffb36b, 0xa4ff55];
  for (let index = 0; index < 32; index += 1) {
    const group = new THREE.Group();
    const angle = index * 0.24 + 0.18;
    const radius = 8 + (index % 8) * 2.2;
    group.position.set(Math.cos(angle) * radius, 0, Math.sin(angle) * radius * 0.72 + 2);

    const color = palette[index % palette.length];
    const height = 0.75 + (index % 5) * 0.12;
    const pole = new THREE.Mesh(
      new THREE.CylinderGeometry(0.03, 0.05, height, 8),
      new THREE.MeshStandardMaterial({ color: 0x273042, emissive: 0x101620, emissiveIntensity: 0.2, metalness: 0.45, roughness: 0.42 })
    );
    pole.position.y = height * 0.5;
    group.add(pole);

    const head = new THREE.Mesh(
      new THREE.SphereGeometry(0.11, 10, 10),
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
  const w = Math.max(0.7, serverBuilding.width / scale);
  const d = Math.max(0.7, serverBuilding.depth / scale);
  const h = Math.max(0.9, serverBuilding.height / 14);
  const x = serverBuilding.x / scale;
  const z = serverBuilding.z / scale;
  const zonePalettes = {
    downtown: {
      colors: [0x22344b, 0x293c57, 0x1a3146, 0x274d58],
      emissive: [0x49fff2, 0xff62d6, 0xffb347]
    },
    midrise: {
      colors: [0x2d3850, 0x3a3c58, 0x31475a, 0x4a3651],
      emissive: [0xff62d6, 0x49fff2, 0xa4ff55]
    },
    residential: {
      colors: [0x403448, 0x4e3d4d, 0x3f4854, 0x4a443c],
      emissive: [0xffb347, 0xff62d6, 0x49fff2]
    },
    suburban: {
      colors: [0x4d3c46, 0x53453b, 0x424a4d, 0x564648],
      emissive: [0xffb347, 0x49fff2]
    }
  };
  const palette = zonePalettes[serverBuilding.zone] || zonePalettes.midrise;
  const textureIndex = hash % windowTextures.length;
  const material = new THREE.MeshStandardMaterial({
    color: palette.colors[hash % palette.colors.length],
    map: windowTextures[textureIndex],
    emissiveMap: windowTextures[textureIndex],
    emissive: palette.emissive[(hash >>> 3) % palette.emissive.length],
    emissiveIntensity: serverBuilding.zone === "downtown" ? 1.8 + rng() * 0.9 : 0.9 + rng() * 0.8,
    metalness: 0.18,
    roughness: 0.32
  });

  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
  mesh.position.y = h / 2;
  mesh.userData.buildingGroup = group;
  group.position.set(x, 0, z);
  group.add(mesh);

  if ((serverBuilding.zone === "downtown" || serverBuilding.zone === "midrise") && h > 4.5 && rng() > 0.32) {
    const cap = new THREE.Mesh(
      new THREE.BoxGeometry(w * 1.02, 0.12, d * 1.02),
      new THREE.MeshBasicMaterial({ color: 0xff8df0, transparent: true, opacity: 0.85 })
    );
    cap.position.y = h + 0.08;
    group.add(cap);
  }

  addNeonAccents(group, w, h, d, rng);
  addBuildingFeatures(group, w, h, d, rng);
  if ((serverBuilding.zone === "residential" || serverBuilding.zone === "suburban") && h < 3.2 && rng() > 0.28) {
    addLowRoof(group, w, h, d, rng);
  }

  const label = makeLabelSprite(shortBuildingCode(serverBuilding.id));
  label.position.set(0, h + 0.45, 0);
  label.userData.buildingGroup = group;
  group.add(label);

  group.userData = {
    id: serverBuilding.id,
    isBuilding: true,
    exploded: Boolean(serverBuilding.destroyedAt),
    pendingStrike: false,
    destroyedAt: serverBuilding.destroyedAt,
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

function hasActiveMissileForGroup(group) {
  return missiles.some((missile) => missile.group === group);
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
  launchMissile(
    strikeGroup,
    hashString(`${strikePayload.strike.buildingId}:${strikePayload.strike.resolvedAt}:${strikePayload.strike.outcome}`),
    strikePayload.strike.outcome,
    strikePayload.strike
  );
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
    if (!hasActiveMissileForGroup(strikeGroup)) {
      explodeBuilding(strikeGroup);
    }
  }
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
    ? "Click standing towers to call in a strike on the shared city."
    : "The city is down. A fresh skyline spawns when the cooldown ends.";
  roundLabel.textContent = `Round ${appState.roundId}`;
  destructionLabel.textContent = `${appState.destroyedCount} / ${appState.totalBuildings}`;
  remainingLabel.textContent = `${remaining} building${remaining === 1 ? "" : "s"} left`;
  overlay.classList.toggle("visible", appState.phase === "cooldown");
  overlayCopy.textContent = appState.phase === "cooldown" ? `Next city in ${formatMs(appState.cooldownEndsAt - Date.now())}.` : "";
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
    overlayCopy.textContent = `Next city in ${formatMs(remaining)}.`;
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
  localStorage.setItem("mm-player-name", playerNameInput.value.trim());
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
      if (!hasActiveMissileForGroup(group)) {
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
  composer.setSize(width, height);
}

function animate() {
  requestAnimationFrame(animate);
  const delta = clock.getDelta();
  const elapsed = clock.elapsedTime;
  updateMissiles(delta);
  updateTraffic(elapsed * 0.12);
  updateExplosions(delta);
  root.rotation.y = Math.sin(elapsed * 0.12) * 0.015;
  controls.update();
  applyCameraShake(delta, elapsed);
  composer.render();
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
