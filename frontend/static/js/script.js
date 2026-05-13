'use strict';

let wsCamera, wsThermal, wsTest;
let currentPixels = [];
let currentRunId = null;
let selectedConfig = null;
let selectedRun = null;
let configs = [];
let runs = [];
let currentTypeFilter = 'all';
let currentStatusFilter = 'all';
let lastMetric = null;
let lastFailureByRun = {};
const replayState = {
    runId: null,
    frames: [],
    index: 0,
    timer: null,
    cache: new Map(),
};

const protocol = location.protocol === 'https:' ? 'wss' : 'ws';

const $ = selector => document.querySelector(selector);
const $$ = selector => Array.from(document.querySelectorAll(selector));

function escapeHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

function showView(viewId) {
    $$('.app-view').forEach(view => view.classList.toggle('active', view.id === viewId));
    $$('.nav-tab').forEach(tab => {
        tab.classList.toggle('active', tab.dataset.viewTarget === viewId);
    });

    if (viewId === 'configs-view') loadConfigs();
    if (viewId === 'reports-view') loadReports();
    if (viewId === 'replay-view') renderReplay(selectedRun);
}

function setStatus(text, connected) {
    const statusEl = $('#status');
    if (!statusEl) return;
    statusEl.textContent = text;
    statusEl.className = connected ? 'connected' : 'disconnected';
}

function setRunStatus(text, statusClass = '') {
    $$('[data-test-status]').forEach(el => {
        el.textContent = text;
        el.className = statusClass;
    });
}

function setMetrics(html) {
    $$('[data-test-metrics]').forEach(el => {
        el.innerHTML = html;
    });
}

function setStopVisible(visible) {
    const stopBtn = $('#stop-btn');
    if (stopBtn) stopBtn.style.display = visible ? 'inline-flex' : 'none';
}

function updateSelectedConfigSummary() {
    const name = selectedConfig?.name ?? 'No test selected';
    const params = selectedConfig?.parameters ?? {};
    const expected = params.expected_direction
        ? params.expected_direction.replace(/^\w/, c => c.toUpperCase())
        : selectedConfig?.type === 'thermal'
            ? 'Thermal threshold'
            : '-';

    const monitorSelected = $('#monitor-selected-test');
    const runTitle = $('#run-title');
    const runExpected = $('#run-expected-direction');
    const runDuration = $('#run-duration');

    if (monitorSelected) monitorSelected.textContent = name;
    if (runTitle) runTitle.textContent = name;
    if (runExpected) runExpected.textContent = expected;
    if (runDuration && params.duration_seconds) runDuration.value = params.duration_seconds;
}

function renderTest(data) {
    if (data.type === 'start') {
        currentRunId = data.run_id;
        lastMetric = null;
        setStopVisible(true);
        setRunStatus('RUNNING...', 'running');
        setMetrics(`<div class="metric-line">Run #${escapeHtml(currentRunId)} started</div>`);
        return;
    }

    if (data.type === 'metric') {
        lastMetric = data;
        const testType = selectedConfig?.type;
        const metricRows = [];

        if (testType === 'thermal' && data.temperature !== undefined) {
            metricRows.push(`<div class="metric-line"><span>Temp</span><strong>${escapeHtml(data.temperature)} deg C</strong></div>`);
        }
        if (testType === 'vision') {
            if (data.expected_direction || data.observed_direction) {
                metricRows.push(
                    `<div class="metric-line"><span>Expected</span><strong>${escapeHtml(data.expected_direction ?? '-')}</strong></div>`,
                    `<div class="metric-line"><span>Observed</span><strong>${escapeHtml(data.observed_direction ?? '-')}</strong></div>`
                );
            }
            if (data.confidence !== undefined) {
                metricRows.push(`<div class="metric-line"><span>Confidence</span><strong>${escapeHtml(data.confidence)}</strong></div>`);
            }
        }
        // For custom, no metrics during execution

        setMetrics(metricRows.join('') || '<div class="metric-line">Waiting for metrics...</div>');
        return;
    }

    if (data.type === 'result') {
        const finishedRunId = data.run_id ?? currentRunId;
        setStopVisible(false);
        setRunStatus(data.status === 'killed' ? 'STOPPED' : String(data.status).toUpperCase(), data.status);

        if (data.status === 'fail') {
            lastFailureByRun[finishedRunId] = {
                reason: data.failure_reason,
                failure: data.failure,
                thresholds: data.thresholds,
                metric: lastMetric,
                artifact: data.artifact,
            };

            const allowedThresholdKeys = new Set(['max_temp']);
            const thresholdRows = data.thresholds
                ? Object.entries(data.thresholds)
                    .filter(([key]) => allowedThresholdKeys.has(key))
                    .map(([key, value]) => `<div class="metric-line"><span>${escapeHtml(key)}</span><strong>${escapeHtml(value)}</strong></div>`)
                    .join('')
                : '';

            setMetrics(
                `<div class="metric-line fail-line"><span>Reason</span><strong>${escapeHtml(data.failure_reason)}</strong></div>` +
                thresholdRows
            );
        } else if (data.status === 'killed') {
            setMetrics('<div class="metric-line"><span>Stopped</span><strong>Manual termination</strong></div>');
        }

        if (!data.run_id || data.run_id === currentRunId) currentRunId = null;
        loadReports();
    }
}

