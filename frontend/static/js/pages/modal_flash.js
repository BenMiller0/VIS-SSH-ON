'use strict';

/**
 * static/js/pages/modal_flash.js
 *
 * Controller for partials/modal_flash.html.
 * Owns the firmware flashing modal, streamed PlatformIO output, flash button
 * state, and device reset action.
 *
 * Architecture notes:
 * - keeps SSE parsing local because only this modal consumes flash output
 * - uses core/api.js for reset, while flash upload stays as a streaming fetch
 * - modal state is intentionally private to prevent unrelated views from
 *   depending on transient upload internals
 */

import { api } from '../core/api.js';
import { $, setModalVisible } from '../core/ui.js';

let flashing = false;

function getElements() {
    return {
        flashButton: $('#flash-btn'),
        resetButton: $('#reset-btn'),
        modal: $('#flash-modal'),
        output: $('#flash-output'),
        closeButton: $('#flash-close'),
        status: $('#flash-status'),
    };
}

function setFlashState(state) {
    const { flashButton } = getElements();
    if (!flashButton) {
        return;
    }

    const labels = {
        idle: 'FLASH CODE',
        running: 'FLASHING...',
        ok: 'FLASHED',
        fail: 'FAILED',
    };

    flashButton.dataset.state = state;
    flashButton.disabled = state === 'running';
    flashButton.textContent = labels[state];
}

function appendLine(text) {
    const { output } = getElements();
    if (!output) {
        return;
    }

    const line = document.createElement('div');
    line.className = 'fo-line';

    if (/\[SUCCESS\]/.test(text)) {
        line.classList.add('ok');
    } else if (/\[FAILED\]|ERROR/.test(text)) {
        line.classList.add('err');
    } else if (/^Writing at|Uploading|Compiling|Linking|Checking/.test(text.trim())) {
        line.classList.add('dim');
    }

    line.textContent = text;
    output.appendChild(line);
    output.scrollTop = output.scrollHeight;
}

async function runFlash() {
    const { modal, output, status } = getElements();
    if (flashing || !modal || !output || !status) {
        return;
    }

    flashing = true;
    output.innerHTML = '';
    status.textContent = '';
    status.className = 'flash-status';
    setModalVisible(modal, true);
    setFlashState('running');

    try {
        const response = await fetch('/api/flash', { method: 'POST' });
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }

        await readFlashStream(response, status);
    } catch (error) {
        appendLine(`Connection error: ${error.message}`);
        setFlashState('fail');
        status.textContent = 'Connection error';
        status.className = 'flash-status err';
    } finally {
        const { flashButton } = getElements();
        flashing = false;

        if (flashButton?.dataset.state === 'running') {
            setFlashState('fail');
        }
    }
}

async function readFlashStream(response, status) {
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
        const { value, done } = await reader.read();
        if (done) {
            break;
        }

        buffer += decoder.decode(value, { stream: true });
        const frames = buffer.split('\n\n');
        buffer = frames.pop();

        frames.forEach(frame => {
            handleFlashFrame(frame, status);
        });
    }
}

function handleFlashFrame(frame, status) {
    const match = frame.match(/^data: (.*)$/m);
    if (!match) {
        return;
    }

    const text = match[1];
    if (text === '__OK__') {
        setFlashState('ok');
        status.textContent = 'Upload successful';
        status.className = 'flash-status ok';
    } else if (text === '__FAIL__') {
        setFlashState('fail');
        status.textContent = 'Upload failed - see output above';
        status.className = 'flash-status err';
    } else {
        appendLine(text);
    }
}

function closeFlashModal() {
    const { modal } = getElements();
    setModalVisible(modal, false);

    setTimeout(() => {
        if (!flashing) {
            setFlashState('idle');
        }
    }, 3000);
}

async function runReset() {
    try {
        await api.resetDevice();
    } catch (error) {
        console.error('Reset failed:', error);
        alert(`Reset failed: ${error.message}`);
    }
}

export function initModalFlash() {
    const { flashButton, resetButton, closeButton, modal } = getElements();

    flashButton?.addEventListener('click', runFlash);
    resetButton?.addEventListener('click', runReset);
    closeButton?.addEventListener('click', closeFlashModal);
    modal?.addEventListener('click', event => {
        if (event.target === modal) {
            closeFlashModal();
        }
    });

    document.addEventListener('keydown', event => {
        if (event.key === 'Escape' && modal?.style.display !== 'none') {
            closeFlashModal();
        }
    });
}
