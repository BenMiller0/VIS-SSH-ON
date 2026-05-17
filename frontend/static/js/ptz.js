/**
 * ptz.js — PTZ camera control
 *
 * All zoom is handled by the backend via picamera2 ScalerCrop.
 * The frontend just fires POST /api/ptz and updates the badge readout.
 */

(() => {
  const THROTTLE_MS = 300;
  const FLASH_MS    = 80;

  let lastSent  = 0;   // timestamp of last command
  let zoomLevel = 1.0;

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
    const now = Date.now();
    if (now - lastSent < THROTTLE_MS) return;
    lastSent = now;

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

  /* ── wire buttons ── */

  function attachBtn(btn) {
    const dir = btn.dataset.dir;
    if (!dir) return;

    btn.addEventListener('click', async () => {
      btn.classList.add('active');
      await sendPTZ(dir);
      setTimeout(() => btn.classList.remove('active'), FLASH_MS * 2);
    });

    btn.addEventListener('touchstart', (e) => {
      e.preventDefault();
      btn.click();
    }, { passive: false });
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
    sendPTZ(dir);
  });

})();