function connectTest() {
    wsTest = new WebSocket(`${protocol}://${window.location.host}/ws/test`);

    wsTest.onopen = () => console.log('Test WS connected');
    wsTest.onclose = () => {
        console.log('Test WS disconnected');
        setTimeout(connectTest, 1000);
    };
    wsTest.onmessage = event => {
        try {
            renderTest(JSON.parse(event.data));
        } catch (err) {
            console.error('Test error:', err);
        }
    };
}

function drawHeatmap(canvas, pixels) {
    const ctx = canvas.getContext('2d');
    const cellSize = canvas.width / 8;
    const minTemp = Math.min(...pixels);
    const maxTemp = Math.max(...pixels);
    const range = maxTemp - minTemp || 1;

    for (let row = 0; row < 8; row++) {
        for (let col = 0; col < 8; col++) {
            const temp = pixels[row * 8 + col];
            const norm = (temp - minTemp) / range;
            const r = Math.floor(255 * Math.min(1, norm * 2));
            const g = Math.floor(255 * Math.max(0, (norm - 0.5) * 2));
            const b = Math.floor(255 * (1 - norm));
            ctx.fillStyle = `rgb(${r},${g},${b})`;
            ctx.fillRect(col * cellSize, row * cellSize, cellSize, cellSize);
        }
    }
}

function renderHeatmap(pixels) {
    $$('[data-heatmap]').forEach(canvas => drawHeatmap(canvas, pixels));
}

function connectThermal() {
    wsThermal = new WebSocket(`${protocol}://${window.location.host}/ws/thermal`);

    wsThermal.onopen = () => console.log('Thermal WS connected');
    wsThermal.onclose = () => {
        console.log('Thermal WS disconnected');
        setTimeout(connectThermal, 1000);
    };
    wsThermal.onmessage = event => {
        try {
            const data = JSON.parse(event.data);
            currentPixels = data.pixels.flat();
            renderHeatmap(currentPixels);
        } catch (err) {
            console.error('Thermal error:', err);
        }
    };
}

function renderCamera(data) {
    const objectURL = URL.createObjectURL(data);
    const images = $$('[data-camera-feed]');

    if (!images.length) {
        URL.revokeObjectURL(objectURL);
        return;
    }

    let pending = images.length;
    images.forEach(image => {
        image.onload = () => {
            image.classList.add('loaded');
            pending -= 1;
            if (pending <= 0) URL.revokeObjectURL(objectURL);
        };
        image.src = objectURL;
    });
}

function connectCamera() {
    wsCamera = new WebSocket(`${protocol}://${window.location.host}/ws`);
    wsCamera.binaryType = 'blob';

    wsCamera.onopen = () => {
        console.log('Camera WS connected');
        setStatus('Connected', true);
    };
    wsCamera.onclose = () => {
        console.log('Camera WS disconnected');
        setStatus('Disconnected', false);
        setTimeout(connectCamera, 1000);
    };
    wsCamera.onmessage = event => {
        try {
            renderCamera(event.data);
        } catch (err) {
            console.error('Camera error:', err);
        }
    };
}

function emptyConfig() {
    return {
        name: '',
        description: '',
        type: '',
        parameters: {},
    };
}

