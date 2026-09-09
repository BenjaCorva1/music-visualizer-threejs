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
const DEFAULT_BLOOM = { strength: 1.1, radius: 0.5, threshold: 0.2 };
const bloomPass = new UnrealBloomPass(new THREE.Vector2(1, 1), DEFAULT_BLOOM.strength, DEFAULT_BLOOM.radius, DEFAULT_BLOOM.threshold);
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

      // Paleta con menos amplitud (0.3 en vez de 0.5): nunca llega a
      // blanco puro, así el fondo se mantiene apagado frente al centro.
      vec3 palette(float t) {
        vec3 a = vec3(0.35, 0.28, 0.4);
        vec3 b = vec3(0.3, 0.3, 0.3);
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
        bool escaped = false;
        const float MAX_ITER = 48.0;
        for (float i = 0.0; i < MAX_ITER; i++) {
          z = vec2(z.x * z.x - z.y * z.y, 2.0 * z.x * z.y) + c;
          if (dot(z, z) > 4.0) { escaped = true; break; }
          iter++;
        }

        // El interior del set (nunca escapa) queda directamente negro:
        // sin eso, esas zonas grandes salían a brillo pleno y tapaban
        // el centro. Solo el borde del fractal, donde está el detalle,
        // se colorea — y con un techo de brillo bajo (* 0.4).
        float t = iter / MAX_ITER;
        vec3 color = escaped ? palette(t + uTime * 0.02) * smoothstep(0.0, 0.55, t) : vec3(0.0);
        gl_FragColor = vec4(color * 0.4, 1.0);
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

  // ---- Barras de nivel: un anillo de barras verticales pegado al
  // centro, como un ecualizador, para que siempre haya algo marcando
  // el ritmo de la música (a diferencia del fondo, que no la sigue).
  const LEVEL_BAR_COUNT = 32;
  const levelBarRadius = 2.6;
  const levelBars = [];
  const levelBarGeo = new THREE.BoxGeometry(0.12, 1, 0.12);
  for (let i = 0; i < LEVEL_BAR_COUNT; i++) {
    const angle = (i / LEVEL_BAR_COUNT) * Math.PI * 2;
    const color = new THREE.Color().setHSL(i / LEVEL_BAR_COUNT, 0.55, 0.45);
    const mat = new THREE.MeshStandardMaterial({
      color,
      emissive: color.clone().multiplyScalar(0.4),
      metalness: 0.2,
      roughness: 0.6,
    });
    const bar = new THREE.Mesh(levelBarGeo, mat);
    bar.position.set(Math.cos(angle) * levelBarRadius, 0, Math.sin(angle) * levelBarRadius);
    scene.add(bar);
    levelBars.push(bar);
  }

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

    for (let i = 0; i < LEVEL_BAR_COUNT; i++) {
      let value = 0.05;
      if (playing && freqData) {
        const bin = Math.floor((i / LEVEL_BAR_COUNT) * (freqData.length * 0.85));
        value = (freqData[bin] ?? 0) / 255;
      } else {
        value = 0.08 + 0.05 * Math.sin(t * 2 + i * 0.3);
      }
      const scaleY = 0.6 + value * 5;
      const bar = levelBars[i];
      bar.scale.y = THREE.MathUtils.lerp(bar.scale.y, scaleY, 0.4);
      bar.position.y = (bar.scale.y - 1) * 0.5;
    }

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
   MODO 6 — Túnel de ojos (homenaje a Alex Grey)
   Los ojos son un motivo recurrente en su obra. Sin figura central:
   un campo de ojos nace cerca del centro y avanza hacia afuera, hacia
   el mandala de geometría sagrada que envuelve la escena (mismo
   shader que el fractal del modo cósmico, con su propio reloj,
   independiente del audio). Da una sensación de inmersión, de ir
   avanzando hacia el fondo que se va generando.
   ========================================================= */
function createSacredBodyMode() {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x05010a);

  // ---- Mandala de fondo: patrón radialmente simétrico (geometría
  // sagrada) sobre la misma esfera-cielo que el modo cósmico, con el
  // mismo criterio de brillo bajo para no competir con la figura.
  const mandalaUniforms = { uTime: { value: 0 } };
  const mandalaMat = new THREE.ShaderMaterial({
    uniforms: mandalaUniforms,
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
      varying vec2 vUv;

      vec3 palette(float t) {
        vec3 a = vec3(0.35, 0.25, 0.4);
        vec3 b = vec3(0.3, 0.3, 0.3);
        vec3 c = vec3(1.0, 0.8, 0.6);
        vec3 d = vec3(0.2, 0.4, 0.7);
        return a + b * cos(6.28318 * (c * t + d));
      }

      void main() {
        vec2 uv = vUv - 0.5;
        float r = length(uv) * 2.0;
        float a = atan(uv.y, uv.x);
        float seg = 6.28318 / 12.0;
        a = abs(mod(a, seg) - seg * 0.5);

        float pattern = sin(r * 14.0 - uTime * 0.4) * 0.5 + 0.5;
        pattern += sin(a * 20.0 + uTime * 0.2) * 0.5 + 0.5;
        pattern *= 0.5;
        pattern *= smoothstep(1.1, 0.15, r);

        vec3 color = palette(pattern + uTime * 0.015) * pattern;
        gl_FragColor = vec4(color * 0.35, 1.0);
      }
    `,
  });
  const mandalaSky = new THREE.Mesh(new THREE.SphereGeometry(70, 48, 32), mandalaMat);
  scene.add(mandalaSky);

  scene.add(new THREE.AmbientLight(0x332244, 1.2));

  // ---- Ojos avanzando hacia el fondo: un motivo recurrente en la obra
  // de Alex Grey. Nacen cerca del centro y viajan hacia afuera, hacia el
  // mandala que envuelve la escena; al llegar, renacen cerca del centro
  // de nuevo — dando la sensación de avanzar, de ir hacia el fondo.
  function eyeTexture() {
    const size = 128;
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d");
    ctx.save();
    ctx.beginPath();
    ctx.ellipse(size / 2, size / 2, size * 0.46, size * 0.28, 0, 0, Math.PI * 2);
    ctx.closePath();
    ctx.clip();
    ctx.fillStyle = "#f2edff";
    ctx.fillRect(0, 0, size, size);
    const iris = ctx.createRadialGradient(size / 2, size / 2, 2, size / 2, size / 2, size * 0.18);
    iris.addColorStop(0, "#caa6ff");
    iris.addColorStop(1, "#4a2680");
    ctx.fillStyle = iris;
    ctx.beginPath();
    ctx.arc(size / 2, size / 2, size * 0.17, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#0a0612";
    ctx.beginPath();
    ctx.arc(size / 2, size / 2, size * 0.07, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    ctx.strokeStyle = "#1a0f2e";
    ctx.lineWidth = size * 0.03;
    ctx.beginPath();
    ctx.ellipse(size / 2, size / 2, size * 0.46, size * 0.28, 0, 0, Math.PI * 2);
    ctx.stroke();
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    return texture;
  }

  const EYE_COUNT = 40;
  const EYE_MAX_RADIUS = 40;
  const eyeMap = eyeTexture();
  const eyes = [];

  function spawnEye(e) {
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.acos(THREE.MathUtils.randFloatSpread(2));
    e.dir.set(Math.sin(phi) * Math.cos(theta), Math.sin(phi) * Math.sin(theta), Math.cos(phi));
    e.radius = 0.3 + Math.random() * 1.2;
    e.sprite.position.copy(e.dir).multiplyScalar(e.radius);
  }

  for (let i = 0; i < EYE_COUNT; i++) {
    const mat = new THREE.SpriteMaterial({ map: eyeMap, transparent: true, depthWrite: false, opacity: 0 });
    const sprite = new THREE.Sprite(mat);
    const size = 0.6 + Math.random() * 0.5;
    sprite.scale.set(size * 1.6, size, 1);
    scene.add(sprite);
    const e = { sprite, dir: new THREE.Vector3(), radius: 0, speed: 3 + Math.random() * 2.4 };
    spawnEye(e);
    // Adelantar cada uno un tramo al azar para que no arranquen todos juntos.
    e.radius += Math.random() * EYE_MAX_RADIUS;
    e.sprite.position.copy(e.dir).multiplyScalar(e.radius);
    eyes.push(e);
  }

  function update(dt, t, freqData, avg, bass, playing) {
    mandalaUniforms.uTime.value = t;

    const energy = playing ? avg : 0.12;
    const eyeSpeed = 1 + energy * 2.2 + bass * 1.2;
    eyes.forEach((e) => {
      e.radius += e.speed * eyeSpeed * dt;
      if (e.radius > EYE_MAX_RADIUS) {
        spawnEye(e);
        return;
      }
      e.sprite.position.copy(e.dir).multiplyScalar(e.radius);
      const fadeIn = THREE.MathUtils.smoothstep(e.radius, 0.3, 3);
      const fadeOut = 1 - THREE.MathUtils.smoothstep(e.radius, EYE_MAX_RADIUS - 10, EYE_MAX_RADIUS);
      e.sprite.material.opacity = fadeIn * fadeOut * 0.9;
    });
  }

  return {
    key: "sacred",
    label: "Túnel de ojos (Alex Grey)",
    desc: "Ojos avanzando hacia el fondo, generado random",
    scene,
    cameraHome: new THREE.Vector3(0, 0.3, 12),
    lookAt: new THREE.Vector3(0, 0, 0),
    update,
  };
}

/* =========================================================
   MODO 7 — Túnel Sagrado
   Túnel infinito de anillos de geometría sagrada (no un plano frontal
   como la versión anterior): cada anillo tiene su propia fase de
   nacimiento, velocidad de rotación y ciclo de expansión, escalonados
   entre sí, y además se desplaza por el eje Z en loop (módulo, sin
   crear/destruir geometría) hacia una figura humana de baja poligonización
   en el punto de fuga. El color de cada anillo es un hash determinístico
   por índice + ciclo, no un degradado fijo.

   Nota de diseño: a diferencia de los otros modos con shader de fondo
   (cósmico, túnel de ojos, mandala plano), acá la figura 3D con
   profundidad real (item 6 del pedido) necesita geometría de verdad —
   un shader 2D de pantalla completa no puede dar paralaje/oclusión
   correcta entre la figura y los anillos. Por eso este modo usa mallas
   reales (RingGeometry + CapsuleGeometry) animadas desde JS en vez de
   uniforms de shader: uTime/uBass/uAvg/uCameraZ/uVariantSeed/uPhaseStep
   del pedido original existen igual, pero como variables JS (t, bass,
   avg suavizado, scrollZ, activeParams.seed, activeParams.phaseStep)
   en vez de uniforms de GLSL.
   ========================================================= */
function createMandalaMode() {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x02000a);

  scene.add(new THREE.AmbientLight(0x332244, 1.1));
  const tunnelLight = new THREE.PointLight(0xaa88ff, 18, 40);
  tunnelLight.position.set(0, 2, 4);
  scene.add(tunnelLight);

  // ---- Parámetros del túnel ----
  const RING_COUNT = 10;
  const Z_SPACING = 4.2;
  const NEAR_Z = 2.5;
  const TUNNEL_LENGTH = RING_COUNT * Z_SPACING;
  const FAR_Z = NEAR_Z - TUNNEL_LENGTH;

  // La figura recorre un tramo más largo que el de los anillos, para
  // que se la vea atravesarlos y perderse más allá del más lejano.
  const FIGURE_TRAVEL_LENGTH = TUNNEL_LENGTH + 10;
  const FIGURE_START_Z = NEAR_Z - 0.5;

  function frac(x) {
    return x - Math.floor(x);
  }
  // Hash determinístico (mismo criterio que las versiones anteriores):
  // la misma entrada da siempre el mismo resultado. Se lo alimenta con
  // índices y números de ciclo, nunca con tiempo continuo, para que el
  // color de un anillo no cambie frame a frame.
  function hash1(n) {
    return frac(Math.sin(n * 127.1) * 43758.5453123);
  }
  // Versión de mod() que, como en GLSL, siempre devuelve un resultado
  // no negativo — hace falta porque localTime también puede envolverse
  // y el % nativo de JS conserva el signo del dividendo.
  function mod(a, b) {
    return ((a % b) + b) % b;
  }

  // ---- Textura del anillo: dibuja "axes" muescas en un canvas. Cambiar
  // el orden geométrico de una variante solo redibuja esta textura, sin
  // tocar la geometría 3D del anillo.
  function makeRingTexture(axes) {
    const size = 256;
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d");
    const cx = size / 2;
    const cy = size / 2;
    const rOuter = size * 0.49;
    const rInner = size * 0.34;
    const segAngle = (Math.PI * 2) / axes;
    ctx.fillStyle = "#ffffff";
    for (let i = 0; i < axes; i++) {
      const a0 = i * segAngle + segAngle * 0.12;
      const a1 = i * segAngle + segAngle * 0.88;
      ctx.beginPath();
      ctx.arc(cx, cy, rOuter, a0, a1);
      ctx.arc(cx, cy, rInner, a1, a0, true);
      ctx.closePath();
      ctx.fill();
    }
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    return texture;
  }

  // ---- Variantes: cada una redefine semilla de color, separación de
  // fase, orden geométrico (muescas) y si se ve la figura humana.
  const mandalaVariants = [
    { seed: 0.0, phaseStep: 0.9, axes: 8, showFigure: true },
    { seed: 4.7, phaseStep: 0.6, axes: 6, showFigure: true },
    { seed: 9.3, phaseStep: 1.3, axes: 10, showFigure: false },
    { seed: 14.1, phaseStep: 0.75, axes: 7, showFigure: true },
  ];

  // ---- Anillos ----
  const ringGeo = new THREE.RingGeometry(0.72, 1, 48);
  let currentRingTexture = makeRingTexture(mandalaVariants[0].axes);
  const rings = [];
  for (let i = 0; i < RING_COUNT; i++) {
    const mat = new THREE.MeshBasicMaterial({
      map: currentRingTexture,
      color: 0xffffff,
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const mesh = new THREE.Mesh(ringGeo, mat);
    scene.add(mesh);
    rings.push({
      mesh,
      mat,
      index: i,
      baseZ: -i * Z_SPACING,
      rotSpeed: 0.4 * (0.7 + hash1(i) * 0.6) * (i % 2 === 0 ? 1 : -1),
    });
  }

  // ---- Figura humana (primitivas de baja poligonización, pose tipo
  // Vitruvio): es ella la que entra al túnel, viajando desde cerca de
  // la cámara hacia el fondo, atravesando los anillos. Wireframe +
  // additive para que el bloom la lea como silueta luminosa, no como
  // modelo realista.
  const figureGroup = new THREE.Group();
  figureGroup.position.set(0, 0, FIGURE_START_Z);
  scene.add(figureGroup);

  const figureMat = new THREE.MeshBasicMaterial({
    color: 0xcdb8ff,
    wireframe: true,
    transparent: true,
    opacity: 0,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });

  const head = new THREE.Mesh(new THREE.SphereGeometry(0.5, 16, 16), figureMat);
  head.position.y = 2.1;
  figureGroup.add(head);

  const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.45, 1.7, 4, 8), figureMat);
  torso.position.y = 0.9;
  figureGroup.add(torso);

  const armLength = 1.6;
  const armL = new THREE.Mesh(new THREE.CapsuleGeometry(0.16, armLength, 4, 8), figureMat);
  armL.rotation.z = Math.PI / 2;
  armL.position.set(-(armLength / 2 + 0.5), 1.5, 0);
  figureGroup.add(armL);
  const armR = armL.clone();
  armR.position.x *= -1;
  figureGroup.add(armR);

  const legLength = 1.8;
  const legL = new THREE.Mesh(new THREE.CapsuleGeometry(0.2, legLength, 4, 8), figureMat);
  legL.position.set(-0.35, -legLength / 2, 0);
  figureGroup.add(legL);
  const legR = legL.clone();
  legR.position.x *= -1;
  figureGroup.add(legR);

  // ---- Estado de transición entre variantes (crossfade, no corte
  // abrupto): cycleVariant() solo levanta una bandera; el cambio real
  // se procesa al principio de update(), que es el único lugar donde
  // es seguro leer el reloj (evita tocar el Clock compartido desde un
  // listener de click/teclado fuera del loop de animación).
  let variantIndex = 0;
  let fromParams = { ...mandalaVariants[0] };
  let toParams = { ...mandalaVariants[0] };
  let transitionProgress = 1;
  let pendingCycle = false;
  const TRANSITION_DURATION = 0.8;
  let lastBlend = {
    seed: mandalaVariants[0].seed,
    phaseStep: mandalaVariants[0].phaseStep,
    figureVisibility: mandalaVariants[0].showFigure ? 1 : 0,
  };

  function cycleVariant() {
    pendingCycle = true;
  }

  let smoothBass = 0;
  let smoothAvg = 0;
  let scrollZ = 0;
  let figureScrollZ = 0;
  const BASE_CYCLE_LENGTH = 3.0;
  const BASE_SCROLL_SPEED = 2.2;
  const FIGURE_BASE_SPEED = 1.6; // más lento que los anillos: entra caminando, no volando
  const tmpColor = new THREE.Color();

  function update(dt, t, freqData, avg, bass, playing) {
    if (pendingCycle) {
      pendingCycle = false;
      variantIndex = (variantIndex + 1) % mandalaVariants.length;
      // Arranca la transición desde donde esté el blend AHORA (no desde
      // la variante "asentada"): si se tapea rápido varias veces, sigue
      // de forma continua en vez de saltar.
      fromParams = {
        seed: lastBlend.seed,
        phaseStep: lastBlend.phaseStep,
        showFigure: lastBlend.figureVisibility > 0.5,
      };
      toParams = mandalaVariants[variantIndex];
      transitionProgress = 0;

      // El orden geométrico (muescas) cambia de golpe, como un giro de
      // caleidoscopio; lo que sí cruza suave es el color/timing/figura.
      const newTexture = makeRingTexture(toParams.axes);
      rings.forEach((ring) => {
        ring.mat.map = newTexture;
        ring.mat.needsUpdate = true;
      });
      currentRingTexture.dispose();
      currentRingTexture = newTexture;
    }

    let blendedSeed;
    let blendedPhaseStep;
    let figureVisibility;
    if (transitionProgress < 1) {
      transitionProgress = Math.min(transitionProgress + dt / TRANSITION_DURATION, 1);
      const b = THREE.MathUtils.smoothstep(transitionProgress, 0, 1);
      blendedSeed = THREE.MathUtils.lerp(fromParams.seed, toParams.seed, b);
      blendedPhaseStep = THREE.MathUtils.lerp(fromParams.phaseStep, toParams.phaseStep, b);
      figureVisibility = THREE.MathUtils.lerp(fromParams.showFigure ? 1 : 0, toParams.showFigure ? 1 : 0, b);
    } else {
      blendedSeed = toParams.seed;
      blendedPhaseStep = toParams.phaseStep;
      figureVisibility = toParams.showFigure ? 1 : 0;
    }
    lastBlend = { seed: blendedSeed, phaseStep: blendedPhaseStep, figureVisibility };

    const targetBass = playing ? bass : 0.1;
    const targetAvg = playing ? avg : 0.15;
    const smoothing = Math.min(dt * 2, 1);
    smoothBass += (targetBass - smoothBass) * smoothing;
    smoothAvg += (targetAvg - smoothAvg) * smoothing;

    // Más bass = anillos más próximos en el tiempo, ciclos más cortos y
    // avance más rápido por el túnel — todo dentro de un rango acotado
    // y a partir del bass ya suavizado (si no, uPhaseStep saltaría cada
    // frame y rompería el escalonamiento en vez de solo acelerarlo).
    const phaseStep = blendedPhaseStep * (1 - smoothBass * 0.3);
    const cycleLength = BASE_CYCLE_LENGTH * (1 - smoothBass * 0.25);
    const scrollSpeed = BASE_SCROLL_SPEED * (1 + smoothBass * 0.8);
    scrollZ += scrollSpeed * dt;

    rings.forEach((ring) => {
      const i = ring.index;

      // ---- ESCALONAMIENTO ----
      const phase_i = i * phaseStep;
      const localTime = Math.max(t - phase_i, 0);

      // ---- EXPANSIÓN RADIAL EN LOOP ----
      const cycleT = mod(localTime, cycleLength);
      const cycleIndex = Math.floor(localTime / cycleLength);
      const radius_i = THREE.MathUtils.lerp(0.5, 2.4, cycleT / cycleLength);

      const fadeIn = THREE.MathUtils.smoothstep(cycleT, 0, cycleLength * 0.18);
      const fadeOut = 1 - THREE.MathUtils.smoothstep(cycleT, cycleLength * 0.78, cycleLength);
      const appear = fadeIn * fadeOut;

      let level = 0.15;
      if (playing && freqData) {
        const bin = Math.floor((i / RING_COUNT) * (freqData.length * 0.9));
        level = (freqData[bin] ?? 0) / 255;
      } else {
        level = 0.12 + 0.05 * Math.sin(t * 1.3 + i);
      }

      // ---- AVANCE POR EL TÚNEL (loop infinito vía módulo) ----
      // ring.baseZ + scrollZ crece sin límite; el módulo lo envuelve
      // siempre dentro de [0, TUNNEL_LENGTH), y sumar FAR_Z lo reubica
      // en [FAR_Z, NEAR_Z) — el anillo avanza hacia la cámara y, al
      // llegar a NEAR_Z, reaparece en FAR_Z sin crear/destruir nada.
      const zRaw = mod(ring.baseZ + scrollZ, TUNNEL_LENGTH);
      ring.mesh.position.z = zRaw + FAR_Z;

      // Fade por posición (no por el ciclo de expansión): sin esto, el
      // "salto" del loop en el módulo de arriba se vería como un pop
      // brusco cada vez que un anillo reaparece atrás.
      const zFrac = zRaw / TUNNEL_LENGTH;
      const zFade = THREE.MathUtils.smoothstep(zFrac, 0, 0.08) * (1 - THREE.MathUtils.smoothstep(zFrac, 0.92, 1));

      // ---- COLOR ALEATORIO POR ANILLO Y POR CICLO ----
      const hue = frac(hash1(i * 3.1 + cycleIndex * 13.37 + blendedSeed * 0.37 + 0.5));
      tmpColor.setHSL(hue, 0.75, 0.5);
      ring.mat.color.copy(tmpColor).multiplyScalar(0.6 + level * 0.9);
      ring.mat.opacity = appear * zFade * (0.55 + level * 0.45);

      ring.mesh.rotation.z += dt * ring.rotSpeed;
      ring.mesh.scale.setScalar(radius_i);
    });

    // ---- La figura entra al túnel: viaja desde la entrada (cerca de
    // cámara) hacia el fondo, atravesando los anillos, y al llegar al
    // final vuelve a arrancar desde la entrada (mismo módulo que los
    // anillos, con fade en las puntas para que el reset no se note).
    const figureSpeed = FIGURE_BASE_SPEED * (1 + smoothBass * 0.6);
    figureScrollZ += figureSpeed * dt;
    const figureTravelRaw = mod(figureScrollZ, FIGURE_TRAVEL_LENGTH);
    figureGroup.position.z = FIGURE_START_Z - figureTravelRaw;

    const figureTravelFrac = figureTravelRaw / FIGURE_TRAVEL_LENGTH;
    const figureZFade =
      THREE.MathUtils.smoothstep(figureTravelFrac, 0, 0.06) *
      (1 - THREE.MathUtils.smoothstep(figureTravelFrac, 0.94, 1));

    const bassPulse = playing ? bass : 0.1 + Math.sin(t * 1.1) * 0.03;
    figureGroup.scale.setScalar(1 + bassPulse * 0.25);
    figureGroup.rotation.y += dt * 0.15;
    figureMat.opacity = figureVisibility * figureZFade * (0.55 + smoothAvg * 0.4);

    tunnelLight.intensity = 14 + smoothAvg * 90;
  }

  return {
    key: "mandala",
    label: "Túnel Sagrado",
    desc: "Anillos escalonados en un túnel infinito hacia una figura",
    scene,
    cameraHome: new THREE.Vector3(0, 1, 6),
    lookAt: new THREE.Vector3(0, 0, -14),
    update,
    cycleVariant,
    bloomOverride: { strength: 0.6, radius: 0.4, threshold: 0.32 },
  };
}

/* =========================================================
   MODO 8 — Ser Caleidoscópico
   Una persona (primitivas de baja poligonización) multiplicada por
   simetría de espejo: 8 copias de la misma figura, todas centradas en
   el mismo punto pero rotadas en abanico, vibrando con el audio —
   el efecto "caleidoscopio" acá se logra por duplicación/rotación de
   geometría, no por shader 2D. Alrededor suben tiras de energía
   fluida: curvas Catmull-Rom recalculadas en cada actualización (no
   franjas rectas como en otros modos) con una textura que fluye a lo
   largo de cada tira, para que se vean más orgánicas/realistas que un
   streak recto.
   ========================================================= */
function createKaleidoscopeMode() {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x04010a);

  scene.add(new THREE.AmbientLight(0x332244, 1.2));
  const light1 = new THREE.PointLight(0x66aaff, 20, 25);
  light1.position.set(3, 3, 3);
  scene.add(light1);
  const light2 = new THREE.PointLight(0xff66aa, 20, 25);
  light2.position.set(-3, 2, -3);
  scene.add(light2);

  // ---- Figura base (primitivas, pose Vitruvio) ----
  function buildHumanFigure(mat) {
    const group = new THREE.Group();
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.32, 14, 14), mat);
    head.position.y = 1.35;
    group.add(head);

    const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.28, 1.05, 4, 8), mat);
    torso.position.y = 0.55;
    group.add(torso);

    const armLength = 1.0;
    const armL = new THREE.Mesh(new THREE.CapsuleGeometry(0.1, armLength, 4, 8), mat);
    armL.rotation.z = Math.PI / 2;
    armL.position.set(-(armLength / 2 + 0.32), 0.95, 0);
    group.add(armL);
    const armR = armL.clone();
    armR.position.x *= -1;
    group.add(armR);

    const legLength = 1.1;
    const legL = new THREE.Mesh(new THREE.CapsuleGeometry(0.12, legLength, 4, 8), mat);
    legL.position.set(-0.2, -legLength / 2, 0);
    group.add(legL);
    const legR = legL.clone();
    legR.position.x *= -1;
    group.add(legR);

    return group;
  }

  const figureMat = new THREE.MeshBasicMaterial({
    color: 0xffffff,
    wireframe: true,
    transparent: true,
    opacity: 0.85,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });

  const KALEIDO_COPIES = 8;
  const kaleidoGroup = new THREE.Group();
  scene.add(kaleidoGroup);
  const figureCopies = [];
  for (let i = 0; i < KALEIDO_COPIES; i++) {
    const copy = buildHumanFigure(figureMat);
    copy.rotation.y = (i / KALEIDO_COPIES) * Math.PI * 2;
    kaleidoGroup.add(copy);
    figureCopies.push(copy);
  }

  // ---- Tiras de energía fluida ----
  // Textura con 3 pulsos de brillo que se repite a lo largo del tubo;
  // animar tex.offset.x da la sensación de energía corriendo por la
  // tira, sin tener que redibujar nada.
  function makeFlowTexture() {
    const w = 128;
    const h = 8;
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    for (let x = 0; x < w; x++) {
      const p = x / w;
      const b = Math.sin(p * Math.PI * 2 * 3) * 0.5 + 0.5;
      ctx.fillStyle = `rgba(255,255,255,${(0.12 + b * 0.88).toFixed(3)})`;
      ctx.fillRect(x, 0, 1, h);
    }
    const tex = new THREE.CanvasTexture(canvas);
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(3, 1);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }
  const baseFlowTexture = makeFlowTexture();

  const STRAND_COUNT = 6;
  const TUBE_SEGMENTS = 22;
  const RADIAL_SEGMENTS = 5;
  const STRAND_POINTS = 10;

  const strands = [];
  for (let i = 0; i < STRAND_COUNT; i++) {
    const hue = i / STRAND_COUNT;
    const tex = baseFlowTexture.clone();
    tex.needsUpdate = true;
    const mat = new THREE.MeshBasicMaterial({
      map: tex,
      color: new THREE.Color().setHSL(hue, 0.85, 0.6),
      transparent: true,
      opacity: 0.9,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const placeholderCurve = new THREE.CatmullRomCurve3([new THREE.Vector3(0, -1, 0), new THREE.Vector3(0, 1, 0)]);
    const mesh = new THREE.Mesh(new THREE.TubeGeometry(placeholderCurve, 8, 0.045, RADIAL_SEGMENTS, false), mat);
    scene.add(mesh);
    strands.push({
      mesh,
      mat,
      tex,
      hue,
      baseRadius: 1.6 + i * 0.35,
      turns: 1.4 + (i % 3) * 0.5,
      phase: (i / STRAND_COUNT) * Math.PI * 2,
      speed: 0.25 + (i % 4) * 0.08,
      flowSpeed: 0.6 + (i % 3) * 0.25,
    });
  }

  function updateStrandGeometry(strand, t, bass) {
    const points = [];
    for (let s = 0; s <= STRAND_POINTS; s++) {
      const u = s / STRAND_POINTS;
      const height = -1.3 + u * 6.4;
      const swirl = strand.phase + u * strand.turns * Math.PI * 2 + t * strand.speed;
      const wobble = Math.sin(t * 1.1 + u * 5 + strand.phase) * (0.35 + bass * 0.7);
      const radius = strand.baseRadius + wobble;
      points.push(new THREE.Vector3(Math.cos(swirl) * radius, height, Math.sin(swirl) * radius));
    }
    const curve = new THREE.CatmullRomCurve3(points);
    strand.mesh.geometry.dispose();
    strand.mesh.geometry = new THREE.TubeGeometry(curve, TUBE_SEGMENTS, 0.045, RADIAL_SEGMENTS, false);
  }

  let hue0 = 0;
  // Recalcular la curva de cada tira a ~30fps (no en cada frame de
  // render) alcanza para que se vea fluido y evita generar/descartar
  // geometría al doble de ritmo del necesario.
  let geomTimer = 0;

  function update(dt, t, freqData, avg, bass, playing) {
    const energy = playing ? avg : 0.12;
    const pulse = playing ? bass : 0.1 + Math.sin(t * 1.4) * 0.04;

    // ---- Figura caleidoscópica: vibra con el bajo ----
    hue0 = (hue0 + dt * (playing ? 0.05 + bass * 0.4 : 0.01)) % 1;
    figureMat.color.setHSL(hue0, 0.7, 0.65);
    kaleidoGroup.rotation.y += dt * (0.05 + energy * 0.1);
    figureCopies.forEach((copy, i) => {
      const jitter = Math.sin(t * 24 + i * 1.7) * pulse * 0.06;
      copy.position.y = jitter;
      copy.scale.setScalar(1 + pulse * 0.35 + Math.sin(t * 3 + i) * 0.03);
    });

    // ---- Tiras de energía ----
    geomTimer += dt;
    const shouldUpdateGeometry = geomTimer > 0.033;
    if (shouldUpdateGeometry) geomTimer = 0;

    strands.forEach((strand, i) => {
      if (shouldUpdateGeometry) updateStrandGeometry(strand, t, pulse);
      strand.tex.offset.x -= dt * strand.flowSpeed * (1 + energy * 1.5);

      let level = 0.2;
      if (playing && freqData) {
        const bin = Math.floor((i / STRAND_COUNT) * (freqData.length * 0.85));
        level = (freqData[bin] ?? 0) / 255;
      } else {
        level = 0.15 + 0.05 * Math.sin(t * 1.6 + i);
      }
      strand.mat.opacity = 0.5 + level * 0.5;
      strand.mat.color.setHSL((strand.hue + hue0 * 0.15) % 1, 0.85, 0.55 + level * 0.15);
    });

    light1.intensity = 15 + pulse * 120;
    light2.intensity = 15 + energy * 120;
  }

  return {
    key: "kaleido",
    label: "Ser Caleidoscópico",
    desc: "Energías fluidas + figura caleidoscópica vibrando en el centro",
    scene,
    cameraHome: new THREE.Vector3(0, 2, 9),
    lookAt: new THREE.Vector3(0, 1, 0),
    update,
    bloomOverride: { strength: 0.75, radius: 0.45, threshold: 0.25 },
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
const sacredBodyMode = createSacredBodyMode();
const mandalaMode = createMandalaMode();
const kaleidoscopeMode = createKaleidoscopeMode();

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

const modes = [
  cosmicMode,
  sacredBodyMode,
  mandalaMode,
  kaleidoscopeMode,
  helpersMode,
  circularMode,
  terrainMode,
  anaglyphMode,
];
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
  // Cada modo puede pedir su propia intensidad de bloom (ej. el Túnel
  // Sagrado la baja porque sus texturas aditivas + emissive quedaban
  // sobreexpuestas con la intensidad global por defecto).
  const bloom = mode.bloomOverride || DEFAULT_BLOOM;
  bloomPass.strength = bloom.strength;
  bloomPass.radius = bloom.radius;
  bloomPass.threshold = bloom.threshold;
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

// ---------- Ciclar variante del Túnel Sagrado (solo en modo inmersivo) ----------
// Un tap/click (sin arrastrar, para no pisar el drag de OrbitControls)
// o la flecha derecha avanzan a la siguiente variante — pero solo si el
// modo activo es el mandala Y la interfaz está en modo inmersivo, para
// no interferir con los controles normales de cámara/UI en el resto de
// los casos.
function tryCycleMandalaVariant() {
  if (
    wmpWindow.classList.contains("immersive") &&
    activeMode.key === "mandala" &&
    typeof activeMode.cycleVariant === "function"
  ) {
    activeMode.cycleVariant();
  }
}

let tapStart = null;
const TAP_MOVE_THRESHOLD = 6; // px — más que esto se considera arrastre, no tap
canvas.addEventListener("pointerdown", (e) => {
  tapStart = { x: e.clientX, y: e.clientY };
});
canvas.addEventListener("pointerup", (e) => {
  if (!tapStart) return;
  const moved = Math.hypot(e.clientX - tapStart.x, e.clientY - tapStart.y);
  tapStart = null;
  if (moved < TAP_MOVE_THRESHOLD) tryCycleMandalaVariant();
});

document.addEventListener("keydown", (e) => {
  if (e.key === "ArrowRight") tryCycleMandalaVariant();
});

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
