'use strict';

// ── DOM refs ──────────────────────────────────────────────────────────────────
const modal         = document.getElementById('editor-modal');
const screenPicker  = document.getElementById('screen-picker');
const screenEditor  = document.getElementById('screen-editor');
const fileListEl    = document.getElementById('file-list');
const barFilename   = document.getElementById('bar-filename');
const saveBtn       = document.getElementById('save-btn');
const saveStatus    = document.getElementById('save-status');
const openBtn       = document.getElementById('editor-btn');

// ── State ─────────────────────────────────────────────────────────────────────
let cm          = null;   // CodeMirror instance
let currentFile = '';
let unsaved     = false;

// ── Screen helpers ────────────────────────────────────────────────────────────
function showModal()  { modal.style.display = 'flex'; }
function hideModal()  { modal.style.display = 'none'; }

function showPicker() {
  screenPicker.style.display = 'flex';
  screenEditor.style.display = 'none';
}

function showEditor() {
  screenPicker.style.display = 'none';
  screenEditor.style.display = 'flex';
  // Give the DOM a tick before refreshing CodeMirror
  requestAnimationFrame(() => cm && cm.refresh());
}

// ── Open / close modal ────────────────────────────────────────────────────────
async function openModal() {
  showModal();
  showPicker();
  await loadFileList();
}

function closeModal() {
  if (unsaved && !confirm(`Discard unsaved changes to "${currentFile}"?`)) return;
  hideModal();
  unsaved = false;
}

// ── File list (Screen A) ──────────────────────────────────────────────────────
const EXCLUDE = new Set(['.pio', '.git', '__pycache__', 'node_modules', '.venv', '.idea', '.vscode']);

function isExcluded(path) {
  return path.split(/[/\\]/).some(seg => EXCLUDE.has(seg) || seg.startsWith('.pio'));
}

async function loadFileList() {
  fileListEl.innerHTML = '<p class="fl-msg">Loading…</p>';
  try {
    const res   = await fetch('/api/files');
    const data  = await res.json();
    const files = data.files.filter(f => !isExcluded(f)).sort();

    if (!files.length) {
      fileListEl.innerHTML = '<p class="fl-msg">No files found.</p>';
      return;
    }

    // Group by directory
    const groups = {};
    for (const f of files) {
      const norm  = f.replace(/\\/g, '/');
      const slash = norm.lastIndexOf('/');
      const dir   = slash >= 0 ? norm.slice(0, slash) : '';
      const name  = norm.slice(slash + 1);
      (groups[dir] ??= []).push({ name, path: norm });
    }

    fileListEl.innerHTML = '';
    for (const [dir, items] of Object.entries(groups)) {
      const group = document.createElement('div');
      group.className = 'fl-group';

      if (dir) {
        const lbl = document.createElement('div');
        lbl.className = 'fl-dir';
        lbl.textContent = dir + '/';
        group.appendChild(lbl);
      }

      for (const { name, path } of items) {
        const ext = name.includes('.') ? name.split('.').pop().toUpperCase() : '?';
        const row = document.createElement('button');
        row.className = 'fl-row';
        row.innerHTML =
          `<span class="fl-ext">${ext}</span>` +
          `<span class="fl-name">${name}</span>` +
          `<span class="fl-arrow">OPEN →</span>`;
        row.addEventListener('click', () => openFile(path));
        group.appendChild(row);
      }

      fileListEl.appendChild(group);
    }
  } catch (err) {
    fileListEl.innerHTML = '<p class="fl-msg err">Error loading files.</p>';
    console.error(err);
  }
}

// ── Editor (Screen B) ─────────────────────────────────────────────────────────
const EXT_MODE = {
  cpp:'text/x-c++src', cc:'text/x-c++src', cxx:'text/x-c++src',
  c:  'text/x-csrc',
  h:  'text/x-c++src', hpp:'text/x-c++src',
  ino:'text/x-c++src',
  py: 'text/x-python',
  js: 'text/javascript',
  json:'application/json',
};

async function openFile(filePath) {
  try {
    const res  = await fetch(`/api/files/${encodeURIComponent(filePath)}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();

    // Init CodeMirror once
    if (!cm) {
      cm = CodeMirror.fromTextArea(document.getElementById('code-editor'), {
        lineNumbers:       true,
        theme:             'dracula',
        tabSize:           4,
        indentUnit:        4,
        indentWithTabs:    false,
        lineWrapping:      false,
        matchBrackets:     true,
        autoCloseBrackets: true,
        extraKeys: {
          'Ctrl-S': () => saveFile(),
          'Cmd-S':  () => saveFile(),
          'Tab': c => c.somethingSelected()
            ? c.indentSelection('add')
            : c.replaceSelection('    ', 'end'),
        },
      });
      cm.on('change', () => { unsaved = true; refreshSaveBtn(); });
    }

    const ext = filePath.split('.').pop().toLowerCase();
    cm.setOption('mode', EXT_MODE[ext] ?? 'text/x-c++src');
    cm.setValue(data.content);
    cm.clearHistory();

    currentFile = filePath;
    unsaved     = false;
    refreshSaveBtn();
    barFilename.textContent = filePath;
    showEditor();

  } catch (err) {
    alert('Could not open file: ' + err.message);
    console.error(err);
  }
}

async function saveFile() {
  if (!currentFile || !cm) return;
  saveBtn.disabled = true;
  try {
    const res = await fetch(`/api/files/${encodeURIComponent(currentFile)}`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ content: cm.getValue() }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    unsaved = false;
    refreshSaveBtn();
    flash('Saved ✓', 'ok');
  } catch (err) {
    flash('Save failed', 'err');
    console.error(err);
  } finally {
    saveBtn.disabled = false;
  }
}

function refreshSaveBtn() {
  saveBtn.classList.toggle('dirty', unsaved);
  saveBtn.textContent = unsaved ? '● SAVE' : 'SAVE';
}

let flashTimer;
function flash(msg, type) {
  saveStatus.textContent = msg;
  saveStatus.className   = 'save-status ' + type;
  clearTimeout(flashTimer);
  flashTimer = setTimeout(() => { saveStatus.textContent = ''; saveStatus.className = 'save-status'; }, 2500);
}

// ── Event wiring ──────────────────────────────────────────────────────────────
openBtn.addEventListener('click', openModal);

document.getElementById('close-picker').addEventListener('click', closeModal);
document.getElementById('close-editor').addEventListener('click', closeModal);

document.getElementById('back-btn').addEventListener('click', () => {
  if (unsaved && !confirm(`Discard unsaved changes to "${currentFile}"?`)) return;
  unsaved = false;
  refreshSaveBtn();
  showPicker();
});

saveBtn.addEventListener('click', saveFile);

// Click outside shell → close
modal.addEventListener('click', e => { if (e.target === modal) closeModal(); });

// Keyboard
document.addEventListener('keydown', e => {
  if (modal.style.display === 'none') return;
  if ((e.ctrlKey || e.metaKey) && e.key === 's') { e.preventDefault(); saveFile(); }
  if (e.key === 'Escape') closeModal();
});


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