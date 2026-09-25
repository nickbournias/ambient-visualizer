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

if (!audioEl || !fileEl || !playBtn) {
  throw new Error("Need #audio, #audioFile, #audioPlay");
}

playBtn.setAttribute("type", "button");

/* -----------------------------
   THREE
------------------------------ */
const scene = new THREE.Scene();

const camera = new THREE.PerspectiveCamera(72, 1, 0.01, 20);
camera.position.z = 1.55;

const renderer = new THREE.WebGLRenderer({
  canvas,
  antialias: true,
  alpha: true
});

renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));

function setRendererSize(w, h) {
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}

function resize() {
  const r = canvas.getBoundingClientRect();
  const w = Math.max(1, Math.floor(r.width));
  const h = Math.max(1, Math.floor(r.height));
  setRendererSize(w, h);
}

function resizeIfNeeded() {
  const r = canvas.getBoundingClientRect();
  const w = Math.max(1, Math.floor(r.width));
  const h = Math.max(1, Math.floor(r.height));

  if (canvas.width !== w || canvas.height !== h) {
    setRendererSize(w, h);
  }
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
  analyser.smoothingTimeConstant = 0.82;
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

      if (audioCtx.state !== "running") {
        await audioCtx.resume();
      }

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

function softPeak(current, incoming, decay) {
  return Math.max(incoming, current * decay);
}

/* -----------------------------
   Shader
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
    uLead: { value: 0 },
    uRipple: { value: 0 },
    uImpact: { value: 0 }
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
    uniform float uLead;
    uniform float uRipple;
    uniform float uImpact;

    varying vec3 vBasePos;
    varying vec3 vViewPos;
    varying vec3 vNormalView;
    varying float vFacing;
    varying float vEnergy;

    float softLimit(float x, float m, float k) {
      float n = x / m;
      n = n / (1.0 + abs(n) / k);
      return n * m;
    }

    void main() {
      float t = uTime;

      vBasePos = position;

      vec3 nView = normalize(normalMatrix * normal);
      vNormalView = nView;
      vFacing = clamp(abs(nView.z), 0.0, 1.0);

      float faceBoost = mix(0.84, 1.42, vFacing);

      // restrained body core
      float body =
        sin(t * 0.82 + position.x * 0.92) +
        sin(t * 0.94 + position.y * 0.88) +
        sin(t * 0.78 + position.z * 0.96);

      float bodyAmp =
        0.005 +
        uPlay * (0.007 * uBass + 0.006 * uRipple + 0.008 * uImpact);

      float bodyDisp = body * bodyAmp;
      bodyDisp -= 0.28 * body * bodyAmp;

      // surface / skin motion
      float surface =
        sin(position.x * 4.0 + t * 0.92) +
        sin(position.y * 4.6 + t * 0.86) +
        sin(position.z * 5.0 + t * 0.80);

      float detail =
        sin(position.x * 6.2 + t * 1.05) *
        sin(position.y * 5.6 + t * 0.96) *
        sin(position.z * 5.1 + t * 0.90);

      float streak =
        sin((position.x + position.y) * 8.5 + t * 1.20) *
        cos((position.y + position.z) * 7.4 - t * 0.95);

      float surfaceAmp =
        uPlay * (
          0.010 +
          0.020 * uRipple +
          0.014 * uMid +
          0.135 * uImpact
        );

      float detailAmp =
        uPlay * (
          0.004 +
          0.016 * uHigh +
          0.012 * uRipple
        );

      float streakAmp =
        uPlay * (
          0.002 +
          0.050 * uImpact +
          0.010 * uBass
        );

      float surfaceDisp =
        surface * surfaceAmp +
        detail * detailAmp +
        streak * streakAmp;

      // strong side hits
      float kickShape =
        sin(t * 8.8 + position.y * 5.0) +
        0.85 * sin(t * 11.4 + position.x * 4.1);

      float snareShape =
        sin(position.x * 25.0 + t * 13.5) *
        sin(position.y * 18.0 + t * 10.6);

      float sideMask =
        0.55 + 0.45 * smoothstep(0.10, 0.95, abs(position.x));

      float frontSideMask =
        mix(0.85, 1.35, vFacing) * sideMask;

      float transientDisp = 0.0;
transientDisp += 0.055 * uKick * kickShape * frontSideMask;
transientDisp += 0.052 * uSnare * snareShape * frontSideMask;

bodyDisp = softLimit(bodyDisp, 0.012 + 0.005 * uPlay, 1.2);

/* -------- BASS COMPRESSION (NEW) -------- */

float inwardMask =
  mix(0.70, 1.25, vFacing) *
  (0.75 + 0.25 * smoothstep(0.10, 1.0, abs(position.x)));

float inwardPunch =
  (0.150 * uKick + 0.024 * uImpact + 0.012 * uBass) *
  inwardMask;

/* -------- FINAL COMBINE -------- */

float disp = bodyDisp + surfaceDisp + transientDisp - inwardPunch;


      disp = softLimit(disp, 0.090 + 0.028 * uPlay + 0.095 * uImpact, 2.1);

      disp *= mix(0.92, 1.00, vFacing);

      vec3 displaced = position + normalize(normal) * disp * faceBoost;

      vEnergy = clamp(abs(disp) * 30.0, 0.0, 1.0);

      vec4 mv = modelViewMatrix * vec4(displaced, 1.0);
      vViewPos = mv.xyz;
      gl_Position = projectionMatrix * mv;
    }
  `,
  fragmentShader: `
    precision highp float;

    uniform float uTime;
    uniform float uPlay;
    uniform float uBass;
    uniform float uMid;
    uniform float uHigh;
    uniform float uKick;
    uniform float uSnare;
    uniform float uLead;
    uniform float uRipple;
    uniform float uImpact;

    varying vec3 vBasePos;
    varying vec3 vViewPos;
    varying vec3 vNormalView;
    varying float vFacing;
    varying float vEnergy;

    vec3 palette(float t) {
      vec3 a = vec3(0.5);
      vec3 b = vec3(0.5);
      vec3 c = vec3(1.0);
      vec3 d = vec3(0.00, 0.33, 0.67);
      return a + b * cos(6.28318 * (c * t + d));
    }

    void main() {
      if (!gl_FrontFacing) discard;

      float baseT = length(vBasePos) * 1.55 + uTime * 0.03;
      float phase = baseT
        + uPlay * (0.11 * uMid)
        + uPlay * (0.06 * uHigh)
        - uPlay * (0.05 * uBass)
        + 0.80 * uImpact
        + 0.10 * uLead;

      vec3 col = palette(phase * 0.82);

      vec3 n = normalize(vNormalView);

      vec3 lightDir = normalize(vec3(0.78, 0.48, 1.0));
      float ndl = clamp(dot(n, lightDir), 0.0, 1.0);

      float belly = smoothstep(0.16, 0.98, vFacing);

      float ambient = 0.25;
      float diffuse = 0.75 * ndl;
      float rim = pow(1.0 - clamp(vFacing, 0.0, 1.9), 1.8) * 0.15;

      float shade = ambient + diffuse + 0.05 * belly;

      col *= shade;
      col += rim;

      vec3 h = normalize(lightDir + vec3(0.0, 0.0, 1.0));
      float spec = pow(clamp(dot(n, h), 0.0, 1.0), 18.0) * 0.032;
      col += spec;

      col += uKick * vec3(0.010, 0.008, 0.014);
      col += uSnare * vec3(0.014, 0.008, 0.008);
      col += uLead * vec3(0.008, 0.010, 0.014);

      col += vEnergy * 0.006;

      col = mix(col, col + 0.016, 0.02 * uPlay + 0.032 * uImpact);

      gl_FragColor = vec4(col, 1.0);
    }
  `
});

const sphereGeo = new THREE.SphereGeometry(0.50, 192, 192);
const sphere = new THREE.Mesh(sphereGeo, material);
scene.add(sphere);

/* -----------------------------
   Audio response state
------------------------------ */
const smooth = {
  play: 0,
  amp: 0,
  bass: 0,
  mid: 0,
  high: 0
};

let prevKickE = 0;
let prevSnareE = 0;
let prevLeadE = 0;

let kickPulse = 0;
let snarePulse = 0;
let leadPulse = 0;

let rippleEnv = 0;
let impactEnv = 0;

const KICK_DIFF_GAIN = 50.5;
const SNARE_DIFF_GAIN = 50.0;
const LEAD_DIFF_GAIN = 20.8;

const KICK_DECAY = 0.975;
const SNARE_DECAY = 0.965;
const LEAD_DECAY = 0.968;
const RIPPLE_DECAY = 0.9965;
const IMPACT_DECAY = 0.996;

const RIPPLE_ATTACK = 0.22;
const IMPACT_ATTACK = 0.95;

/* -----------------------------
   Animate
------------------------------ */
function animate(ms) {
  const t = ms * 0.001;

  resizeIfNeeded();
  material.uniforms.uTime.value = t;

  const playing = !!(analyser && !audioEl.paused);
  smooth.play = lerp(smooth.play, playing ? 1 : 0, 0.06);
  material.uniforms.uPlay.value = smooth.play;

  if (analyser && spectrum) {
    analyser.getByteFrequencyData(spectrum);

    const bass = bandEnergy(25, 140);
    const mid = bandEnergy(220, 2200);
    const high = bandEnergy(3500, 12000);

    const kickBand = bandEnergy(50, 110);
    const snareBand = bandEnergy(1800, 4500);

    const leadLow = bandEnergy(120, 380);
    const leadHigh = bandEnergy(700, 2600);
    const leadBand = clamp(0.55 * leadLow + 0.85 * leadHigh, 0, 1);

    const amp = clamp((bass * 0.62 + mid * 0.24 + high * 0.34) * 1.08, 0, 1);

    smooth.bass = lerp(smooth.bass, bass, 0.10);
    smooth.mid = lerp(smooth.mid, mid, 0.10);
    smooth.high = lerp(smooth.high, high, 0.10);
    smooth.amp = lerp(smooth.amp, amp, 0.09);

    material.uniforms.uBass.value = smooth.bass;
    material.uniforms.uMid.value = smooth.mid;
    material.uniforms.uHigh.value = smooth.high;
    material.uniforms.uAmp.value = smooth.amp;

    const kickDiff = Math.max(0, kickBand - prevKickE) * KICK_DIFF_GAIN;
    const snareDiff = Math.max(0, snareBand - prevSnareE) * SNARE_DIFF_GAIN;
    const leadDiff = Math.max(0, leadBand - prevLeadE) * LEAD_DIFF_GAIN;

    prevKickE = lerp(prevKickE, kickBand, 0.26);
    prevSnareE = lerp(prevSnareE, snareBand, 0.28);
    prevLeadE = lerp(prevLeadE, leadBand, 0.18);

    kickPulse = softPeak(kickPulse, kickDiff, KICK_DECAY);
    snarePulse = softPeak(snarePulse, snareDiff, SNARE_DECAY);
    leadPulse = softPeak(leadPulse, leadDiff, LEAD_DECAY);

    const kick = clamp(kickPulse, 0, 1) * smooth.play;
    const snare = clamp(snarePulse, 0, 1) * smooth.play;
    const lead = clamp(leadPulse, 0, 1) * smooth.play;

    material.uniforms.uKick.value = kick;
    material.uniforms.uSnare.value = snare;
    material.uniforms.uLead.value = lead;

    const impact = Math.max(kick, snare);

    const targetRipple = clamp(
      0.34 * smooth.amp +
      0.46 * smooth.bass +
      0.18 * smooth.high +
      1.28 * impact +
      0.52 * lead,
      0,
      1
    );

    const targetImpact = clamp(
      0.24 * smooth.amp +
      1.70 * impact +
      0.24 * smooth.bass +
      0.48 * lead,
      0,
      1
    );

    rippleEnv = Math.max(
      rippleEnv * RIPPLE_DECAY,
      lerp(rippleEnv, targetRipple, RIPPLE_ATTACK)
    );

    impactEnv = Math.max(
      impactEnv * IMPACT_DECAY,
      lerp(impactEnv, targetImpact, IMPACT_ATTACK)
    );

    material.uniforms.uRipple.value = rippleEnv * smooth.play;
    material.uniforms.uImpact.value = impactEnv * smooth.play;
  } else {
    material.uniforms.uAmp.value = lerp(material.uniforms.uAmp.value, 0, 0.08);
    material.uniforms.uBass.value = lerp(material.uniforms.uBass.value, 0, 0.08);
    material.uniforms.uMid.value = lerp(material.uniforms.uMid.value, 0, 0.08);
    material.uniforms.uHigh.value = lerp(material.uniforms.uHigh.value, 0, 0.08);

    material.uniforms.uKick.value = lerp(material.uniforms.uKick.value, 0, 0.10);
    material.uniforms.uSnare.value = lerp(material.uniforms.uSnare.value, 0, 0.10);
    material.uniforms.uLead.value = lerp(material.uniforms.uLead.value, 0, 0.10);

    rippleEnv *= 0.996;
    impactEnv *= 0.995;

    material.uniforms.uRipple.value = rippleEnv;
    material.uniforms.uImpact.value = impactEnv;
  }

  sphere.rotation.y = t * 0.40;
  sphere.rotation.x = t * 0.18;

  renderer.render(scene, camera);
  requestAnimationFrame(animate);
}

requestAnimationFrame(animate);
