'use strict';

/**
 * static/js/script.js
 *
 * Frontend application bootstrap.
 * Creates the page-level lifecycle, wires global view navigation, initializes
 * each module that corresponds to a Jinja partial, and starts shared websocket
 * infrastructure after subscribers are registered.
 *
 * Architecture notes:
 * - pages/* mirrors frontend/templates/partials/*.html
 * - core/* owns shared services, state, events, UI helpers, and transports
 * - this file coordinates modules but does not own feature-specific behavior
 */

import { connectAllWebSockets } from './core/ws.js';
import { appState } from './core/state.js';
import { $$ } from './core/ui.js';
import { initModalEditor } from './pages/modal_editor.js';
import { initModalFlash } from './pages/modal_flash.js';
import { initModalSerial } from './pages/modal_serial.js';
import { initViewConfigs, loadConfigs, loadCvScripts, refreshCvEditor } from './pages/view_configs.js';
import { initViewMonitor } from './pages/view_monitor.js';
import { initViewReplay, renderReplay } from './pages/view_replay.js';
import { initViewReports, loadReports } from './pages/view_reports.js';
import { initViewRun, startSelectedTest } from './pages/view_run.js';

// -- Navigation --------------------------------------------------------------

function showView(viewId) {
    $$('.app-view').forEach(view => {
        view.classList.toggle('active', view.id === viewId);
    });

    $$('.nav-tab').forEach(tab => {
        tab.classList.toggle('active', tab.dataset.viewTarget === viewId);
    });

    if (viewId === 'configs-view') {
        loadConfigs();
        refreshCvEditor();
    } else if (viewId === 'reports-view') {
        loadReports();
    } else if (viewId === 'replay-view') {
        renderReplay(appState.selectedRun);
    }
}

function initNavigation() {
    $$('[data-view-target]').forEach(button => {
        button.addEventListener('click', () => {
            showView(button.dataset.viewTarget);
        });
    });
}

// -- Bootstrap ---------------------------------------------------------------

function createApp() {
    return {
        init() {
            initNavigation();
            initViewMonitor();
            initViewConfigs({
                onRunSelected: () => startSelectedTest(showView),
            });
            initViewRun({ showView });
            initViewReports({ showView });
            initViewReplay();
            initModalFlash();
            initModalSerial();
            initModalEditor();

            connectAllWebSockets();
            loadCvScripts();
            loadConfigs();
            loadReports();
        },
    };
}

document.addEventListener('DOMContentLoaded', () => {
    createApp().init();
});