function updateConfigTypeFields(type) {
    const visionSection = $('#vision-fields');
    const thermalSection = $('#thermal-fields');
    const customSection = $('#custom-fields');
    const typeNotice = $('#config-type-required');

    if (visionSection) visionSection.classList.toggle('field-hidden', type !== 'vision');
    if (thermalSection) thermalSection.classList.toggle('field-hidden', type !== 'thermal');
    if (customSection) customSection.classList.toggle('field-hidden', type !== 'custom');
    if (typeNotice) typeNotice.style.display = type ? 'none' : 'block';
}

function fillConfigForm(config = emptyConfig()) {
    const params = config.parameters ?? {};
    $('#config-name').value = config.name ?? '';
    $('#config-description').value = config.description ?? '';
    $('#config-type').value = config.type ?? '';
    $('#config-expected-direction').value = params.expected_direction ?? 'counterclockwise';
    $('#config-max-temperature').value = params.max_temp ?? '';
    updateConfigTypeFields(config.type ?? '');
}

function collectConfigForm() {
    const type = $('#config-type').value;
    const params = {};

    if (type === 'vision') {
        params.expected_direction = $('#config-expected-direction').value;
        params.metric = 'arm_direction';
        params.include_thermal = 'true';
    } else if (type === 'thermal') {
        const maxTemp = parseFloat($('#config-max-temperature').value);
        params.max_temp = String(Number.isFinite(maxTemp) ? maxTemp : 75);
        params.metric = 'thermal';
        params.include_thermal = 'true';
    } else {
        params.metric = 'custom';
        params.include_thermal = 'true';
    }

    return {
        name: $('#config-name').value.trim() || 'Unnamed Test',
        description: $('#config-description').value.trim(),
        type,
        parameters: params,
    };
}

async function loadConfigs() {
    const list = $('#config-list');
    if (!list) return;

    try {
        configs = await fetch('/api/configs').then(r => {
            if (!r.ok) throw new Error(`HTTP ${r.status}`);
            return r.json();
        });

        if (selectedConfig) {
            selectedConfig = configs.find(config => config.id === selectedConfig.id) ?? selectedConfig;
            if (selectedConfig?.id) fillConfigForm(selectedConfig);
        }

        renderConfigList();
        updateSelectedConfigSummary();
    } catch (err) {
        list.innerHTML = '<div class="empty-state err">Could not load configs.</div>';
        console.error(err);
    }
}

function renderConfigList() {
    const list = $('#config-list');
    if (!list) return;

    list.innerHTML = '';
    if (!configs.length) {
        list.innerHTML = '<div class="empty-state">No configs saved yet.</div>';
        return;
    }

    configs.forEach(config => {
        const row = document.createElement('button');
        row.type = 'button';
        row.className = 'config-row';
        row.classList.toggle('selected', selectedConfig?.id === config.id);

        const params = config.parameters ?? {};
        const metric = params.metric ?? config.type;
        const expected = params.expected_direction ?? 'threshold';

        row.innerHTML = `
            <span class="row-main">
                <strong>${escapeHtml(config.name)}</strong>
                <small>${escapeHtml(config.description || 'No description')}</small>
            </span>
            <span class="row-meta">
                <span>${escapeHtml(metric)}</span>
                <span>${escapeHtml(expected)}</span>
            </span>
        `;

        row.addEventListener('click', () => {
            selectedConfig = config;
            fillConfigForm(config);
            renderConfigList();
            updateSelectedConfigSummary();
        });

        list.appendChild(row);
    });
}

async function deleteConfig() {
    if (!selectedConfig?.id) return;
    if (!confirm(`Delete config "${selectedConfig.name}"? This cannot be undone.`)) return;

    try {
        const res = await fetch(`/api/configs/${selectedConfig.id}`, { method: 'DELETE' });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        selectedConfig = null;
        fillConfigForm(emptyConfig());
        renderConfigList();
        updateSelectedConfigSummary();
        await loadConfigs();
        return true;
    } catch (err) {
        console.error('Delete failed:', err);
        alert('Could not delete config.');
        return false;
    }
}

