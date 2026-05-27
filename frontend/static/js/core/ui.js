'use strict';

/**
 * static/js/core/ui.js
 *
 * Shared DOM and rendering helpers.
 * This module owns reusable UI primitives that are intentionally not tied to a
 * single partial, such as HTML escaping, modal visibility, status panels,
 * camera frame rendering, thermal heatmaps, and keypoint overlays.
 *
 * Architecture notes:
 * - keeps low-level DOM work out of page controllers
 * - provides safe HTML escaping before modules build template strings
 * - exposes focused helpers rather than a broad UI framework abstraction
 */

export function $(selector, root = document) {
    return root.querySelector(selector);
}

export function $$(selector, root = document) {
    return Array.from(root.querySelectorAll(selector));
}

export function escapeHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

export function isEditableElement(element) {
    if (!element) {
        return false;
    }

    const tagName = element.tagName;
    return tagName === 'INPUT' || tagName === 'TEXTAREA' || element.isContentEditable;
}

export function setModalVisible(modal, visible) {
    if (!modal) {
        return;
    }

    modal.style.display = visible ? 'flex' : 'none';
}

export function setConnectionStatus(text, connected) {
    const statusElement = $('#status');
    if (!statusElement) {
        return;
    }

    statusElement.textContent = text;
    statusElement.className = connected ? 'connected' : 'disconnected';
}

export function setRunStatus(text, statusClass = '') {
    $$('[data-test-status]').forEach(element => {
        element.textContent = text;
        element.className = statusClass;
    });
}

export function setMetrics(html) {
    $$('[data-test-metrics]').forEach(element => {
        element.innerHTML = html;
    });
}

export function setStopVisible(visible) {
    const stopButton = $('#stop-btn');
    if (!stopButton) {
        return;
    }

    stopButton.style.display = visible ? 'inline-flex' : 'none';
}

export function setTestTerminal(text) {
    $$('[data-test-terminal]').forEach(element => {
        element.textContent = text || '';
        element.scrollTop = element.scrollHeight;
    });
}

export function appendTestTerminalOutput(text) {
    if (!text) {
        return;
    }

    $$('[data-test-terminal]').forEach(element => {
        element.textContent += text.endsWith('\n') ? text : `${text}\n`;
        element.scrollTop = element.scrollHeight;
    });
}

export function renderScriptOutput(result) {
    if (!result) {
        return;
    }

    const stdout = result.stdout?.trim();
    const stderr = result.stderr?.trim();
    appendTestTerminalOutput([stdout, stderr].filter(Boolean).join('\n'));
}

export function renderBlobToImages(data, images) {
    const objectUrl = URL.createObjectURL(data);

    if (!images.length) {
        URL.revokeObjectURL(objectUrl);
        return;
    }

    let pending = images.length;
    const releaseObjectUrl = () => {
        pending -= 1;

        if (pending <= 0) {
            URL.revokeObjectURL(objectUrl);
        }
    };

    images.forEach(image => {
        image.onload = () => {
            image.classList.add('loaded');
            releaseObjectUrl();
        };
        image.onerror = releaseObjectUrl;
        image.src = objectUrl;
    });
}

export function renderHeatmapCanvases(pixels, canvases) {
    canvases.forEach(canvas => {
        drawHeatmap(canvas, pixels);
    });
}

export function renderKeypoint(root, data) {
    const text = data.detected
        ? `x ${data.x}, y ${data.y}`
        : 'Not detected';

    $$('[data-keypoint-coords]', root).forEach(element => {
        element.textContent = text;
        element.classList.toggle('missing', !data.detected);
    });

    $$('.vision-overlay', root).forEach(overlay => {
        if (!data.detected || !data.frame_width || !data.frame_height) {
            overlay.hidden = true;
            return;
        }

        overlay.hidden = false;
        overlay.style.setProperty('--keypoint-x', `${(data.x / data.frame_width) * 100}%`);
        overlay.style.setProperty('--keypoint-y', `${(data.y / data.frame_height) * 100}%`);
    });
}

export function applyCameraOrientation(orientation) {
    $$('.viewport, .replay-frame').forEach(surface => {
        surface.classList.toggle('camera-flip-horizontal', orientation.flipHorizontal);
        surface.classList.toggle('camera-flip-vertical', orientation.flipVertical);
    });
}

function drawHeatmap(canvas, pixels) {
    const context = canvas.getContext('2d');
    const cellSize = canvas.width / 8;
    const minTemp = Math.min(...pixels);
    const maxTemp = Math.max(...pixels);
    const range = maxTemp - minTemp || 1;

    for (let row = 0; row < 8; row += 1) {
        for (let col = 0; col < 8; col += 1) {
            const temp = pixels[row * 8 + col];
            const normalized = (temp - minTemp) / range;
            const red = Math.floor(255 * Math.min(1, normalized * 2));
            const green = Math.floor(255 * Math.max(0, (normalized - 0.5) * 2));
            const blue = Math.floor(255 * (1 - normalized));

            context.fillStyle = `rgb(${red},${green},${blue})`;
            context.fillRect(col * cellSize, row * cellSize, cellSize, cellSize);
        }
    }
}
