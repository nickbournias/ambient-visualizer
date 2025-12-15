// viz.js
import * as THREE from "three";

const canvas = document.getElementById("viz");
if (!canvas) throw new Error('Canvas "#viz" not found');

const scene = new THREE.Scene();

const camera = new THREE.PerspectiveCamera(70, 1, 0.01, 10);
camera.position.z = 1.2;

const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    alpha: true
});
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));

/* -----------------------------
   Geometry
------------------------------ */
const geometry = new THREE.SphereGeometry(0.45, 128, 128);

/* -----------------------------
   Shader (colorful, no lights)
------------------------------ */
const material = new THREE.ShaderMaterial({
    transparent: true,
    uniforms: {
        uTime: { value: 0 }
    },
    vertexShader: `
    uniform float uTime;
    varying vec3 vPos;

    void main() {
      vPos = position;

      float t = uTime * 0.8;
      float wave =
        sin(position.x * 4.0 + t) +
        sin(position.y * 5.0 + t * 1.1) +
        sin(position.z * 6.0 + t * 0.9);

      vec3 displaced = position * (1.0 + 0.06 * wave);

      gl_Position = projectionMatrix * modelViewMatrix * vec4(displaced, 1.0);
    }
  `,
    fragmentShader: `
    uniform float uTime;
    varying vec3 vPos;

    // simple cosine palette
    vec3 palette(float t) {
      vec3 a = vec3(0.5);
      vec3 b = vec3(0.5);
      vec3 c = vec3(1.0);
      vec3 d = vec3(0.00, 0.33, 0.67);
      return a + b * cos(6.28318 * (c * t + d));
    }

    void main() {
      float t = length(vPos) * 1.8 + uTime * 0.25;
      vec3 color = palette(t);
      float rim = 1.0 - smoothstep(0.2, 1.0, abs(normalize(vPos).z));
      color += rim * 0.15;
      gl_FragColor = vec4(color, 1.0);
    }
  `
});

const mesh = new THREE.Mesh(geometry, material);
scene.add(mesh);

/* -----------------------------
   Resize
------------------------------ */
function resize() {
    const rect = canvas.getBoundingClientRect();
    const w = Math.max(1, rect.width);
    const h = Math.max(1, rect.height);

    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
}

window.addEventListener("resize", resize);
resize();

/* -----------------------------
   Animate
------------------------------ */
function animate(time) {
    const t = time * 0.001;

    material.uniforms.uTime.value = t;

    mesh.rotation.x = Math.sin(t * 0.6) * 0.35;
    mesh.rotation.y = Math.cos(t * 0.45) * 0.6;

    camera.position.x = Math.sin(t * 0.25) * 0.15;
    camera.position.y = Math.cos(t * 0.32) * 0.12;
    camera.lookAt(0, 0, 0);

    renderer.render(scene, camera);
    requestAnimationFrame(animate);
}

requestAnimationFrame(animate);
