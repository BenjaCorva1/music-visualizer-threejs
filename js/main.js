import * as THREE from "three";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { AnaglyphEffect } from "three/addons/effects/AnaglyphEffect.js";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

/* =========================================================
   Proyecto de aprendizaje: Music Visualizer con Three.js
   Interfaz estilo Windows Media Player clásico.
   Cuatro modos de visualización seleccionables, inspirados en
   ejemplos oficiales de threejs.org (anaglyph, terrain, helpers).
   ========================================================= */

// ---------- Referencias al DOM ----------
const audio = document.getElementById("audio-player");
const canvas = document.getElementById("viz-canvas");
const fileInput = document.getElementById("file-input");
const btnOpen = document.getElementById("btn-open");
const btnPlay = document.getElementById("btn-play");
const btnStop = document.getElementById("btn-stop");
const btnPrev = document.getElementById("btn-prev");
const btnNext = document.getElementById("btn-next");
const seekBar = document.getElementById("seek-bar");
const volumeBar = document.getElementById("volume-bar");
const timeCurrent = document.getElementById("time-current");
const timeDuration = document.getElementById("time-duration");
const trackTitle = document.getElementById("track-title");
const statusText = document.getElementById("status-text");
const playlistEl = document.getElementById("playlist");
const effectsListEl = document.getElementById("effects-list");
const vizModeLabel = document.getElementById("viz-mode-label");
const dropHint = document.getElementById("drop-hint");
const visualizerArea = document.querySelector(".visualizer-area");
const tabButtons = document.querySelectorAll(".tab-btn");
const wmpWindow = document.querySelector(".wmp-window");
const btnMaximize = document.getElementById("btn-maximize");
const btnExitImmersive = document.getElementById("btn-exit-immersive");

// ---------- Estado del reproductor ----------
const playlist = []; // { name, url }
let currentIndex = -1;
let isPlaying = false;

// ---------- Web Audio API ----------
let audioCtx = null;
let analyser = null;
let sourceNode = null;
let freqData = null;

function ensureAudioGraph() {
  if (audioCtx) return;
  audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  analyser = audioCtx.createAnalyser();
  analyser.fftSize = 256;
  analyser.smoothingTimeConstant = 0.82;
  freqData = new Uint8Array(analyser.frequencyBinCount);

  sourceNode = audioCtx.createMediaElementSource(audio);
  sourceNode.connect(analyser);
  analyser.connect(audioCtx.destination);
}

// ---------- Renderer, cámara compartida y postprocesado ----------
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.15;
renderer.outputColorSpace = THREE.SRGBColorSpace;

const camera = new THREE.PerspectiveCamera(55, 1, 0.1, 200);

// Bloom da el brillo neón a los modos "normales". El modo anáglifo
// no pasa por el composer: AnaglyphEffect necesita controlar el
// render (ojo izquierdo/derecho) directamente sobre el renderer.
const composer = new EffectComposer(renderer);
const renderPass = new RenderPass(new THREE.Scene(), camera);
const bloomPass = new UnrealBloomPass(new THREE.Vector2(1, 1), 1.1, 0.5, 0.2);
composer.addPass(renderPass);
composer.addPass(bloomPass);
composer.addPass(new OutputPass());

const anaglyphEffect = new AnaglyphEffect(renderer);

// Controles con mouse (arrastrar = orbitar, rueda = zoom) y touch
// (un dedo = orbitar, pellizcar = zoom). Cada modo ya no mueve la
// cámara a mano frame a frame; en reposo, autoRotate le da vida.
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.07;
controls.enablePan = false;
controls.minDistance = 3;
controls.maxDistance = 55;
controls.autoRotate = true;
controls.autoRotateSpeed = 0.6;

let resumeAutoRotateTimer = null;
controls.addEventListener("start", () => {
  controls.autoRotate = false;
  clearTimeout(resumeAutoRotateTimer);
});
controls.addEventListener("end", () => {
  clearTimeout(resumeAutoRotateTimer);
  resumeAutoRotateTimer = setTimeout(() => {
    controls.autoRotate = true;
  }, 4000);
});

const clock = new THREE.Clock();

// ---------- Utilidades compartidas ----------
function computeAudioLevels() {
  if (!analyser || !isPlaying) return { avg: 0, bass: 0 };
  analyser.getByteFrequencyData(freqData);
  let sum = 0;
  for (let i = 0; i < freqData.length; i++) sum += freqData[i];
  let bassSum = 0;
  const bassBins = 8;
  for (let i = 0; i < bassBins; i++) bassSum += freqData[i];
  return {
    avg: sum / freqData.length / 255,
    bass: bassSum / bassBins / 255,
  };
}

