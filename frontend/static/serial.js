'use strict';

const serialBtn    = document.getElementById('serial-btn');
const serialModal  = document.getElementById('serial-modal');
const serialOutput = document.getElementById('serial-output');
const serialClose  = document.getElementById('serial-close');
const serialStatus = document.getElementById('serial-status');
const serialBaud   = document.getElementById('serial-baud');
const serialStop   = document.getElementById('serial-stop');
const serialClear  = document.getElementById('serial-clear');
const serialTs     = document.getElementById('serial-timestamps');

let ws = null;

function setSerialStatus(text, cls) {
    serialStatus.textContent = text;
    serialStatus.className   = cls ? 'serial-status ' + cls : 'serial-status';
}

function serialAppendLine(text) {
    const line = document.createElement('div');
    line.className = 'so-line';

    if (serialTs.checked) {
        const ts = document.createElement('span');
        ts.className   = 'so-ts';
        ts.textContent = new Date().toLocaleTimeString('en-GB', { hour12: false }) + ' ';
        line.appendChild(ts);
    }

    const txt = document.createElement('span');
    if (/error|fail/i.test(text))  line.classList.add('err');
    else if (/warn/i.test(text))   line.classList.add('warn');
    txt.textContent = text;
    line.appendChild(txt);

    serialOutput.appendChild(line);
    serialOutput.scrollTop = serialOutput.scrollHeight;
}

function openMonitor() {
    if (ws) return;

    serialOutput.innerHTML = '';
    setSerialStatus('Connecting…', '');
    serialStop.style.display = 'inline';

    const protocol = location.protocol === 'https:' ? 'wss' : 'ws';
    const baud     = serialBaud.value || 115200;
    ws = new WebSocket(`${protocol}://${location.host}/ws/serial?baud=${baud}`);

    ws.onopen    = () => setSerialStatus('Connected · ' + baud + ' baud', 'ok');
    ws.onmessage = (e) => serialAppendLine(e.data);
    ws.onclose   = () => { setSerialStatus('Disconnected', ''); serialStop.style.display = 'none'; ws = null; };
    ws.onerror   = () => { setSerialStatus('Connection error', 'err'); serialStop.style.display = 'none'; ws = null; };
}

function closeMonitor() {
    if (ws) { ws.close(); ws = null; }
}

serialBtn.addEventListener('click', () => { serialModal.style.display = 'flex'; openMonitor(); });
serialStop.addEventListener('click', closeMonitor);
serialClear.addEventListener('click', () => { serialOutput.innerHTML = ''; });
serialClose.addEventListener('click', () => { closeMonitor(); serialModal.style.display = 'none'; });
serialModal.addEventListener('click', (e) => { if (e.target === serialModal) { closeMonitor(); serialModal.style.display = 'none'; } });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && serialModal.style.display !== 'none') { closeMonitor(); serialModal.style.display = 'none'; } });