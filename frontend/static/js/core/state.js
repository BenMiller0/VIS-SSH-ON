'use strict';

/**
 * static/js/core/state.js
 *
 * Shared client-side state registry.
 * ES modules are browser singletons, so this object gives page modules one
 * coordinated source of truth for selected configs, run history, CV scripts,
 * replay cache state, and the active test run.
 *
 * Architecture notes:
 * - state lives here, rendering stays in partial-specific page modules
 * - mutable by design because the app is small and framework-free
 * - avoids hidden globals while keeping cross-view workflows explicit
 */

export const DEFAULT_CV_SCRIPT = 'rotation_test.py';

export const replayState = {
    runId: null,
    frames: [],
    index: 0,
    timer: null,
    cache: new Map(),
};

export const appState = {
    cameraOrientation: {
        flipHorizontal: false,
        flipVertical: false,
    },
    currentRunId: null,
    selectedConfig: null,
    selectedRun: null,
    configs: [],
    runs: [],
    currentTypeFilter: 'all',
    currentStatusFilter: 'all',
    lastMetric: null,
    lastFailureByRun: {},
    cvScripts: [],
    currentCvScript: DEFAULT_CV_SCRIPT,
    cvCodeMirror: null,
};