function sampleGradient(stops, t) {
  t = THREE.MathUtils.clamp(t, 0, 1);
  for (let i = 0; i < stops.length - 1; i++) {
    const a = stops[i];
    const b = stops[i + 1];
    if (t >= a.t && t <= b.t) {
      const localT = (t - a.t) / (b.t - a.t || 1);
      return a.c.clone().lerp(b.c, localT);
    }
  }
  return stops[stops.length - 1].c.clone();
}

/* =========================================================
   MODO 1 — Espectro circular
   Barras dispuestas en círculo + esfera central, con bloom.
   ========================================================= */
function createCircularMode() {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x00000a);

  scene.add(new THREE.AmbientLight(0x223344, 1.2));
  const pointLight = new THREE.PointLight(0x66aaff, 120, 60);
  pointLight.position.set(0, 8, 6);
  scene.add(pointLight);

  const BAR_COUNT = 64;
  const bars = [];
  const barGroup = new THREE.Group();
  const radius = 5;

  for (let i = 0; i < BAR_COUNT; i++) {
    const geometry = new THREE.BoxGeometry(0.28, 1, 0.28);
    const material = new THREE.MeshStandardMaterial({
      color: new THREE.Color().setHSL(i / BAR_COUNT, 0.75, 0.55),
      emissive: new THREE.Color().setHSL(i / BAR_COUNT, 0.85, 0.22),
      metalness: 0.3,
      roughness: 0.4,
    });
    const bar = new THREE.Mesh(geometry, material);
    const angle = (i / BAR_COUNT) * Math.PI * 2;
    bar.position.set(Math.cos(angle) * radius, 0, Math.sin(angle) * radius);
    bar.lookAt(0, 0, 0);
    barGroup.add(bar);
    bars.push(bar);
  }
  scene.add(barGroup);

  const sphereGeo = new THREE.IcosahedronGeometry(1.6, 2);
  const sphereMat = new THREE.MeshStandardMaterial({
    color: 0x2266ff,
    emissive: 0x0a1a55,
    metalness: 0.5,
    roughness: 0.25,
    wireframe: true,
  });
  const sphere = new THREE.Mesh(sphereGeo, sphereMat);
  scene.add(sphere);

  const grid = new THREE.GridHelper(30, 30, 0x114477, 0x0a1f3a);
  grid.position.y = -3;
  scene.add(grid);

  function update(dt, t, freqData, avg, bass) {
    if (freqData && isPlaying) {
      for (let i = 0; i < BAR_COUNT; i++) {
        const value = freqData[i] ?? 0;
        const scaleY = 1 + (value / 255) * 8;
        bars[i].scale.y = THREE.MathUtils.lerp(bars[i].scale.y, scaleY, 0.35);
        bars[i].position.y = (bars[i].scale.y - 1) * 0.5 - 1;
      }
      sphere.scale.setScalar(1 + avg * 0.8);
      pointLight.intensity = 90 + avg * 260;
    } else {
      sphere.scale.setScalar(1 + Math.sin(t * 1.5) * 0.03);
    }
    sphere.rotation.y += 0.004;
    sphere.rotation.x += 0.0015;
    barGroup.rotation.y += 0.0015;
  }

  return {
    key: "circular",
    label: "Espectro circular",
    desc: "Barras 3D con brillo (bloom)",
    scene,
    cameraHome: new THREE.Vector3(0, 4, 14),
    lookAt: new THREE.Vector3(0, 0, 0),
    update,
  };
}

/* =========================================================
   MODO 2 — Terreno de ondas
   Inspirado en webgl_geometry_terrain_raycast.html: una malla
   de terreno, pero desplazada en vivo con las frecuencias en
   vez de con ruido, generando un paisaje que se desplaza hacia
   la cámara (estilo osciloscopio 3D).
   ========================================================= */
