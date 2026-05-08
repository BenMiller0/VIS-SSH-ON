/**
 * ptz.js — PTZ camera control
 *
 * All zoom is handled by the backend via picamera2 ScalerCrop.
 * The frontend just fires POST /api/ptz and updates the badge readout.
 */

(() => {
  const PTZ_REPEAT_MS = 150;
  const FLASH_MS      = 80;

  let repeatTimer = null;
  let activeBtn   = null;
  let zoomLevel   = 1.0;   // mirrors server state for the badge

  /* ── badge ── */

  function updateZoomBadge(zoom) {
    let badge = document.getElementById('zoom-badge');

    if (zoom <= 1.0) {
      if (badge) badge.style.opacity = '0';
      return;
    }

    if (!badge) {
      badge = document.createElement('div');
      badge.id = 'zoom-badge';
      badge.style.cssText = [
        'position:absolute', 'top:10px', 'left:12px', 'z-index:5',
        "font-family:var(--font-display,'Orbitron',sans-serif)",
        'font-size:11px', 'letter-spacing:0.14em',
        'color:var(--green,#00ff88)',
        'text-shadow:0 0 8px var(--green-dim,#00ff8866)',
        'pointer-events:none', 'opacity:0', 'transition:opacity 0.2s',
      ].join(';');
      const viewport = document.getElementById('image')?.parentElement;
      if (viewport) viewport.appendChild(badge);
    }

    badge.textContent   = `${zoom.toFixed(1)}\u00d7`;
    badge.style.opacity = '1';
  }

  /* ── API call ── */

  async function sendPTZ(dir) {
    try {
      const res  = await fetch('/api/ptz', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ dir }),
      });
      const data = await res.json();
      if (typeof data.zoom === 'number') {
        zoomLevel = data.zoom;
        updateZoomBadge(zoomLevel);
      }
    } catch (_) {}
  }

  /* ── hold-to-repeat ── */

  function startRepeat(btn, dir) {
    if (repeatTimer) return;
    activeBtn = btn;
    btn.classList.add('active');
    sendPTZ(dir);
    repeatTimer = setInterval(() => sendPTZ(dir), PTZ_REPEAT_MS);
  }

  function stopRepeat() {
    if (!repeatTimer) return;
    clearInterval(repeatTimer);
    repeatTimer = null;
    if (activeBtn) { activeBtn.classList.remove('active'); activeBtn = null; }
  }

  /* ── wire buttons ── */

  function attachBtn(btn) {
    const dir = btn.dataset.dir;
    if (!dir) return;

    if (dir === 'home') {
      btn.addEventListener('click', async () => {
        btn.classList.add('active');
        await sendPTZ('home');
        setTimeout(() => btn.classList.remove('active'), FLASH_MS * 2);
      });
      return;
    }

    btn.addEventListener('mousedown',   (e) => { e.preventDefault(); startRepeat(btn, dir); });
    btn.addEventListener('touchstart',  (e) => { e.preventDefault(); startRepeat(btn, dir); }, { passive: false });
    btn.addEventListener('mouseleave',  stopRepeat);
    btn.addEventListener('mouseup',     stopRepeat);
    btn.addEventListener('touchend',    stopRepeat);
    btn.addEventListener('touchcancel', stopRepeat);
  }

  document.querySelectorAll('.dpad-btn, .zoom-btn').forEach(attachBtn);

  /* ── scroll-to-zoom on the viewport ── */

  document.addEventListener('DOMContentLoaded', () => {
    const viewport = document.getElementById('image')?.parentElement;
    if (viewport) {
      viewport.addEventListener('wheel', (e) => {
        e.preventDefault();
        sendPTZ(e.deltaY < 0 ? 'zoom-in' : 'zoom-out');
      }, { passive: false });
    }
  });

  /* ── keyboard shortcuts ── */

  const KEY_MAP = {
    ArrowUp: 'up', w: 'up', ArrowDown: 'down', s: 'down',
    ArrowLeft: 'left', a: 'left', ArrowRight: 'right', d: 'right',
    '=': 'zoom-in', '+': 'zoom-in', '-': 'zoom-out', _: 'zoom-out',
    h: 'home',
  };

  document.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
    if (e.repeat) return;
    const dir = KEY_MAP[e.key];
    if (!dir) return;
    e.preventDefault();
    if (dir === 'home') { sendPTZ('home'); return; }
    const btn = document.querySelector(`.dpad-btn[data-dir="${dir}"], .zoom-btn[data-dir="${dir}"]`);
    if (btn && !repeatTimer) startRepeat(btn, dir);
  });

  document.addEventListener('keyup', (e) => {
    const dir = KEY_MAP[e.key];
    if (dir && dir !== 'home') stopRepeat();
  });

})();