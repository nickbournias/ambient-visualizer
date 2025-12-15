// viz.js
import * as THREE from "three";

/* -----------------------------
   DOM (required)
------------------------------ */
const canvas = document.getElementById("viz");
if (!canvas) throw new Error('Canvas "#viz" not found');

const audioEl = document.getElementById("audio");
const fileEl = document.getElementById("audioFile");
const playBtn = document.getElementById("audioPlay");
if (!audioEl || !fileEl || !playBtn) throw new Error("Need #audio, #audioFile, #audioPlay");

playBtn.setAttribute("type", "button");

/* -----------------------------
   THREE
------------------------------ */
const scene = new THREE.Scene();

const camera = new THREE.PerspectiveCamera(70, 1, 0.01, 20);
camera.position.z = 1.2;

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));

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

function ensureAudioGraph() {
  if (audioCtx) return;

  audioCtx = new (window.AudioContext || window.webkitAudioContext)();

  analyser = audioCtx.createAnalyser();
  analyser.fftSize = 2048;
  analyser.smoothingTimeConstant = 0.78;
  spectrum = new Uint8Array(analyser.frequencyBinCount);

  mediaSrcNode = audioCtx.createMediaElementSource(audioEl);
  mediaSrcNode.connect(analyser);
  analyser.connect(audioCtx.destination);

  audioEl.preload = "auto";
  audioEl.muted = false;
  audioEl.volume = 1;
}

fileEl.addEventListener("change", () => {
  const f = fileEl.files?.[0];
  if (!f) return;
  audioEl.src = URL.createObjectURL(f);
  audioEl.load();
  playBtn.textContent = "Play";
});

playBtn.addEventListener(
  "click",
  async (e) => {
    e.preventDefault();
    e.stopPropagation();
    try {
      ensureAudioGraph();
      if (audioCtx.state !== "running") await audioCtx.resume();
      if (!audioEl.src) return;

      if (audioEl.paused) {
        await audioEl.play();
        playBtn.textContent = "Pause";
      } else {
        audioEl.pause();
        playBtn.textContent = "Play";
      }
    } catch (err) {
      console.error("Audio play failed:", err);
    }
  },
  { passive: false }
);

/* -----------------------------
   Helpers
------------------------------ */
function lerp(a, b, t) {
  return a + (b - a) * t;
}
function clamp(x, a, b) {
  return Math.max(a, Math.min(b, x));
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
  return count ? sum / count / 255 : 0;
}

