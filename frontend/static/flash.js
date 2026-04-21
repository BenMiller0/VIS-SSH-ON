'use strict';

// ── DOM ───────────────────────────────────────────────────────────────────────
const flashBtn    = document.getElementById('flash-btn');
const flashModal  = document.getElementById('flash-modal');
const flashOutput = document.getElementById('flash-output');
const flashClose  = document.getElementById('flash-close');
const flashStatus = document.getElementById('flash-status');

let flashing = false;

// ── Helpers ───────────────────────────────────────────────────────────────────
function setFlashState(state) {
  // state: 'idle' | 'running' | 'ok' | 'fail'
  flashBtn.dataset.state = state;
  flashBtn.disabled = (state === 'running');

  const labels = { idle: '⬡ FLASH CODE', running: '◌ FLASHING…', ok: '✓ FLASHED', fail: '✕ FAILED' };
  flashBtn.textContent = labels[state];
}

function appendLine(text) {
  const line = document.createElement('div');
  line.className = 'fo-line';

  // Colour-code key lines
  if (/\[SUCCESS\]/.test(text))        line.classList.add('ok');
  else if (/\[FAILED\]|ERROR/.test(text)) line.classList.add('err');
  else if (/^Writing at|Uploading|Compiling|Linking|Checking/.test(text.trim()))
                                        line.classList.add('dim');

  line.textContent = text;
  flashOutput.appendChild(line);
  flashOutput.scrollTop = flashOutput.scrollHeight;
}

// ── Flash ─────────────────────────────────────────────────────────────────────
async function runFlash() {
  if (flashing) return;
  flashing = true;

  // Open modal & reset
  flashOutput.innerHTML = '';
  flashStatus.textContent = '';
  flashStatus.className = 'flash-status';
  flashModal.style.display = 'flex';
  setFlashState('running');

  try {
    const res = await fetch('/api/flash', { method: 'POST' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const reader  = res.body.getReader();
    const decoder = new TextDecoder();
    let   buf     = '';

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;

      buf += decoder.decode(value, { stream: true });

      // SSE frames: split on double-newline
      const frames = buf.split('\n\n');
      buf = frames.pop(); // last may be incomplete

      for (const frame of frames) {
        const match = frame.match(/^data: (.*)$/m);
        if (!match) continue;
        const text = match[1];

        if (text === '__OK__') {
          setFlashState('ok');
          flashStatus.textContent = 'Upload successful';
          flashStatus.className   = 'flash-status ok';
        } else if (text === '__FAIL__') {
          setFlashState('fail');
          flashStatus.textContent = 'Upload failed — see output above';
          flashStatus.className   = 'flash-status err';
        } else {
          appendLine(text);
        }
      }
    }
  } catch (err) {
    appendLine('Connection error: ' + err.message);
    setFlashState('fail');
    flashStatus.textContent = 'Connection error';
    flashStatus.className   = 'flash-status err';
  } finally {
    flashing = false;
    // If state is still 'running' (no __OK__/__FAIL__ received), mark fail
    if (flashBtn.dataset.state === 'running') setFlashState('fail');
  }
}

function closeFlashModal() {
  flashModal.style.display = 'none';
  // Keep button colour for a few seconds so user sees result, then reset
  setTimeout(() => {
    if (!flashing) setFlashState('idle');
  }, 3000);
}

// ── Wiring ────────────────────────────────────────────────────────────────────
flashBtn.addEventListener('click', runFlash);
flashClose.addEventListener('click', closeFlashModal);
flashModal.addEventListener('click', e => { if (e.target === flashModal) closeFlashModal(); });
document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && flashModal.style.display !== 'none') closeFlashModal();
});