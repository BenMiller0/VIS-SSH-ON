'use strict';

/**
 * static/js/pages/modal_serial.js
 *
 * Controller for partials/modal_serial.html.
 * Owns the serial monitor modal, baud selection, timestamp formatting, output
 * buffer, and the single active serial WebSocket.
 *
 * Architecture notes:
 * - serial monitoring is modal-scoped, so its socket is deliberately private
 * - opening the modal starts streaming, closing it tears the socket down
 * - avoids the shared ws manager because this connection is user-controlled
 */

import { $, setModalVisible } from '../core/ui.js';

let serialSocket = null;

function getElements() {
    return {
        button: $('#serial-btn'),
        modal: $('#serial-modal'),
        output: $('#serial-output'),
        closeButton: $('#serial-close'),
        status: $('#serial-status'),
        baud: $('#serial-baud'),
        stopButton: $('#serial-stop'),
        clearButton: $('#serial-clear'),
        timestamps: $('#serial-timestamps'),
    };
}

function websocketProtocol() {
    return location.protocol === 'https:' ? 'wss' : 'ws';
}

function setSerialStatus(text, className) {
    const { status } = getElements();
    if (!status) {
        return;
    }

    status.textContent = text;
    status.className = className ? `serial-status ${className}` : 'serial-status';
}

function appendSerialLine(text) {
    const { output, timestamps } = getElements();
    if (!output || !timestamps) {
        return;
    }

    const line = document.createElement('div');
    const content = document.createElement('span');
    line.className = 'so-line';

    if (timestamps.checked) {
        const timestamp = document.createElement('span');
        timestamp.className = 'so-ts';
        timestamp.textContent = `${new Date().toLocaleTimeString('en-GB', { hour12: false })} `;
        line.appendChild(timestamp);
    }

    if (/error|fail/i.test(text)) {
        line.classList.add('err');
    } else if (/warn/i.test(text)) {
        line.classList.add('warn');
    }

    content.textContent = text;
    line.appendChild(content);
    output.appendChild(line);
    output.scrollTop = output.scrollHeight;
}

function openMonitor() {
    const { output, baud, stopButton } = getElements();
    if (serialSocket || !output || !baud || !stopButton) {
        return;
    }

    output.innerHTML = '';
    setSerialStatus('Connecting...', '');
    stopButton.style.display = 'inline';

    const selectedBaud = baud.value || 115200;
    serialSocket = new WebSocket(`${websocketProtocol()}://${location.host}/ws/serial?baud=${selectedBaud}`);
    serialSocket.onopen = () => setSerialStatus(`Connected - ${selectedBaud} baud`, 'ok');
    serialSocket.onmessage = event => appendSerialLine(event.data);
    serialSocket.onclose = () => {
        setSerialStatus('Disconnected', '');
        stopButton.style.display = 'none';
        serialSocket = null;
    };
    serialSocket.onerror = () => {
        setSerialStatus('Connection error', 'err');
        stopButton.style.display = 'none';
        serialSocket = null;
    };
}

function closeMonitor() {
    if (!serialSocket) {
        return;
    }

    serialSocket.close();
    serialSocket = null;
}

function openSerialModal() {
    const { modal } = getElements();
    setModalVisible(modal, true);
    openMonitor();
}

function closeSerialModal() {
    const { modal } = getElements();
    closeMonitor();
    setModalVisible(modal, false);
}

export function initModalSerial() {
    const { button, stopButton, clearButton, closeButton, modal, output } = getElements();

    button?.addEventListener('click', openSerialModal);
    stopButton?.addEventListener('click', closeMonitor);
    clearButton?.addEventListener('click', () => {
        if (output) {
            output.innerHTML = '';
        }
    });
    closeButton?.addEventListener('click', closeSerialModal);
    modal?.addEventListener('click', event => {
        if (event.target === modal) {
            closeSerialModal();
        }
    });

    document.addEventListener('keydown', event => {
        if (event.key === 'Escape' && modal?.style.display !== 'none') {
            closeSerialModal();
        }
    });
}