/* -----------------------------
   Shader
   - No mesh scaling
   - Soft-knee limiter prevents "ballooning"
   - No "perfect sphere snap" at ceiling
------------------------------ */
const material = new THREE.ShaderMaterial({
  transparent: true,
  side: THREE.FrontSide,
  uniforms: {
    uTime: { value: 0 },
    uPlay: { value: 0 },
    uAmp: { value: 0 },
    uBass: { value: 0 },
    uMid: { value: 0 },
    uHigh: { value: 0 },
    uKick: { value: 0 },
    uSnare: { value: 0 },
    uRipple: { value: 0 }
  },
  vertexShader: `
    uniform float uTime;
    uniform float uPlay;
    uniform float uAmp;
    uniform float uBass;
    uniform float uMid;
    uniform float uHigh;
    uniform float uKick;
    uniform float uSnare;
    uniform float uRipple;

    varying vec3 vBasePos;
    varying vec3 vViewPos;
    varying float vFacing;

    void main() {
      float tTime = uTime;

      vBasePos = position;

      // Camera-facing mask
      vec3 nView = normalize(normalMatrix * normal);
      vFacing = clamp(abs(nView.z), 0.0, 1.0);
      float faceBoost = mix(0.80, 1.55, vFacing);

      // Big readable bulge (slow)
      float bulge =
        sin(tTime * 1.17 + position.x * 1.21) +
        sin(tTime * 1.03 + position.y * 1.07) +
        sin(tTime * 0.91 + position.z * 1.03);

      // Medium undulation
      float mid =
        sin(position.x * 5.7 + tTime * 1.05) +
        sin(position.y * 6.4 + tTime * 0.98) +
        sin(position.z * 7.1 + tTime * 0.92);

      // Fine detail
      float detail =
        sin(position.x * 10.0 + tTime * 1.75) *
        sin(position.y *  9.0 + tTime * 1.42) *
        sin(position.z *  8.0 + tTime * 1.18);

      // Hit shapes
      float kickShape = sin(tTime * 9.5 + position.y * 4.0);
      float snareShape =
        sin(position.x * 34.0 + tTime * 16.0) *
        sin(position.y * 22.0 + tTime * 13.0);

      // ---- Amplitudes ----
      float baseBulge = 0.018;
      float bulgeAmp  = baseBulge + uPlay * (0.070 * uRipple + 0.125 * uBass);
      float midAmp    = 0.008 + uPlay * (0.030 * uRipple);
      float detAmp    = uPlay * (0.010 + 0.060 * uHigh) * (0.55 + 0.75 * uRipple);

      float disp = (bulge * bulgeAmp) + (mid * midAmp) + (detail * detAmp);

      // DC cancel (helps "same size" feel)
      disp -= 0.28 * bulge * bulgeAmp;

      // Hit punches
      disp += (0.090 * uKick)  * kickShape  * faceBoost;
      disp += (0.055 * uSnare) * snareShape * faceBoost;

      // Displace along normal only
      vec3 displaced = position + normalize(normal) * disp * faceBoost;

     // --- soft-limit displacement (tighter so it can't get huge) ---
float maxDisp = 0.022 + 0.016 * uPlay;
float knee    = 0.75;

float x = disp / maxDisp;
x = x / (1.0 + abs(x) / knee);
disp = x * maxDisp;




      vec4 mv = modelViewMatrix * vec4(displaced, 1.0);
      vViewPos = mv.xyz;
      gl_Position = projectionMatrix * mv;
    }
  `,
  fragmentShader: `
    precision highp float;

    uniform float uTime;
    uniform float uPlay;
    uniform float uAmp;
    uniform float uBass;
    uniform float uMid;
    uniform float uHigh;
    uniform float uKick;
    uniform float uSnare;
    uniform float uRipple;

    varying vec3 vBasePos;
    varying vec3 vViewPos;
    varying float vFacing;

    vec3 palette(float tt) {
      vec3 a = vec3(0.5);
      vec3 b = vec3(0.5);
      vec3 c = vec3(1.0);
      vec3 d = vec3(0.00, 0.33, 0.67);
      return a + b * cos(6.28318 * (c * tt + d));
    }

    void main() {
      if (!gl_FrontFacing) discard;

      float baseT = length(vBasePos) * 1.8 + uTime * 0.25;
      float phase = baseT
        + uPlay * (0.35 * uMid)
        + uPlay * (0.18 * uHigh)
        - uPlay * (0.10 * uBass);

      vec3 col = palette(phase);

      vec3 dx = dFdx(vViewPos);
      vec3 dy = dFdy(vViewPos);
      vec3 n  = normalize(cross(dx, dy));

      vec3 lightDir = normalize(vec3(0.4, 0.3, 1.0));
      float ndl = clamp(dot(n, lightDir), 0.0, 1.0);

      float belly = smoothstep(0.15, 0.98, vFacing);

      float ambient = 0.56;
      float diffuse = 0.62 * ndl;
      float shade = ambient + diffuse + 0.24 * belly;

      vec3 h = normalize(lightDir + vec3(0.0, 0.0, 1.0));
      float spec = pow(clamp(dot(n, h), 0.0, 1.0), 44.0) * (0.10 + 0.10 * uRipple);

      col *= shade;
      col += spec;

      col += uKick  * vec3(0.10, 0.06, 0.02);
      col += uSnare * vec3(0.04, 0.06, 0.10);

      col = mix(col, col + 0.10, uPlay * 0.18 + uRipple * 0.10);

      gl_FragColor = vec4(col, 1.0);
    }
  `
});