function createTerrainMode() {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x000014);
  scene.fog = new THREE.FogExp2(0x000014, 0.032);

  scene.add(new THREE.HemisphereLight(0x8899ff, 0x000011, 1.4));
  const dirLight = new THREE.DirectionalLight(0xffffff, 1.2);
  dirLight.position.set(5, 12, 8);
  scene.add(dirLight);

  const COLS = 64;
  const ROWS = 48;
  const WIDTH = 34;
  const DEPTH = 42;
  const HEIGHT_SCALE = 7;

  const geometry = new THREE.PlaneGeometry(WIDTH, DEPTH, COLS - 1, ROWS - 1);
  geometry.rotateX(-Math.PI / 2);
  geometry.setAttribute("color", new THREE.BufferAttribute(new Float32Array(ROWS * COLS * 3), 3));

  const material = new THREE.MeshStandardMaterial({
    vertexColors: true,
    flatShading: true,
    roughness: 0.55,
    metalness: 0.15,
    side: THREE.DoubleSide,
  });
  const terrain = new THREE.Mesh(geometry, material);
  scene.add(terrain);

  // Historial de alturas: fila 0 = más nueva (cerca de cámara).
  // Cada frame se desplaza todo una fila y se inserta la nueva al frente,
  // en el mismo orden row-major (iy*COLS+ix) que genera PlaneGeometry.
  const heights = new Float32Array(ROWS * COLS);

  const colorStops = [
    { t: 0, c: new THREE.Color(0x0a1a4a) },
    { t: 0.35, c: new THREE.Color(0x0f6fd0) },
    { t: 0.65, c: new THREE.Color(0x22e0ff) },
    { t: 0.85, c: new THREE.Color(0xff3ec8) },
    { t: 1, c: new THREE.Color(0xffffff) },
  ];

  const posAttr = geometry.attributes.position;
  const colorAttr = geometry.attributes.color;

  function shiftRows() {
    for (let iy = ROWS - 1; iy > 0; iy--) {
      const dst = iy * COLS;
      const src = (iy - 1) * COLS;
      for (let ix = 0; ix < COLS; ix++) heights[dst + ix] = heights[src + ix];
    }
  }

  function writeNewRow(freqData, playing, t) {
    for (let ix = 0; ix < COLS; ix++) {
      let value = 0;
      if (playing && freqData) {
        const bin = 2 + Math.floor((ix / COLS) * (freqData.length * 0.7));
        value = (freqData[bin] ?? 0) / 255;
      } else {
        value = 0.04 + 0.03 * Math.sin(t * 1.2 + ix * 0.4);
      }
      heights[ix] = Math.pow(value, 1.4) * HEIGHT_SCALE;
    }
  }

  function applyHeightsToGeometry() {
    for (let i = 0; i < ROWS * COLS; i++) {
      const h = heights[i];
      posAttr.setY(i, h);
      const c = sampleGradient(colorStops, h / HEIGHT_SCALE);
      colorAttr.setXYZ(i, c.r, c.g, c.b);
    }
    posAttr.needsUpdate = true;
    colorAttr.needsUpdate = true;
    geometry.computeVertexNormals();
  }

  let rowTimer = 0;

  function update(dt, t, freqData, avg, bass, playing) {
    rowTimer += dt;
    // Avanza el "scroll" del terreno a un ritmo fijo, independiente del framerate.
    if (rowTimer > 0.05) {
      rowTimer = 0;
      shiftRows();
      writeNewRow(freqData, playing, t);
      applyHeightsToGeometry();
    }
  }

  return {
    key: "terrain",
    label: "Terreno de ondas",
    desc: "Paisaje que se desplaza con la música",
    scene,
    cameraHome: new THREE.Vector3(0, 9, 20),
    lookAt: new THREE.Vector3(0, -1, -10),
    update,
  };
}

/* =========================================================
   MODO 4 — Radar de helpers
   Inspirado en webgl_helpers.html: combina varios helpers de
   three.js (ArrowHelper, PolarGridHelper, AxesHelper,
   PointLightHelper, CameraHelper) reaccionando al audio.
   ========================================================= */
