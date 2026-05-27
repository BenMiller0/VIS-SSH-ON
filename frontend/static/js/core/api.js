'use strict';

/**
 * static/js/core/api.js
 *
 * Centralized frontend API service layer.
 * View and modal modules call backend endpoints through this file so request
 * formatting, response parsing, and HTTP error handling stay consistent.
 *
 * Architecture notes:
 * - isolates fetch details from page controllers
 * - keeps backend endpoint names in one place
 * - returns plain data so callers own UI state and rendering decisions
 */

async function parseJsonResponse(response) {
    if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
    }

    return response.json();
}

async function requestJson(url, options = {}) {
    const response = await fetch(url, options);
    return parseJsonResponse(response);
}

function jsonOptions(method, payload) {
    return {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
    };
}

export const api = {
    listConfigs() {
        return requestJson('/api/configs');
    },

    createConfig(payload) {
        return requestJson('/api/configs', jsonOptions('POST', payload));
    },

    updateConfig(id, payload) {
        return requestJson(`/api/configs/${id}`, jsonOptions('PUT', payload));
    },

    deleteConfig(id) {
        return requestJson(`/api/configs/${id}`, { method: 'DELETE' });
    },

    listRuns() {
        return requestJson('/api/tests');
    },

    startTest(configId, duration) {
        return requestJson(`/api/tests/${configId}`, jsonOptions('POST', { duration }));
    },

    stopTest(runId) {
        return fetch(`/api/tests/${runId}/stop`, { method: 'POST' });
    },

    deleteRun(runId) {
        return requestJson(`/api/tests/${runId}`, { method: 'DELETE' });
    },

    getRunReport(runId) {
        return fetch(`/api/tests/${runId}/report`).then(response => {
            if (!response.ok) {
                return null;
            }

            return response.json();
        });
    },

    getRunReplay(runId) {
        return fetch(`/api/tests/${runId}/replay`).then(response => {
            if (!response.ok) {
                return null;
            }

            return response.json();
        });
    },

    listCvTests() {
        return requestJson('/api/cv-tests');
    },

    getCvTest(path) {
        return requestJson(`/api/cv-tests/${encodeURIComponent(path)}`);
    },

    saveCvTest(path, content) {
        return requestJson(
            `/api/cv-tests/${encodeURIComponent(path)}`,
            jsonOptions('POST', { content })
        );
    },

    listFiles() {
        return requestJson('/api/files');
    },

    getFile(path) {
        return requestJson(`/api/files/${encodeURIComponent(path)}`);
    },

    saveFile(path, content) {
        return requestJson(
            `/api/files/${encodeURIComponent(path)}`,
            jsonOptions('POST', { content })
        );
    },

    deleteFile(path) {
        return requestJson(`/api/files/${encodeURIComponent(path)}`, { method: 'DELETE' });
    },

    sendPtz(direction) {
        return requestJson('/api/ptz', jsonOptions('POST', { dir: direction }));
    },

    resetDevice() {
        return fetch('/api/flash/reset', { method: 'POST' }).then(response => {
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }

            return response;
        });
    },
};
