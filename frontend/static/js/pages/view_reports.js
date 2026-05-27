'use strict';

/**
 * static/js/pages/view_reports.js
 *
 * Controller for partials/view_reports.html.
 * Owns the report list, filters, report deletion, and the transition from a
 * selected report into the Replay view.
 *
 * Architecture notes:
 * - reads persisted run history through core/api.js
 * - uses appState for filters and selectedRun ownership
 * - calls view_replay.js through an explicit export instead of touching replay
 *   internals directly
 */

import { api } from '../core/api.js';
import { appState } from '../core/state.js';
import { $, escapeHtml } from '../core/ui.js';
import { renderReplay } from './view_replay.js';

let showViewCallback = null;

function configNameForRun(run) {
    return appState.configs.find(config => {
        return config.id === run.test_config_id;
    })?.name ?? `Config #${run.test_config_id}`;
}

export async function loadReports() {
    const list = $('#reports-list');
    if (!list) {
        return;
    }

    try {
        appState.runs = await api.listRuns();
        renderReports();
    } catch (error) {
        list.innerHTML = '<div class="empty-state err">Could not load reports.</div>';
        console.error(error);
    }
}

function renderReports() {
    const list = $('#reports-list');
    if (!list) {
        return;
    }

    list.innerHTML = '';

    if (!appState.runs.length) {
        list.innerHTML = '<div class="empty-state">No test runs recorded yet.</div>';
        return;
    }

    const filteredRuns = appState.runs.filter(run => {
        if (appState.currentTypeFilter !== 'all') {
            const config = appState.configs.find(item => item.id === run.test_config_id);
            if (config?.type !== appState.currentTypeFilter) {
                return false;
            }
        }

        if (appState.currentStatusFilter !== 'all' && run.status !== appState.currentStatusFilter) {
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
            appState.selectedRun = run;
            renderReplay(run);

            if (showViewCallback) {
                showViewCallback('replay-view');
            }
        });

        row.querySelector('.report-delete-btn')?.addEventListener('click', event => {
            event.stopPropagation();
            deleteReport(run.id);
        });

        list.appendChild(row);
    });
}

function deleteReport(runId) {
    if (!confirm(`Delete report #${runId}?`)) {
        return;
    }

    api.deleteRun(runId)
        .then(() => {
            if (appState.selectedRun?.id === runId) {
                appState.selectedRun = null;
            }

            loadReports();
        })
        .catch(error => {
            console.error('Could not delete report:', error);
            alert('Could not delete report.');
        });
}

export function initViewReports({ showView } = {}) {
    showViewCallback = showView ?? null;

    $('#reports-filter')?.addEventListener('change', event => {
        appState.currentTypeFilter = event.target.value;
        renderReports();
    });

    $('#reports-status-filter')?.addEventListener('change', event => {
        appState.currentStatusFilter = event.target.value;
        renderReports();
    });
}