function createHelpersMode() {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x020208);

  const polarGrid = new THREE.PolarGridHelper(8, 16, 8, 64, 0x225577, 0x113355);
  scene.add(polarGrid);

  const axes = new THREE.AxesHelper(6);
  scene.add(axes);

  const ARROW_COUNT = 48;
  const arrows = [];
  for (let i = 0; i < ARROW_COUNT; i++) {
    const angle = (i / ARROW_COUNT) * Math.PI * 2;
    const dir = new THREE.Vector3(Math.cos(angle), 0, Math.sin(angle)).normalize();
    const origin = dir.clone().multiplyScalar(2.2);
    const color = new THREE.Color().setHSL(i / ARROW_COUNT, 0.85, 0.6);
    const arrow = new THREE.ArrowHelper(dir, origin, 1, color.getHex(), 0.35, 0.18);
    scene.add(arrow);
    arrows.push(arrow);
  }

  const coreGeo = new THREE.IcosahedronGeometry(1.1, 1);
  const coreMat = new THREE.MeshStandardMaterial({
    color: 0x88aaff,
    emissive: 0x102050,
    wireframe: true,
    metalness: 0.4,
    roughness: 0.3,
  });
  const core = new THREE.Mesh(coreGeo, coreMat);
  scene.add(core);
  scene.add(new THREE.AmbientLight(0x334466, 1.5));

  const light1 = new THREE.PointLight(0x3388ff, 60, 40);
  light1.position.set(6, 4, 0);
  const light1Helper = new THREE.PointLightHelper(light1, 0.4);
  scene.add(light1, light1Helper);

  const light2 = new THREE.PointLight(0xff3388, 60, 40);
  light2.position.set(-6, 4, 0);
  const light2Helper = new THREE.PointLightHelper(light2, 0.4);
  scene.add(light2, light2Helper);

  const dummyCam = new THREE.PerspectiveCamera(45, 1, 1, 12);
  const camHelper = new THREE.CameraHelper(dummyCam);
  scene.add(dummyCam, camHelper);

  function update(dt, t, freqData, avg, bass, playing) {
    polarGrid.rotation.y += dt * 0.05;

    for (let i = 0; i < ARROW_COUNT; i++) {
      let value = 0.05;
      if (playing && freqData) {
        const bin = Math.floor((i / ARROW_COUNT) * (freqData.length * 0.85));
        value = (freqData[bin] ?? 0) / 255;
      } else {
        value = 0.08 + 0.05 * Math.sin(t * 2 + i * 0.3);
      }
      const len = 1 + value * 6;
      arrows[i].setLength(len, len * 0.25, len * 0.12);
    }

    const pulse = playing ? bass : 0.15 + Math.sin(t * 1.2) * 0.05;
    core.scale.setScalar(1 + pulse * 0.9);
    core.rotation.y += 0.006;
    light1.intensity = 40 + pulse * 260;
    light2.intensity = 40 + (playing ? avg : pulse) * 260;

    dummyCam.position.set(Math.cos(t * 0.15) * 9, 5, Math.sin(t * 0.15) * 9);
    dummyCam.lookAt(0, 0, 0);
    camHelper.update();
  }

  return {
    key: "helpers",
    label: "Radar de helpers",
    desc: "Flechas, luces y grillas de depuración",
    scene,
    cameraHome: new THREE.Vector3(0, 10, 16),
    lookAt: new THREE.Vector3(0, 0, 0),
    update,
  };
}

/* =========================================================
   MODO 5 — Planetas cósmicos (psicodélica)
   La psicodelia acá se arma en dos capas con lógicas separadas:
   - Fondo: un fractal (Julia set) animado por shader que corre y
     muta solo, con su propio patrón random — NO sigue al audio.
   - Centro: una figura estable (el "sol") cuyo color, escala y giro
     sí están atados a lo que suena, como ancla frente al caos de fondo.
   ========================================================= */
