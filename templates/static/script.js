// --- Visual feed ---
const img = document.getElementById("feed");
const dot = document.getElementById("dot");
const statusText = document.getElementById("status-text");

const ws = new WebSocket(`ws://${location.host}/ws`);
ws.binaryType = "blob";

ws.onopen = () => {
  dot.classList.add("live");
  statusText.textContent = "LIVE";
};

ws.onmessage = (e) => {
  const url = URL.createObjectURL(e.data);
  img.onload = () => URL.revokeObjectURL(url);
  img.src = url;
  img.classList.add("loaded");
};

ws.onclose = () => {
  dot.classList.remove("live");
  statusText.textContent = "DISCONNECTED";
};

// --- Thermal feed ---
const canvas = document.getElementById("thermal");
const ctx = canvas.getContext("2d");
const tempRange = document.getElementById("temp-range");

canvas.width = 8;
canvas.height = 8;

const SMOOTH = 0.15;
let smoothPixels = new Array(64).fill(25);
let smoothMin = 20, smoothMax = 30;

function ironColor(t) {
  const stops = [
    [0,   [0,   0,   0  ]],
    [0.2, [0,   0,   180]],
    [0.5, [180, 0,   0  ]],
    [0.8, [255, 180, 0  ]],
    [1.0, [255, 255, 255]],
  ];
  for (let i = 0; i < stops.length - 1; i++) {
    const [t0, c0] = stops[i];
    const [t1, c1] = stops[i + 1];
    if (t >= t0 && t <= t1) {
      const f = (t - t0) / (t1 - t0);
      return c0.map((v, j) => Math.round(v + f * (c1[j] - v)));
    }
  }
  return [255, 255, 255];
}

const wsThermal = new WebSocket(`ws://${location.host}/ws/thermal`);

wsThermal.onmessage = (e) => {
  e.data.text().then(text => {
    const { pixels, thermistor } = JSON.parse(text);
    const flat = pixels.flat();

    for (let i = 0; i < 64; i++) {
      smoothPixels[i] += SMOOTH * (flat[i] - smoothPixels[i]);
    }

    const rawMin = Math.min(...flat);
    const rawMax = Math.max(...flat);
    smoothMin += SMOOTH * (rawMin - smoothMin);
    smoothMax += SMOOTH * (rawMax - smoothMax);
    const range = smoothMax - smoothMin || 1;

    const imageData = ctx.createImageData(8, 8);
    for (let i = 0; i < 64; i++) {
      const t = (smoothPixels[i] - smoothMin) / range;
      const [r, g, b] = ironColor(Math.max(0, Math.min(1, t)));
      imageData.data[i * 4 + 0] = r;
      imageData.data[i * 4 + 1] = g;
      imageData.data[i * 4 + 2] = b;
      imageData.data[i * 4 + 3] = 255;
    }
    ctx.putImageData(imageData, 0, 0);

    tempRange.textContent = `AMB ${thermistor}°C · ${smoothMin.toFixed(1)}–${smoothMax.toFixed(1)}°C`;
  });
};