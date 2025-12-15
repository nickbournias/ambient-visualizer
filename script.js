// viz.js
import * as THREE from "three";

/* -----------------------------
   DOM
------------------------------ */
const canvas = document.getElementById("viz");
if (!canvas) throw new Error('Canvas "#viz" not found');

const audioEl = document.getElementById("audio");
const fileEl = document.getElementById("audioFile");
const playBtn = document.getElementById("audioPlay");
if (!audioEl || !fileEl || !playBtn) {
  throw new Error("Need #audio, #audioFile, #audioPlay");
}

/* -----------------------------
   THREE
------------------------------ */
const scene = new THREE.Scene();

const camera = new THREE.PerspectiveCamera(70, 1, 0.01, 20);
camera.position.z = 1.2;

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));

/* -----------------------------
   Resize
------------------------------ */
function resize() {
  const r = canvas.getBoundingClientRect();
  const w = Math.max(1, Math.floor(r.width));
  const h = Math.max(1, Math.floor(r.height));
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
window.addEventListener("resize", resize, { passive: true });
resize();

/* -----------------------------
   AUDIO
------------------------------ */
let audioCtx = null;
let analyser = null;
let spectrum = null;
let mediaSrcNode = null;

function ensureAudio() {
  if (audioCtx) return;

  audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  analyser = audioCtx.createAnalyser();
  analyser.fftSize = 2048;
  analyser.smoothingTimeConstant = 0.85;
  spectrum = new Uint8Array(analyser.frequencyBinCount);

  // Important: createMediaElementSource MUST be created once per <audio> element
  mediaSrcNode = audioCtx.createMediaElementSource(audioEl);
  mediaSrcNode.connect(analyser);
  analyser.connect(audioCtx.destination);
}

fileEl.addEventListener("change", () => {
  const f = fileEl.files?.[0];
  if (!f) return;

  ensureAudio();

  audioEl.src = URL.createObjectURL(f);
  audioEl.load();

  playBtn.textContent = "Play";
});

playBtn.addEventListener("click", async () => {
  ensureAudio();

  // Must be called from a user gesture (this click counts)
  if (audioCtx.state !== "running") await audioCtx.resume();

  if (!audioEl.src) return; // no file chosen yet

  if (audioEl.paused) {
    await audioEl.play();
    playBtn.textContent = "Pause";
  } else {
    audioEl.pause();
    playBtn.textContent = "Play";
  }
});

/* -----------------------------
   Helpers
------------------------------ */
function lerp(a, b, t) {
  return a + (b - a) * t;
}

function bandEnergy(startHz, endHz) {
  if (!audioCtx || !spectrum) return 0;
  const nyquist = audioCtx.sampleRate / 2;
  const start = Math.floor((startHz / nyquist) * spectrum.length);
  const end = Math.floor((endHz / nyquist) * spectrum.length);

  let sum = 0;
  let count = 0;
  for (let i = Math.max(0, start); i <= Math.min(spectrum.length - 1, end); i++) {
    sum += spectrum[i];
    count++;
  }
  return count ? (sum / count) / 255 : 0;
}

/* -----------------------------
   Shader: YOUR palette + audio energize
------------------------------ */
const material = new THREE.ShaderMaterial({
  transparent: true,
  side: THREE.FrontSide,
  uniforms: {
    uTime: { value: 0 },
    uPlay: { value: 0 },     // smoothed 0..1
    uAmp: { value: 0 },      // smoothed 0..1
    uBass: { value: 0 },     // smoothed 0..1
    uMid: { value: 0 },      // smoothed 0..1
    uHigh: { value: 0 }      // smoothed 0..1
  },
  vertexShader: `
    uniform float uTime;
    uniform float uPlay;
    uniform float uAmp;
    uniform float uBass;
    uniform float uMid;
    uniform float uHigh;

    varying vec3 vPos;

    void main() {
      float t = uTime * 0.8;

      // Base breathing (your vibe)
      float wave =
        sin(position.x * 4.0 + t) +
        sin(position.y * 5.0 + t * 1.1) +
        sin(position.z * 6.0 + t * 0.9);

      vec3 displaced = position * (1.0 + 0.06 * wave);

      // Audio distortion: smooth + musical (no banding)
      float detail =
        sin(position.x * 10.0 + t * 1.5) *
        sin(position.y *  9.0 + t * 1.2) *
        sin(position.z *  8.0 + t * 1.0);

      float distort = (0.02 * uPlay) + (0.06 * uPlay * uBass); // bass drives form
      displaced += normalize(normal) * detail * distort;

      // gentle global “breath push” on loudness
      displaced *= (1.0 + 0.02 * uPlay * uAmp);

      vPos = displaced;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(displaced, 1.0);
    }
  `,
  fragmentShader: `
    uniform float uTime;
    uniform float uPlay;
    uniform float uAmp;
    uniform float uBass;
    uniform float uMid;
    uniform float uHigh;

    varying vec3 vPos;

    vec3 palette(float t) {
      vec3 a = vec3(0.5);
      vec3 b = vec3(0.5);
      vec3 c = vec3(1.0);
      vec3 d = vec3(0.00, 0.33, 0.67);
      return a + b * cos(6.28318 * (c * t + d));
    }

    void main() {
      if (!gl_FrontFacing) discard;

      vec3 p = normalize(vPos);

      // Base palette phase (rest look)
      float baseT = length(vPos) * 1.8 + uTime * 0.25;

      // Keep same palette, but "energize" it musically
      float phase = baseT
        + uPlay * (0.35 * uMid)
        + uPlay * (0.18 * uHigh)
        - uPlay * (0.10 * uBass);

      vec3 col = palette(phase);

      // Brightness lift when playing (NO harsh jump)
      float lift = 1.0 + uPlay * (0.25 * uAmp + 0.15 * uHigh);
      col *= lift;

      // Reduce black without looking washed out
      col = mix(col, col + 0.12, uPlay * 0.35);

      // very soft rim (not a shell)
      float rim = 1.0 - smoothstep(0.35, 1.0, abs(p.z));
      col += rim * (0.06 + 0.10 * uPlay);

      gl_FragColor = vec4(col, 1.0);
    }
  `
});

/* -----------------------------
   Main sphere
------------------------------ */
const SPHERE_RADIUS = 0.45;
const sphereGeo = new THREE.SphereGeometry(SPHERE_RADIUS, 160, 160);
const sphere = new THREE.Mesh(sphereGeo, material);
scene.add(sphere);

/* -----------------------------
   Click picking
------------------------------ */
const raycaster = new THREE.Raycaster();
const mouse = new THREE.Vector2();

/* -----------------------------
   Bubble explosion + return
------------------------------ */
let state = "idle"; // "idle" | "explode" | "return"
let bubbles = [];
let explodeStart = 0;

const BUBBLE_COUNT = 90;
const BUBBLE_RADIUS = 0.045;

// timings (seconds)
const EXPLODE_DURATION = 1.0;   // bounce outward during this
const HOLD_DURATION = 0.6;      // float a bit
const RETURN_DURATION = 1.2;    // spring back

// motion tuning
const OUTWARD_IMPULSE_MIN = 0.020;
const OUTWARD_IMPULSE_MAX = 0.035;
const DRAG_EXPLODE = 0.985;
const DRAG_RETURN = 0.90;

// imaginary boundary for "bounce"
const BOUNCE_RADIUS = 1.10;

function resetToSphere() {
  for (const b of bubbles) scene.remove(b);
  bubbles = [];
  sphere.visible = true;
  state = "idle";
}

function makeBubbles() {
  const bubbleGeo = new THREE.SphereGeometry(BUBBLE_RADIUS, 24, 24);
  bubbles = [];

  for (let i = 0; i < BUBBLE_COUNT; i++) {
    // clone the SAME shader so the palette matches exactly
    const bMat = material.clone();
    bMat.uniforms = {
      uTime: { value: 0 },
      uPlay: { value: material.uniforms.uPlay.value },
      uAmp: { value: material.uniforms.uAmp.value },
      uBass: { value: material.uniforms.uBass.value },
      uMid: { value: material.uniforms.uMid.value },
      uHigh: { value: material.uniforms.uHigh.value }
    };

    const b = new THREE.Mesh(bubbleGeo, bMat);

    // random direction
    const dir = new THREE.Vector3(
      Math.random() * 2 - 1,
      Math.random() * 2 - 1,
      Math.random() * 2 - 1
    );
    if (dir.lengthSq() < 1e-6) dir.set(1, 0, 0);
    dir.normalize();

    // home position near the sphere surface (so it snaps back cleanly)
    const home = dir.clone().multiplyScalar(SPHERE_RADIUS * (0.95 + Math.random() * 0.10));
    b.position.copy(home);

    // outward kick
    const impulse = OUTWARD_IMPULSE_MIN + Math.random() * (OUTWARD_IMPULSE_MAX - OUTWARD_IMPULSE_MIN);
    b.userData.vel = dir.clone().multiplyScalar(impulse);
    b.userData.home = home;

    scene.add(b);
    bubbles.push(b);
  }
}

function explodeAndReturn() {
  if (state !== "idle") return;
  explodeStart = performance.now() * 0.001;
  state = "explode";

  sphere.visible = false;
  makeBubbles();
}

canvas.addEventListener(
  "pointerdown",
  (e) => {
    if (state !== "idle") return;

    const r = canvas.getBoundingClientRect();
    mouse.x = ((e.clientX - r.left) / r.width) * 2 - 1;
    mouse.y = -(((e.clientY - r.top) / r.height) * 2 - 1);

    raycaster.setFromCamera(mouse, camera);
    const hit = raycaster.intersectObject(sphere, false);
    if (hit.length) explodeAndReturn();
  },
  { passive: true }
);

/* -----------------------------
   Animate
------------------------------ */
const smooth = { play: 0, amp: 0, bass: 0, mid: 0, high: 0 };
const tmp = new THREE.Vector3();
const tmp2 = new THREE.Vector3();

function pushUniforms(mat) {
  mat.uniforms.uTime.value = material.uniforms.uTime.value;
  mat.uniforms.uPlay.value = material.uniforms.uPlay.value;
  mat.uniforms.uAmp.value = material.uniforms.uAmp.value;
  mat.uniforms.uBass.value = material.uniforms.uBass.value;
  mat.uniforms.uMid.value = material.uniforms.uMid.value;
  mat.uniforms.uHigh.value = material.uniforms.uHigh.value;
}

function animate(ms) {
  const t = ms * 0.001;

  // update base uniforms
  material.uniforms.uTime.value = t;

  const playing = analyser && !audioEl.paused;

  // smooth play ramp so NOTHING snaps when audio starts
  smooth.play = lerp(smooth.play, playing ? 1 : 0, 0.05);
  material.uniforms.uPlay.value = smooth.play;

  if (analyser && spectrum) {
    analyser.getByteFrequencyData(spectrum);

    // bands (tweak if you want)
    const bass = bandEnergy(20, 140);
    const mid = bandEnergy(200, 2000);
    const high = bandEnergy(4000, 12000);

    // overall loudness-ish
    const amp = Math.min(1, (bass * 0.55 + mid * 0.30 + high * 0.25) * 1.15);

    // smooth
    smooth.bass = lerp(smooth.bass, bass, 0.08);
    smooth.mid  = lerp(smooth.mid,  mid,  0.08);
    smooth.high = lerp(smooth.high, high, 0.08);
    smooth.amp  = lerp(smooth.amp,  amp,  0.08);

    material.uniforms.uBass.value = smooth.bass;
    material.uniforms.uMid.value  = smooth.mid;
    material.uniforms.uHigh.value = smooth.high;
    material.uniforms.uAmp.value  = smooth.amp;
  } else {
    // decay smoothly to rest if no analyser yet
    smooth.amp  = lerp(smooth.amp,  0, 0.08);
    smooth.bass = lerp(smooth.bass, 0, 0.08);
    smooth.mid  = lerp(smooth.mid,  0, 0.08);
    smooth.high = lerp(smooth.high, 0, 0.08);

    material.uniforms.uAmp.value  = smooth.amp;
    material.uniforms.uBass.value = smooth.bass;
    material.uniforms.uMid.value  = smooth.mid;
    material.uniforms.uHigh.value = smooth.high;
  }

  // idle sphere motion
  if (state === "idle") {
    sphere.rotation.y = t * 0.35;
    sphere.rotation.x = t * 0.18;
  }

  // explode/return lifecycle
  if (state === "explode" || state === "return") {
    const elapsed = t - explodeStart;

    if (state === "explode" && elapsed > (EXPLODE_DURATION + HOLD_DURATION)) {
      state = "return";
    }

    if (state === "return" && elapsed > (EXPLODE_DURATION + HOLD_DURATION + RETURN_DURATION)) {
      resetToSphere();
    }

    for (const b of bubbles) {
      // keep bubbles on EXACT same color scheme + audio response
      pushUniforms(b.material);

      const vel = b.userData.vel;

      if (state === "explode") {
        vel.multiplyScalar(DRAG_EXPLODE);

        // tiny randomness
        vel.x += (Math.random() - 0.5) * 0.00045;
        vel.y += (Math.random() - 0.5) * 0.00045;
        vel.z += (Math.random() - 0.5) * 0.00045;

        b.position.add(vel);

        // bounce off invisible boundary
        const d = b.position.length();
        if (d > BOUNCE_RADIUS) {
          const n = tmp.copy(b.position).multiplyScalar(1 / d);
          const vn = vel.dot(n);
          tmp2.copy(n).multiplyScalar(2 * vn);
          vel.sub(tmp2);

          b.position.copy(n.multiplyScalar(BOUNCE_RADIUS));
          vel.multiplyScalar(0.85);
        }
      } else {
        // spring toward home + heavy damping
        vel.multiplyScalar(DRAG_RETURN);

        tmp.copy(b.userData.home).sub(b.position);
        vel.add(tmp.multiplyScalar(0.06));

        b.position.add(vel);
      }
    }
  }

  renderer.render(scene, camera);
  requestAnimationFrame(animate);
}

requestAnimationFrame(animate);