function createCosmicMode() {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x020208);

  // ---- Fondo fractal: Julia set en una esfera gigante que envuelve
  // toda la escena (BackSide, como un skybox). uTime la hace "correr"
  // (rotación + deriva del parámetro c) y uSeed salta a otra región del
  // fractal cada tanto — todo en un reloj propio, sin leer el audio.
  const fractalUniforms = {
    uTime: { value: 0 },
    uSeed: { value: new THREE.Vector2(-0.7, 0.27) },
  };
  const fractalMat = new THREE.ShaderMaterial({
    uniforms: fractalUniforms,
    side: THREE.BackSide,
    depthWrite: false,
    vertexShader: `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform float uTime;
      uniform vec2 uSeed;
      varying vec2 vUv;

      vec3 palette(float t) {
        vec3 a = vec3(0.5, 0.4, 0.6);
        vec3 b = vec3(0.5, 0.5, 0.5);
        vec3 c = vec3(1.0, 0.9, 0.7);
        vec3 d = vec3(0.3, 0.5, 0.8);
        return a + b * cos(6.28318 * (c * t + d));
      }

      void main() {
        vec2 uv = (vUv - 0.5) * 3.0;
        float angle = uTime * 0.03;
        mat2 rot = mat2(cos(angle), -sin(angle), sin(angle), cos(angle));
        uv = rot * uv;

        vec2 z = uv;
        vec2 c = uSeed + vec2(cos(uTime * 0.05), sin(uTime * 0.07)) * 0.15;

        float iter = 0.0;
        const float MAX_ITER = 48.0;
        for (float i = 0.0; i < MAX_ITER; i++) {
          z = vec2(z.x * z.x - z.y * z.y, 2.0 * z.x * z.y) + c;
          if (dot(z, z) > 4.0) break;
          iter++;
        }

        float t = iter / MAX_ITER;
        vec3 color = palette(t + uTime * 0.02) * smoothstep(0.0, 0.15, t);
        gl_FragColor = vec4(color * 0.85, 1.0);
      }
    `,
  });
  const fractalSky = new THREE.Mesh(new THREE.SphereGeometry(70, 48, 32), fractalMat);
  scene.add(fractalSky);
  let seedTarget = new THREE.Vector2(-0.7, 0.27);
  let nextSeedPick = 6;

  // El "sol" central: figura estable que ancla la mirada frente al
  // fondo random. Su color y movimiento sí están atados al audio.
  const coreGeo = new THREE.IcosahedronGeometry(1.1, 1);
  const coreMat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    emissive: 0x102050,
    wireframe: true,
    metalness: 0.4,
    roughness: 0.3,
  });
  const core = new THREE.Mesh(coreGeo, coreMat);
  scene.add(core);
  scene.add(new THREE.AmbientLight(0x334466, 1.5));
  let coreHue = 0;

  const light1 = new THREE.PointLight(0x3388ff, 60, 40);
  light1.position.set(6, 4, 0);
  scene.add(light1);

  const light2 = new THREE.PointLight(0xff3388, 60, 40);
  light2.position.set(-6, 4, 0);
  scene.add(light2);

  // ---- Campo de estrellas ----
  const STAR_COUNT = 900;
  const starPositions = new Float32Array(STAR_COUNT * 3);
  for (let i = 0; i < STAR_COUNT; i++) {
    const r = 20 + Math.random() * 35;
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.acos(THREE.MathUtils.randFloatSpread(2));
    starPositions[i * 3] = r * Math.sin(phi) * Math.cos(theta);
    starPositions[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta);
    starPositions[i * 3 + 2] = r * Math.cos(phi);
  }
  const starGeo = new THREE.BufferGeometry();
  starGeo.setAttribute("position", new THREE.BufferAttribute(starPositions, 3));
  const starMat = new THREE.PointsMaterial({
    color: 0xaad4ff,
    size: 0.12,
    sizeAttenuation: true,
    transparent: true,
    opacity: 0.85,
  });
  const stars = new THREE.Points(starGeo, starMat);
  scene.add(stars);

  // ---- Sistema planetario ----
  const PLANET_COUNT = 6;
  const planets = [];
  for (let i = 0; i < PLANET_COUNT; i++) {
    const group = new THREE.Group();
    const orbitRadius = 3.5 + i * 1.6;
    const size = 0.25 + Math.random() * 0.35;
    const hue = i / PLANET_COUNT;
    const color = new THREE.Color().setHSL(hue, 0.8, 0.6);

    const planetMat = new THREE.MeshStandardMaterial({
      color,
      emissive: color.clone().multiplyScalar(0.35),
      metalness: 0.3,
      roughness: 0.5,
    });
    const planet = new THREE.Mesh(new THREE.SphereGeometry(size, 20, 20), planetMat);
    group.add(planet);

    // Un par de "planetas" con anillo, estilo Saturno.
    if (i % 2 === 0) {
      const ringGeo = new THREE.RingGeometry(size * 1.6, size * 2.4, 48);
      const ringMat = new THREE.MeshBasicMaterial({
        color: color.clone().offsetHSL(0, 0, 0.2),
        side: THREE.DoubleSide,
        transparent: true,
        opacity: 0.6,
      });
      const ring = new THREE.Mesh(ringGeo, ringMat);
      ring.rotation.x = Math.PI / 2.3;
      planet.add(ring);
    }

    scene.add(group);
    planets.push({
      group,
      planet,
      orbitRadius,
      orbitSpeed: 0.15 + Math.random() * 0.25,
      phase: Math.random() * Math.PI * 2,
      bobSpeed: 0.6 + Math.random() * 0.8,
    });
  }

  // ---- Meteoros: cruzan toda la escena de punta a punta, dándole
  // movimiento constante a la experiencia (no solo cosas girando en el
  // lugar). Cuando salen del otro lado, renacen con una trayectoria nueva.
  function randomDirection() {
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.acos(THREE.MathUtils.randFloatSpread(2));
    return new THREE.Vector3(Math.sin(phi) * Math.cos(theta), Math.sin(phi) * Math.sin(theta), Math.cos(phi));
  }

  const METEOR_COUNT = 14;
  const METEOR_RADIUS = 28;
  const meteorGeo = new THREE.CylinderGeometry(0.025, 0.07, 1.6, 6);
  const meteors = [];

  function spawnMeteor(m) {
    const dir = randomDirection();
    const start = dir.clone().multiplyScalar(METEOR_RADIUS);
    const wobble = new THREE.Vector3(
      THREE.MathUtils.randFloatSpread(6),
      THREE.MathUtils.randFloatSpread(6),
      THREE.MathUtils.randFloatSpread(6)
    );
    const end = dir.clone().multiplyScalar(-METEOR_RADIUS).add(wobble);
    m.velocity.copy(end).sub(start).normalize();
    m.mesh.position.copy(start);
    m.mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), m.velocity);
    m.mesh.material.color.setHSL(Math.random(), 0.9, 0.7);
    m.traveled = 0;
  }

  for (let i = 0; i < METEOR_COUNT; i++) {
    const mat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.9,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const mesh = new THREE.Mesh(meteorGeo, mat);
    scene.add(mesh);
    const m = { mesh, velocity: new THREE.Vector3(), traveled: 0, speedFactor: 0.7 + Math.random() * 0.6 };
    spawnMeteor(m);
    // Adelantar cada uno una distancia al azar para que no crucen todos juntos.
    const headStart = Math.random() * METEOR_RADIUS * 2;
    m.mesh.position.addScaledVector(m.velocity, headStart);
    m.traveled = headStart;
    meteors.push(m);
  }

  function update(dt, t, freqData, avg, bass, playing) {
    // Fondo: corre en su propio reloj (uTime) y muta a un patrón nuevo
    // cada tanto (uSeed) — deliberadamente ajeno al audio.
    fractalUniforms.uTime.value = t;
    if (t > nextSeedPick) {
      seedTarget.set(THREE.MathUtils.randFloatSpread(1.6), THREE.MathUtils.randFloatSpread(1.6));
      nextSeedPick = t + 12 + Math.random() * 14;
    }
    fractalUniforms.uSeed.value.lerp(seedTarget, dt * 0.15);

    const pulse = playing ? bass : 0.15 + Math.sin(t * 1.2) * 0.05;
    const energy = playing ? avg : 0.1;

    // El centro sí sigue a la música: el hue avanza más rápido cuanto
    // más fuerte/grave suena, y casi se congela si no hay audio.
    coreHue = (coreHue + dt * (playing ? 0.05 + bass * 0.6 + avg * 0.3 : 0.004)) % 1;
    core.material.emissive.setHSL(coreHue, 0.9, 0.35 + pulse * 0.25);
    core.material.color.setHSL((coreHue + 0.5) % 1, 0.6, 0.6);

    core.scale.setScalar(1 + pulse * 0.9);
    core.rotation.y += 0.003 + energy * 0.02;
    light1.intensity = 40 + pulse * 260;
    light2.intensity = 40 + energy * 260;

    stars.rotation.y += dt * (0.01 + energy * 0.04);

    planets.forEach((p, i) => {
      const speed = p.orbitSpeed * (1 + energy * 1.5);
      const angle = t * speed + p.phase;
      const wobble = 1 + pulse * 0.5;
      p.group.position.set(
        Math.cos(angle) * p.orbitRadius * wobble,
        Math.sin(t * p.bobSpeed + p.phase) * 0.6,
        Math.sin(angle) * p.orbitRadius * wobble
      );
      p.planet.rotation.y += dt * 1.5;
      p.planet.scale.setScalar(1 + pulse * 0.6);
    });

    const meteorSpeed = 10 * (1 + energy * 1.8 + pulse * 0.6);
    meteors.forEach((m) => {
      const step = meteorSpeed * m.speedFactor * dt;
      m.mesh.position.addScaledVector(m.velocity, step);
      m.traveled += step;
      m.mesh.scale.y = 1 + pulse * 2;
      if (m.traveled > METEOR_RADIUS * 2 + 5) spawnMeteor(m);
    });
  }

  return {
    key: "cosmic",
    label: "Planetas cósmicos (psicodélica)",
    desc: "Fractal random de fondo + figura central reactiva al audio",
    scene,
    cameraHome: new THREE.Vector3(0, 8, 20),
    lookAt: new THREE.Vector3(0, 0, 0),
    update,
  };
}

