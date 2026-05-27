'use strict';

/**
 * static/js/pages/view_monitor.js
 *
 * Controller for partials/view_monitor.html.
 * Owns the live monitor viewport, connection badge, keypoint readout, and PTZ
 * controls rendered inside the Monitor partial.
 *
 * Architecture notes:
 * - subscribes to core/ws.js events through the shared event bus
 * - renders only DOM inside #monitor-view, except for shared connection status
 * - sends PTZ commands through core/api.js so transport details stay isolated
 */

import { api } from '../core/api.js';
import { on } from '../core/events.js';
import { $, $$, isEditableElement, renderBlobToImages, renderHeatmapCanvases, renderKeypoint, setConnectionStatus } from '../core/ui.js';

const THROTTLE_MS = 300;
const FLASH_MS = 80;

const KEY_MAP = {
    ArrowUp: 'up',
    w: 'up',
    ArrowDown: 'down',
    s: 'down',
    ArrowLeft: 'left',
    a: 'left',
    ArrowRight: 'right',
    d: 'right',
    '=': 'zoom-in',
    '+': 'zoom-in',
    '-': 'zoom-out',
    _: 'zoom-out',
    h: 'home',
};

let lastSent = 0;
let zoomLevel = 1.0;

// -- Live stream rendering ---------------------------------------------------

function monitorRoot() {
    return $('#monitor-view');
}

function renderMonitorFrame(data) {
    const root = monitorRoot();
    if (!root) {
        return;
    }

    renderBlobToImages(data, $$('[data-camera-feed]', root));
}

function renderMonitorHeatmap(data) {
    const root = monitorRoot();
    if (!root) {
        return;
    }

    renderHeatmapCanvases(data.pixels.flat(), $$('[data-heatmap]', root));
}

function renderMonitorKeypoint(data) {
    const root = monitorRoot();
    if (!root) {
        return;
    }

    renderKeypoint(root, data);
}

// -- PTZ controls ------------------------------------------------------------

function updateZoomBadge(zoom) {
    let badge = $('#zoom-badge');

    if (zoom <= 1.0) {
        if (badge) {
            badge.style.opacity = '0';
        }

        return;
    }

    if (!badge) {
        badge = document.createElement('div');
        badge.id = 'zoom-badge';
        badge.style.cssText = [
            'position:absolute',
            'top:10px',
            'left:12px',
            'z-index:5',
            "font-family:var(--font-display,'Orbitron',sans-serif)",
            'font-size:11px',
            'letter-spacing:0.14em',
            'color:var(--green,#00ff88)',
            'text-shadow:0 0 8px var(--green-dim,#00ff8866)',
            'pointer-events:none',
            'opacity:0',
            'transition:opacity 0.2s',
        ].join(';');

        const viewport = $('#image')?.parentElement;
        if (viewport) {
            viewport.appendChild(badge);
        }
    }

    badge.textContent = `${zoom.toFixed(1)}x`;
    badge.style.opacity = '1';
}

async function sendPtz(direction) {
    const now = Date.now();
    if (now - lastSent < THROTTLE_MS) {
        return;
    }

    lastSent = now;

    try {
        const data = await api.sendPtz(direction);
        if (typeof data.zoom === 'number') {
            zoomLevel = data.zoom;
            updateZoomBadge(zoomLevel);
        }
    } catch (error) {
        console.error('PTZ command failed:', error);
    }
}

function attachPtzButton(button) {
    const direction = button.dataset.dir;
    if (!direction) {
        return;
    }

    button.addEventListener('click', async () => {
        button.classList.add('active');
        await sendPtz(direction);
        setTimeout(() => button.classList.remove('active'), FLASH_MS * 2);
    });

    button.addEventListener('touchstart', event => {
        event.preventDefault();
        button.click();
    }, { passive: false });
}

function initPtzControls() {
    document.querySelectorAll('.dpad-btn, .zoom-btn').forEach(attachPtzButton);

    const viewport = $('#image')?.parentElement;
    if (viewport) {
        viewport.addEventListener('wheel', event => {
            event.preventDefault();
            sendPtz(event.deltaY < 0 ? 'zoom-in' : 'zoom-out');
        }, { passive: false });
    }

    document.addEventListener('keydown', event => {
        if (isEditableElement(event.target) || event.repeat) {
            return;
        }

        const direction = KEY_MAP[event.key];
        if (!direction) {
            return;
        }

        event.preventDefault();
        sendPtz(direction);
    });
}

// -- Lifecycle ---------------------------------------------------------------

export function initViewMonitor() {
    on('ws:camera:open', () => setConnectionStatus('Connected', true));
    on('ws:camera:close', () => setConnectionStatus('Disconnected', false));
    on('ws:camera:frame', renderMonitorFrame);
    on('ws:thermal:data', renderMonitorHeatmap);
    on('ws:keypoint:data', renderMonitorKeypoint);

    initPtzControls();
}