const sphereGeo = new THREE.SphereGeometry(0.45, 192, 192);
const sphere = new THREE.Mesh(sphereGeo, material);
scene.add(sphere);

/* -----------------------------
   Kick/snare detection + Ripple envelope
------------------------------ */
const smooth = { play: 0, amp: 0, bass: 0, mid: 0, high: 0 };
let prevKickE = 0;
let prevSnareE = 0;
let kickPulse = 0;
let snarePulse = 0;

const KICK_DIFF_GAIN = 4.9;
const SNARE_DIFF_GAIN = 5.5;
const KICK_DECAY = 0.78;
const SNARE_DECAY = 0.75;

// Ripple envelope (lingers)
let rippleEnv = 0;
const RIPPLE_DECAY = 0.965;
const RIPPLE_ATTACK = 0.18;

function animate(ms) {
  const t = ms * 0.001;
  material.uniforms.uTime.value = t;

  const playing = analyser && !audioEl.paused;
  smooth.play = lerp(smooth.play, playing ? 1 : 0, 0.06);
  material.uniforms.uPlay.value = smooth.play;

  if (analyser && spectrum) {
    analyser.getByteFrequencyData(spectrum);

    const bass = bandEnergy(25, 140);
    const mid = bandEnergy(220, 2200);
    const high = bandEnergy(3500, 12000);

    const amp = clamp((bass * 0.62 + mid * 0.22 + high * 0.34) * 1.08, 0, 1);

    smooth.bass = lerp(smooth.bass, bass, 0.10);
    smooth.mid = lerp(smooth.mid, mid, 0.10);
    smooth.high = lerp(smooth.high, high, 0.10);
    smooth.amp = lerp(smooth.amp, amp, 0.10);

    material.uniforms.uBass.value = smooth.bass;
    material.uniforms.uMid.value = smooth.mid;
    material.uniforms.uHigh.value = smooth.high;
    material.uniforms.uAmp.value = smooth.amp;

    const kickE = bandEnergy(35, 110);
    const snareE = bandEnergy(1600, 5200);

    const kickDiff = Math.max(0, kickE - prevKickE) * KICK_DIFF_GAIN;
    const snareDiff = Math.max(0, snareE - prevSnareE) * SNARE_DIFF_GAIN;

    prevKickE = lerp(prevKickE, kickE, 0.35);
    prevSnareE = lerp(prevSnareE, snareE, 0.35);

    kickPulse = Math.max(kickDiff, kickPulse * KICK_DECAY);
    snarePulse = Math.max(snareDiff, snarePulse * SNARE_DECAY);

    material.uniforms.uKick.value = clamp(kickPulse, 0, 1) * smooth.play;
    material.uniforms.uSnare.value = clamp(snarePulse, 0, 1) * smooth.play;

    const targetRipple = clamp(0.55 * smooth.amp + 0.65 * smooth.bass + 0.25 * smooth.high, 0, 1);
    rippleEnv = Math.max(rippleEnv * RIPPLE_DECAY, lerp(rippleEnv, targetRipple, RIPPLE_ATTACK));
    material.uniforms.uRipple.value = rippleEnv * smooth.play;
  } else {
    material.uniforms.uAmp.value = lerp(material.uniforms.uAmp.value, 0, 0.08);
    material.uniforms.uBass.value = lerp(material.uniforms.uBass.value, 0, 0.08);
    material.uniforms.uMid.value = lerp(material.uniforms.uMid.value, 0, 0.08);
    material.uniforms.uHigh.value = lerp(material.uniforms.uHigh.value, 0, 0.08);
    material.uniforms.uKick.value = lerp(material.uniforms.uKick.value, 0, 0.12);
    material.uniforms.uSnare.value = lerp(material.uniforms.uSnare.value, 0, 0.12);

    rippleEnv = rippleEnv * 0.95;
    material.uniforms.uRipple.value = rippleEnv;
  }

  sphere.rotation.y = t * 0.35;
  sphere.rotation.x = t * 0.18;

  renderer.render(scene, camera);
  requestAnimationFrame(animate);
}
requestAnimationFrame(animate);