/* =========================================================
   Registro de modos + modo 3 (Anáglifo), que reutiliza la
   escena del espectro circular pero cambia la técnica de
   render (par estéreo rojo/cian), como en
   webgl_effects_anaglyph.html.
   ========================================================= */
const circularMode = createCircularMode();
const terrainMode = createTerrainMode();
const helpersMode = createHelpersMode();
const cosmicMode = createCosmicMode();

const anaglyphMode = {
  key: "anaglyph",
  label: "Anáglifo 3D (rojo/cian)",
  desc: "Efecto estéreo — usá lentes 3D",
  scene: circularMode.scene,
  cameraHome: circularMode.cameraHome,
  lookAt: circularMode.lookAt,
  isAnaglyph: true,
  update: circularMode.update,
};

const modes = [cosmicMode, helpersMode, circularMode, terrainMode, anaglyphMode];
let activeMode = modes[0];

function setMode(key) {
  const mode = modes.find((m) => m.key === key);
  if (!mode) return;
  activeMode = mode;
  camera.position.copy(mode.cameraHome);
  camera.fov = 55;
  camera.updateProjectionMatrix();
  controls.target.copy(mode.lookAt);
  controls.update();
  vizModeLabel.textContent = `Visualización: ${mode.label}`;
  renderEffectsList();
}

