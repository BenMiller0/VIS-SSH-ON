'use strict';

/**
 * static/js/pages/view_run.js
 *
 * Controller for partials/view_run.html.
 * Owns the Run workspace controls, run execution lifecycle, live run metrics,
 * terminal output, and live viewport rendering within the Run partial.
 *
 * Architecture notes:
 * - starts/stops tests through core/api.js
 * - consumes test WebSocket events emitted by core/ws.js
 * - depends on view_configs.js only for selected-config save/summary behavior
 * - refreshes reports after terminal run results arrive
 */

import { api } from '../core/api.js';
import { on } from '../core/events.js';
import { appState } from '../core/state.js';
import { $, $$, escapeHtml, renderBlobToImages, renderHeatmapCanvases, renderKeypoint, renderScriptOutput, setMetrics, setRunStatus, setStopVisible, setTestTerminal } from '../core/ui.js';
import { saveConfig, updateSelectedConfigSummary } from './view_configs.js';
import { loadReports } from './view_reports.js';

let showViewCallback = null;

// -- Live stream rendering ---------------------------------------------------

function runRoot() {
    return $('#run-view');
}

function renderRunFrame(data) {
    const root = runRoot();
    if (!root) {
        return;
    }

    renderBlobToImages(data, $$('[data-camera-feed]', root));
}

function renderRunHeatmap(data) {
    const root = runRoot();
    if (!root) {
        return;
    }

    renderHeatmapCanvases(data.pixels.flat(), $$('[data-heatmap]', root));
}

function renderRunKeypoint(data) {
    const root = runRoot();
    if (!root) {
        return;
    }

    renderKeypoint(root, data);
}

// -- Test execution ----------------------------------------------------------

export async function startSelectedTest(showView = showViewCallback) {
    let config = appState.selectedConfig;
    if (!config) {
        config = await saveConfig();
    }

    if (!config) {
        return;
    }

    appState.selectedConfig = config;
    updateSelectedConfigSummary();

    if (showView) {
        showView('run-view');
    }

    setRunStatus('STARTING...', 'running');
    setMetrics('<div class="metric-line">Waiting for first metric...</div>');

    const durationRaw = parseInt($('#run-duration').value, 10);
    const duration = durationRaw > 0 ? durationRaw : null;

    try {
        const data = await api.startTest(config.id, duration);

        if (data.run_id && !appState.currentRunId) {
            appState.currentRunId = data.run_id;
            setStopVisible(true);
        }
    } catch (error) {
        if (!appState.currentRunId) {
            setRunStatus('ERROR', 'fail');
            setMetrics(`<div class="metric-line fail-line"><span>Error</span><strong>${escapeHtml(error.message)}</strong></div>`);
        }

        console.error(error);
    }
}

async function stopTest() {
    if (!appState.currentRunId) {
        return;
    }

    await api.stopTest(appState.currentRunId);
}

function renderMetricMessage(data) {
    appState.lastMetric = data;

    const testType = appState.selectedConfig?.type;
    const metricRows = [];

    if (testType === 'thermal' && data.temperature !== undefined) {
        metricRows.push(`<div class="metric-line"><span>Temp</span><strong>${escapeHtml(data.temperature)} deg C</strong></div>`);
    }

    if (testType === 'vision') {
        if (data.detected !== undefined) {
            metricRows.push(
                `<div class="metric-line"><span>Detected</span><strong>${data.detected ? 'yes' : 'no'}</strong></div>`,
                `<div class="metric-line"><span>X</span><strong>${escapeHtml(data.x ?? '-')}</strong></div>`,
                `<div class="metric-line"><span>Y</span><strong>${escapeHtml(data.y ?? '-')}</strong></div>`
            );
        }

        if (data.area !== undefined) {
            metricRows.push(`<div class="metric-line"><span>Area</span><strong>${escapeHtml(data.area)}</strong></div>`);
        }
    }

    setMetrics(metricRows.join('') || '<div class="metric-line">Waiting for metrics...</div>');
    renderScriptOutput(data.script_result);
}

function renderResultMessage(data) {
    const finishedRunId = data.run_id ?? appState.currentRunId;

    setStopVisible(false);
    setRunStatus(data.status === 'killed' ? 'STOPPED' : String(data.status).toUpperCase(), data.status);

    if (data.status === 'fail') {
        renderFailureResult(finishedRunId, data);
    } else if (data.status === 'killed') {
        setMetrics('<div class="metric-line"><span>Stopped</span><strong>Manual termination</strong></div>');
    }

    renderScriptOutput(data.script_result);

    if (!data.run_id || data.run_id === appState.currentRunId) {
        appState.currentRunId = null;
    }

    loadReports();
}

function renderFailureResult(finishedRunId, data) {
    appState.lastFailureByRun[finishedRunId] = {
        reason: data.failure_reason,
        failure: data.failure,
        thresholds: data.thresholds,
        metric: appState.lastMetric,
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
}

export function renderTestMessage(data) {
    if (data.type === 'start') {
        appState.currentRunId = data.run_id;
        appState.lastMetric = null;
        setStopVisible(true);
        setRunStatus('RUNNING...', 'running');
        setMetrics(`<div class="metric-line">Run #${escapeHtml(appState.currentRunId)} started</div>`);
        setTestTerminal('');
        return;
    }

    if (data.type === 'metric') {
        renderMetricMessage(data);
        return;
    }

    if (data.type === 'result') {
        renderResultMessage(data);
    }
}

// -- Lifecycle ---------------------------------------------------------------

export function initViewRun({ showView } = {}) {
    showViewCallback = showView ?? null;

    $('#start-run-btn')?.addEventListener('click', () => startSelectedTest(showViewCallback));
    $('#stop-btn')?.addEventListener('click', stopTest);

    on('ws:camera:frame', renderRunFrame);
    on('ws:thermal:data', renderRunHeatmap);
    on('ws:keypoint:data', renderRunKeypoint);
    on('ws:test:message', renderTestMessage);
}