async function saveConfig() {
    const status = $('#config-save-status');
    const payload = collectConfigForm();

    if (status) {
        status.textContent = 'Saving...';
        status.className = 'inline-status';
    }

    if (!payload.type) {
        if (status) {
            status.textContent = 'Please select a test type.';
            status.className = 'inline-status err';
        }
        return null;
    }

    try {
        const editingId = selectedConfig?.id;
        const res = await fetch(editingId ? `/api/configs/${editingId}` : '/api/configs', {
            method: editingId ? 'PUT' : 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);

        selectedConfig = await res.json();
        await loadConfigs();

        if (status) {
            status.textContent = `Saved #${selectedConfig.id}`;
            status.className = 'inline-status ok';
        }

        return selectedConfig;
    } catch (err) {
        if (status) {
            status.textContent = 'Save failed';
            status.className = 'inline-status err';
        }
        console.error(err);
        return null;
    }
}

async function startSelectedTest() {
    let config = selectedConfig;
    if (!config) config = await saveConfig();
    if (!config) return;

    selectedConfig = config;
    updateSelectedConfigSummary();
    showView('run-view');
    setRunStatus('STARTING...', 'running');
    setMetrics('<div class="metric-line">Waiting for first metric...</div>');

    const durationRaw = parseInt($('#run-duration').value, 10);
    const duration = durationRaw > 0 ? durationRaw : null;

    fetch(`/api/tests/${config.id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ duration }),
    }).then(res => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
    }).then(data => {
        if (data.run_id && !currentRunId) {
            currentRunId = data.run_id;
            setStopVisible(true);
        }
    }).catch(err => {
        if (!currentRunId) {
            setRunStatus('ERROR', 'fail');
            setMetrics(`<div class="metric-line fail-line"><span>Error</span><strong>${escapeHtml(err.message)}</strong></div>`);
        }
        console.error(err);
    });
}

async function stopTest() {
    if (!currentRunId) return;
    await fetch(`/api/tests/${currentRunId}/stop`, { method: 'POST' });
}

async function loadReports() {
    const list = $('#reports-list');
    if (!list) return;

    try {
        runs = await fetch('/api/tests').then(r => {
            if (!r.ok) throw new Error(`HTTP ${r.status}`);
            return r.json();
        });
        renderReports();
    } catch (err) {
        list.innerHTML = '<div class="empty-state err">Could not load reports.</div>';
        console.error(err);
    }
}

function deleteReport(runId) {
    if (!confirm(`Delete report #${runId}?`)) return;

    fetch(`/api/tests/${runId}`, { method: 'DELETE' })
        .then(res => {
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            return res.json();
        })
        .then(() => {
            if (selectedRun?.id === runId) {
                selectedRun = null;
            }
            loadReports();
        })
        .catch(err => {
            console.error('Could not delete report:', err);
            alert('Could not delete report.');
        });
}

function configNameForRun(run) {
    return configs.find(config => config.id === run.test_config_id)?.name ?? `Config #${run.test_config_id}`;
}

function renderReports() {
    const list = $('#reports-list');
    if (!list) return;

    list.innerHTML = '';
    if (!runs.length) {
        list.innerHTML = '<div class="empty-state">No test runs recorded yet.</div>';
        return;
    }

    const filteredRuns = runs.filter(run => {
        if (currentTypeFilter !== 'all') {
            const config = configs.find(c => c.id === run.test_config_id);
            if (config?.type !== currentTypeFilter) return false;
        }
        if (currentStatusFilter !== 'all' && run.status !== currentStatusFilter) {
            return false;
        }
        return true;
    });

    if (!filteredRuns.length) {
        list.innerHTML = '<div class="empty-state">No matching test runs.</div>';
        return;
    }

    filteredRuns.forEach(run => {
        const row = document.createElement('button');
        row.type = 'button';
        row.className = `report-row ${run.status}`;

        row.innerHTML = `
            <span class="row-main">
                <strong>Run #${escapeHtml(run.id)} - ${escapeHtml(configNameForRun(run))}</strong>
                <small>${escapeHtml(run.failure_reason || run.start_time || '')}</small>
            </span>
            <span class="row-meta">
                <span>${escapeHtml(run.status)}</span>
                <span>${escapeHtml(run.end_time ? 'complete' : 'active')}</span>
                <button type="button" class="report-delete-btn">DELETE</button>
            </span>
        `;

        row.addEventListener('click', () => {
            selectedRun = run;
            renderReplay(run);
            showView('replay-view');
        });

        const deleteBtn = row.querySelector('.report-delete-btn');
        deleteBtn?.addEventListener('click', event => {
            event.stopPropagation();
            deleteReport(run.id);
        });

        list.appendChild(row);
    });
}

function stopReplayPlayback() {
    if (replayState.timer) {
        clearInterval(replayState.timer);
        replayState.timer = null;
    }
}

function resetReplayState(runId = null) {
    stopReplayPlayback();
    replayState.runId = runId;
    replayState.frames = [];
    replayState.index = 0;
    replayState.cache.clear();
}

function ensureReplayShell(frame) {
    let image = $('#replay-image');
    let badge = $('#replay-badge');

    if (!image || !badge) {
        frame.innerHTML = `
            <img id="replay-image" class="replay-image" alt="Replay frame" />
            <div id="replay-badge" class="replay-badge"></div>
            <div id="replay-loading" class="replay-loading">Loading frame...</div>
        `;
        image = $('#replay-image');
        badge = $('#replay-badge');
    }

    return {
        image,
        badge,
        loading: $('#replay-loading'),
    };
}

function preloadReplayFrame(item) {
    if (!item?.url) return Promise.resolve(null);
    if (replayState.cache.has(item.url)) return replayState.cache.get(item.url);

    const loadPromise = new Promise(resolve => {
        const image = new Image();
        image.onload = () => resolve(image);
        image.onerror = () => resolve(null);
        image.src = item.url;
    });

    replayState.cache.set(item.url, loadPromise);
    return loadPromise;
}

function warmReplayCache(index) {
    for (let offset = 1; offset <= 3; offset += 1) {
        const next = replayState.frames[(index + offset) % replayState.frames.length];
        preloadReplayFrame(next);
    }
}

async function showReplayFrame(index) {
    const frame = $('#replay-frame');
    const scrubber = $('#replay-scrubber');
    if (!frame || !replayState.frames.length) return;

    const clamped = Math.max(0, Math.min(replayState.frames.length - 1, index));
    const item = replayState.frames[clamped];
    const { image, badge, loading } = ensureReplayShell(frame);

    if (loading && !image.src) loading.classList.add('active');

    const loaded = await preloadReplayFrame(item);
    if (replayState.frames[clamped] !== item) return;

    if (loaded) {
        image.src = loaded.src;
        image.classList.add('loaded');
        replayState.index = clamped;
        if (scrubber) scrubber.value = String(clamped);
        if (badge) badge.textContent = item.timestamp ?? '';
        if (loading) loading.classList.remove('active');
        warmReplayCache(clamped);
    } else if (loading) {
        loading.textContent = 'Frame failed to load';
        loading.classList.add('active');
    }
}

function playReplay() {
    if (replayState.timer || replayState.frames.length <= 1) return;

    replayState.timer = setInterval(() => {
        const nextIndex = replayState.index + 1 >= replayState.frames.length
            ? 0
            : replayState.index + 1;
        showReplayFrame(nextIndex);
    }, 140);
}

function renderReplay(run) {
    const title = $('#replay-title');
    const frame = $('#replay-frame');
    const notes = $('#replay-notes');
    const timeline = $('#replay-timeline');
    const scrubber = $('#replay-scrubber');
    const playBtn = $('#replay-play-btn');
    const pauseBtn = $('#replay-pause-btn');

    if (!title || !frame || !notes || !timeline) return;

    if (!run) {
        resetReplayState();
        title.textContent = 'Replay';
        frame.innerHTML = '<span>No replay selected</span>';
        notes.textContent = 'Select a failed report to inspect.';
        timeline.innerHTML = '';
        if (scrubber) scrubber.disabled = true;
        if (playBtn) playBtn.disabled = true;
        if (pauseBtn) pauseBtn.disabled = true;
        return;
    }

    resetReplayState(run.id);
    const failure = lastFailureByRun[run.id];
    title.textContent = `Run #${run.id}`;
    frame.innerHTML = run.status === 'fail'
        ? '<span>Loading replay...</span>'
        : '<span>No failure replay for this run</span>';

    const metricRows = failure?.metric
        ? Object.entries(failure.metric)
            .filter(([key]) => key !== 'type')
            .map(([key, value]) => `<div class="metric-line"><span>${escapeHtml(key)}</span><strong>${escapeHtml(value)}</strong></div>`)
            .join('')
        : '';

    notes.innerHTML = `
        <div class="metric-line"><span>Status</span><strong>${escapeHtml(run.status)}</strong></div>
        <div class="metric-line"><span>Reason</span><strong>${escapeHtml(run.failure_reason || failure?.reason || '-')}</strong></div>
        ${metricRows}
    `;

    const events = [
        ['Start', run.start_time],
        ['Failure', run.failure_reason || failure?.reason || (run.status === 'fail' ? 'Failed' : '-')],
        ['End', run.end_time || '-'],
    ];

    timeline.innerHTML = events
        .map(([label, value]) => `<div class="timeline-item"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`)
        .join('');

    if (scrubber) scrubber.disabled = true;
    if (playBtn) playBtn.disabled = true;
    if (pauseBtn) pauseBtn.disabled = true;

    if (run.status === 'fail') loadReplayArtifact(run.id);
}

async function loadReplayArtifact(runId) {
    const frame = $('#replay-frame');
    const notes = $('#replay-notes');
    const timeline = $('#replay-timeline');
    const scrubber = $('#replay-scrubber');
    const playBtn = $('#replay-play-btn');
    const pauseBtn = $('#replay-pause-btn');
    if (!frame || !notes || !timeline || !scrubber || !playBtn || !pauseBtn) return;

    try {
        const [report, replay] = await Promise.all([
            fetch(`/api/tests/${runId}/report`).then(r => r.ok ? r.json() : null),
            fetch(`/api/tests/${runId}/replay`).then(r => r.ok ? r.json() : null),
        ]);

        const failureEvent = report?.events?.find(event => event.event_type === 'failure');
        if (failureEvent?.payload) {
            notes.innerHTML = Object.entries(failureEvent.payload)
                .map(([key, value]) => `<div class="metric-line"><span>${escapeHtml(key)}</span><strong>${escapeHtml(value)}</strong></div>`)
                .join('');
        }

        if (!replay?.available || !replay.frames?.length) {
            frame.innerHTML = '<span>No replay frames saved for this run</span>';
            return;
        }

        replayState.runId = runId;
        replayState.frames = replay.frames;
        replayState.index = 0;
        replayState.cache.clear();
        ensureReplayShell(frame);

        scrubber.min = '0';
        scrubber.max = String(replay.frames.length - 1);
        scrubber.disabled = false;
        playBtn.disabled = false;
        pauseBtn.disabled = false;
        scrubber.oninput = () => {
            stopReplayPlayback();
            showReplayFrame(parseInt(scrubber.value, 10));
        };
        playBtn.onclick = playReplay;
        pauseBtn.onclick = stopReplayPlayback;

        timeline.innerHTML = replay.events
            .map(event => `<div class="timeline-item"><span>${escapeHtml(event.event_type)}</span><strong>${escapeHtml(event.message || event.timestamp)}</strong></div>`)
            .join('');

        await Promise.all(replay.frames.slice(0, 4).map(preloadReplayFrame));
        showReplayFrame(0);
    } catch (err) {
        frame.innerHTML = '<span>Replay failed to load</span>';
        console.error(err);
    }
}

function wireEvents() {
    $$('[data-view-target]').forEach(btn => {
        btn.addEventListener('click', () => showView(btn.dataset.viewTarget));
    });

    $('#refresh-reports-btn')?.addEventListener('click', loadReports);
    $('#reports-filter')?.addEventListener('change', event => {
        currentTypeFilter = event.target.value;
        renderReports();
    });
    $('#reports-status-filter')?.addEventListener('change', event => {
        currentStatusFilter = event.target.value;
        renderReports();
    });

    $('#config-type')?.addEventListener('change', event => {
        if (event.target) updateConfigTypeFields(event.target.value);
    });

    $('#config-form')?.addEventListener('submit', event => {
        event.preventDefault();
        saveConfig();
    });

    $('#run-selected-config-btn')?.addEventListener('click', startSelectedTest);
    $('#delete-config-btn')?.addEventListener('click', deleteConfig);
    $('#start-run-btn')?.addEventListener('click', startSelectedTest);
    $('#stop-btn')?.addEventListener('click', stopTest);
}

document.addEventListener('DOMContentLoaded', () => {
    wireEvents();
    fillConfigForm(emptyConfig());
    updateSelectedConfigSummary();
    connectCamera();
    connectThermal();
    connectTest();
    loadConfigs();
    loadReports();
});