function renderEffectsList() {
  effectsListEl.innerHTML = "";
  modes.forEach((mode) => {
    const li = document.createElement("li");
    li.className = mode.key === activeMode.key ? "active" : "";
    li.innerHTML = `<span class="fx-name">${mode.label}</span><span class="fx-desc">${mode.desc}</span>`;
    li.addEventListener("click", () => setMode(mode.key));
    effectsListEl.appendChild(li);
  });
}

// ---------- Pestañas del panel lateral ----------
tabButtons.forEach((btn) => {
  btn.addEventListener("click", () => {
    tabButtons.forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    const tab = btn.dataset.tab;
    playlistEl.classList.toggle("hidden", tab !== "playlist");
    effectsListEl.classList.toggle("hidden", tab !== "effects");
  });
});

// ---------- Resize responsivo ----------
function resizeRenderer() {
  const w = visualizerArea.clientWidth;
  const h = visualizerArea.clientHeight;
  renderer.setSize(w, h, false);
  composer.setSize(w, h);
  anaglyphEffect.setSize(w, h);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
window.addEventListener("resize", resizeRenderer);
resizeRenderer();
setMode("cosmic");

// ---------- Loop de animación ----------
function animate() {
  requestAnimationFrame(animate);
  const dt = Math.min(clock.getDelta(), 0.1);
  const t = clock.getElapsedTime();
  const { avg, bass } = computeAudioLevels();

  activeMode.update(dt, t, freqData, avg, bass, isPlaying);
  controls.update();

  if (activeMode.isAnaglyph) {
    anaglyphEffect.render(activeMode.scene, camera);
  } else {
    renderPass.scene = activeMode.scene;
    renderPass.camera = camera;
    composer.render();
  }
}
animate();

// =========================================================
// Lógica del reproductor (estilo Windows Media Player)
// =========================================================

function formatTime(seconds) {
  if (!isFinite(seconds) || seconds < 0) return "00:00";
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

// El "type" MIME que reporta el navegador es poco confiable en móviles
// (a veces llega vacío), así que también se acepta por extensión.
const AUDIO_EXTENSION_RE = /\.(mp3|wav|ogg|m4a|aac|flac|opus|wma|aiff?|caf)$/i;

function isAudioFile(file) {
  return (file.type && file.type.startsWith("audio/")) || AUDIO_EXTENSION_RE.test(file.name);
}

function addFilesToPlaylist(files) {
  const accepted = [];
  let rejectedCount = 0;

  Array.from(files).forEach((file) => {
    if (isAudioFile(file)) {
      accepted.push(file);
    } else {
      rejectedCount++;
    }
  });

  accepted.forEach((file) => {
    const url = URL.createObjectURL(file);
    playlist.push({ name: file.name, url });
  });

  renderPlaylist();
  if (currentIndex === -1 && playlist.length > 0) {
    loadTrack(0);
  }

  if (rejectedCount > 0) {
    statusText.textContent =
      accepted.length > 0
        ? `Se agregaron ${accepted.length} archivo(s). ${rejectedCount} no eran de audio.`
        : `Ningún archivo válido: elegí un MP3, WAV, M4A, OGG, AAC o FLAC.`;
  }
}

function renderPlaylist() {
  playlistEl.innerHTML = "";
  playlist.forEach((track, i) => {
    const li = document.createElement("li");
    li.textContent = track.name;
    if (i === currentIndex) li.classList.add("active");
    li.addEventListener("click", () => loadTrack(i, true));
    playlistEl.appendChild(li);
  });
}

function loadTrack(index, autoplay = false) {
  if (index < 0 || index >= playlist.length) return;
  currentIndex = index;
  const track = playlist[index];
  audio.src = track.url;
  trackTitle.textContent = track.name;
  dropHint.classList.add("hidden");
  renderPlaylist();
  statusText.textContent = `Cargado: ${track.name}`;
  if (autoplay) play();
}

function play() {
  ensureAudioGraph();
  if (audioCtx.state === "suspended") audioCtx.resume();
  if (!audio.src && playlist.length > 0) loadTrack(0);
  if (!audio.src) return;
  audio.play();
  isPlaying = true;
  btnPlay.textContent = "⏸";
  btnPlay.title = "Pausar";
  statusText.textContent = "Reproduciendo";
}

function pause() {
  audio.pause();
  isPlaying = false;
  btnPlay.textContent = "▶";
  btnPlay.title = "Reproducir";
  statusText.textContent = "Pausado";
}

function stop() {
  audio.pause();
  audio.currentTime = 0;
  isPlaying = false;
  btnPlay.textContent = "▶";
  btnPlay.title = "Reproducir";
  statusText.textContent = "Detenido";
}

function togglePlay() {
  if (isPlaying) pause();
  else play();
}

function playNext() {
  if (playlist.length === 0) return;
  const next = (currentIndex + 1) % playlist.length;
  loadTrack(next, true);
}

function playPrev() {
  if (playlist.length === 0) return;
  const prev = (currentIndex - 1 + playlist.length) % playlist.length;
  loadTrack(prev, true);
}

// ---------- Modo inmersivo: solo el efecto, a pantalla completa ----------
// El botón "expandir" oculta toda la interfaz del reproductor y deja
// únicamente la visualización. Cuando el navegador lo soporta, también
// pide pantalla completa real y trata de rotar a horizontal en celulares
// (Fullscreen API y Screen Orientation API son "best effort": si el
// navegador no las soporta o las deniega, el modo inmersivo por CSS
// funciona igual, solo que sin ocultar la barra del navegador).
async function enterImmersive() {
  wmpWindow.classList.add("immersive");
  try {
    await visualizerArea.requestFullscreen?.();
  } catch {
    // Sin fullscreen real (p. ej. iPhone Safari): el modo inmersivo por
    // CSS igual oculta la interfaz.
  }
  try {
    await screen.orientation?.lock?.("landscape");
  } catch {
    // El bloqueo de orientación solo funciona en algunos navegadores
    // Android y requiere estar en pantalla completa.
  }
  resizeRenderer();
}

function exitImmersive() {
  wmpWindow.classList.remove("immersive");
  if (document.fullscreenElement) document.exitFullscreen?.();
  try {
    screen.orientation?.unlock?.();
  } catch {
    // no-op
  }
  resizeRenderer();
}

btnMaximize.addEventListener("click", enterImmersive);
btnExitImmersive.addEventListener("click", exitImmersive);

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && wmpWindow.classList.contains("immersive")) exitImmersive();
});

