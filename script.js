/* ============================================================
   Ambient Visualizer + Local Time + Local Temperature
   ============================================================ */

/* ---------- DOM references ---------- */
const canvas = document.getElementById('viz');
const timeEl = document.getElementById('viz-time');
const tempEl = document.getElementById('viz-temp');

if (!canvas) {
  throw new Error('Canvas #viz not found');
}

const ctx = canvas.getContext('2d');
const wrap = canvas.parentElement;

/* ---------- Resize (square canvas) ---------- */
function resize() {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const size = wrap.clientWidth;

  canvas.width = Math.floor(size * dpr);
  canvas.height = Math.floor(size * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

window.addEventListener('resize', resize);
resize();

/* ---------- Organic wave function ---------- */
function organic(x, t) {
  return (
    Math.sin(x * 0.010 + t * 1.0) * 0.6 +
    Math.sin(x * 0.004 - t * 0.7) * 0.3 +
    Math.sin(x * 0.021 + t * 0.4) * 0.1
  );
}

/* ---------- Animation loop ---------- */
let t = 0;

function frame() {
  const size = wrap.clientWidth;
  const center = size * 0.5;

  // Fade previous frame (soft trails)
  ctx.fillStyle = 'rgba(11, 12, 16, 0.12)';
  ctx.fillRect(0, 0, size, size);

  // Wave styling
  ctx.strokeStyle = 'rgba(232, 232, 232, 0.10)';
  ctx.lineWidth = 1.2;

  ctx.beginPath();
  for (let x = 0; x <= size; x += 8) {
    const y = center + organic(x, t) * size * 0.18;
    if (x === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.stroke();

  t += 0.015;
  requestAnimationFrame(frame);
}

// Initial paint
ctx.fillStyle = '#0b0c10';
ctx.fillRect(0, 0, wrap.clientWidth, wrap.clientWidth);
requestAnimationFrame(frame);

/* ============================================================
   Local Time (system time, no API)
   ============================================================ */

function updateTime() {
  const now = new Date();
  const h = now.getHours();
  const m = String(now.getMinutes()).padStart(2, '0');
  timeEl.textContent = `${h}:${m}`;
}

updateTime();
setInterval(updateTime, 60_000);

/* ============================================================
   Local Temperature (IP-based, no permission)
   ============================================================ */

async function loadTemperature() {
  try {
    // 1) Get approximate location from IP
    const loc = await fetch('https://ipapi.co/json/')
      .then(r => r.json());

    // 2) Get current temperature
    const weather = await fetch(
      `https://api.open-meteo.com/v1/forecast?latitude=${loc.latitude}&longitude=${loc.longitude}` +
      `&current_weather=true&temperature_unit=fahrenheit`
    ).then(r => r.json());

    const temp = Math.round(weather.current_weather.temperature);
    tempEl.textContent = `${temp}°F · ${loc.city}`;
  } catch (err) {
    tempEl.textContent = 'Weather unavailable';
  }
}

loadTemperature();