// Si el usuario sale de pantalla completa con el gesto nativo del
// navegador (ESC, botón atrás en Android, etc.) en vez de nuestro botón,
// esto mantiene la interfaz sincronizada.
document.addEventListener("fullscreenchange", () => {
  if (!document.fullscreenElement && wmpWindow.classList.contains("immersive")) {
    exitImmersive();
  }
  resizeRenderer();
});

window.addEventListener("orientationchange", () => resizeRenderer());

// ---------- Eventos de UI ----------
btnOpen.addEventListener("click", () => fileInput.click());
fileInput.addEventListener("change", (e) => addFilesToPlaylist(e.target.files));

btnPlay.addEventListener("click", togglePlay);
btnStop.addEventListener("click", stop);
btnNext.addEventListener("click", playNext);
btnPrev.addEventListener("click", playPrev);

volumeBar.addEventListener("input", () => {
  audio.volume = volumeBar.value / 100;
});
audio.volume = volumeBar.value / 100;

seekBar.addEventListener("input", () => {
  if (audio.duration) {
    audio.currentTime = (seekBar.value / 100) * audio.duration;
  }
});

audio.addEventListener("timeupdate", () => {
  if (audio.duration) {
    seekBar.value = (audio.currentTime / audio.duration) * 100;
    timeCurrent.textContent = formatTime(audio.currentTime);
    timeDuration.textContent = formatTime(audio.duration);
  }
});

audio.addEventListener("ended", () => {
  playNext();
});

// ---------- Arrastrar y soltar archivos ----------
["dragenter", "dragover"].forEach((evt) =>
  visualizerArea.addEventListener(evt, (e) => {
    e.preventDefault();
    visualizerArea.style.outline = "2px dashed #3d95ff";
  })
);
["dragleave", "drop"].forEach((evt) =>
  visualizerArea.addEventListener(evt, (e) => {
    e.preventDefault();
    visualizerArea.style.outline = "none";
  })
);
visualizerArea.addEventListener("drop", (e) => {
  addFilesToPlaylist(e.dataTransfer.files);
});
