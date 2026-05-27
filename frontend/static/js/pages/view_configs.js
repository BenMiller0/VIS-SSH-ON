'use strict';

/**
 * static/js/pages/view_configs.js
 *
 * Controller for partials/view_configs.html.
 * Owns the configured-test library, config edit form, and the CV Python script
 * editor embedded in the Tests view.
 *
 * Architecture notes:
 * - mirrors the view_configs.html partial by owning only that partial's DOM
 * - uses core/api.js as the service boundary for configs and CV files
 * - updates shared appState so Run, Reports, and Replay can coordinate
 * - exposes save/load helpers for cross-view workflows such as "run selected"
 */

import { api } from '../core/api.js';
import { appState } from '../core/state.js';
import { $, escapeHtml } from '../core/ui.js';

let runSelectedCallback = null;

// -- Config form -------------------------------------------------------------

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

    if (visionSection) {
        visionSection.classList.toggle('field-hidden', type !== 'vision');
    }

    if (thermalSection) {
        thermalSection.classList.toggle('field-hidden', type !== 'thermal');
    }

    if (customSection) {
        customSection.classList.toggle('field-hidden', type !== 'custom');
    }

    if (typeNotice) {
        typeNotice.style.display = type ? 'none' : 'block';
    }
}

function fillConfigForm(config = emptyConfig()) {
    const parameters = config.parameters ?? {};
    const scriptSelect = $('#config-script-path');

    $('#config-name').value = config.name ?? '';
    $('#config-description').value = config.description ?? '';
    $('#config-type').value = config.type ?? '';

    if (scriptSelect) {
        scriptSelect.value = parameters.script_path ?? appState.currentCvScript;
    }

    $('#config-max-temperature').value = parameters.max_temp ?? '';
    updateConfigTypeFields(config.type ?? '');
}

function collectConfigForm() {
    const type = $('#config-type').value;
    const parameters = {};

    if (type === 'vision') {
        parameters.metric = 'red_keypoint';
        parameters.require_detection = 'true';
        parameters.script_path = $('#config-script-path')?.value || appState.currentCvScript;
        parameters.include_thermal = 'false';
    } else if (type === 'thermal') {
        const maxTemperature = parseFloat($('#config-max-temperature').value);
        parameters.max_temp = String(Number.isFinite(maxTemperature) ? maxTemperature : 75);
        parameters.metric = 'thermal';
        parameters.include_thermal = 'true';
    } else {
        parameters.metric = 'custom';
        parameters.include_thermal = 'true';
    }

    return {
        name: $('#config-name').value.trim() || 'Unnamed Test',
        description: $('#config-description').value.trim(),
        type,
        parameters,
    };
}

export function updateSelectedConfigSummary() {
    const name = appState.selectedConfig?.name ?? 'No test selected';
    const parameters = appState.selectedConfig?.parameters ?? {};
    const expected = appState.selectedConfig?.type === 'vision'
        ? (parameters.script_path ?? appState.currentCvScript)
        : appState.selectedConfig?.type === 'thermal'
            ? 'Thermal threshold'
            : '-';

    const monitorSelected = $('#monitor-selected-test');
    const runTitle = $('#run-title');
    const runDuration = $('#run-duration');

    if (monitorSelected) {
        monitorSelected.textContent = name;
    }

    if (runTitle) {
        runTitle.textContent = name;
    }

    if (appState.selectedConfig?.type === 'vision' && expected) {
        setCurrentCvScript(expected);
        loadCvScript(expected);
    }

    if (runDuration && parameters.duration_seconds) {
        runDuration.value = parameters.duration_seconds;
    }
}

function renderConfigList() {
    const list = $('#config-list');
    if (!list) {
        return;
    }

    list.innerHTML = '';

    if (!appState.configs.length) {
        list.innerHTML = '<div class="empty-state">No configs saved yet.</div>';
        return;
    }

    appState.configs.forEach(config => {
        const row = document.createElement('button');
        const parameters = config.parameters ?? {};
        const metric = parameters.metric ?? config.type;
        const expected = config.type === 'vision'
            ? (parameters.script_path ?? 'keypoint')
            : 'threshold';

        row.type = 'button';
        row.className = 'config-row';
        row.classList.toggle('selected', appState.selectedConfig?.id === config.id);
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
            appState.selectedConfig = config;
            fillConfigForm(config);
            renderConfigList();
            updateSelectedConfigSummary();
        });

        list.appendChild(row);
    });
}

export async function loadConfigs() {
    const list = $('#config-list');
    if (!list) {
        return;
    }

    try {
        appState.configs = await api.listConfigs();

        if (appState.selectedConfig) {
            appState.selectedConfig = appState.configs.find(config => {
                return config.id === appState.selectedConfig.id;
            }) ?? appState.selectedConfig;

            if (appState.selectedConfig?.id) {
                fillConfigForm(appState.selectedConfig);
            }
        }

        renderConfigList();
        updateSelectedConfigSummary();
    } catch (error) {
        list.innerHTML = '<div class="empty-state err">Could not load configs.</div>';
        console.error(error);
    }
}

async function deleteConfig() {
    if (!appState.selectedConfig?.id) {
        return false;
    }

    if (!confirm(`Delete config "${appState.selectedConfig.name}"? This cannot be undone.`)) {
        return false;
    }

    try {
        await api.deleteConfig(appState.selectedConfig.id);
        appState.selectedConfig = null;
        fillConfigForm(emptyConfig());
        renderConfigList();
        updateSelectedConfigSummary();
        await loadConfigs();
        return true;
    } catch (error) {
        console.error('Delete failed:', error);
        alert('Could not delete config.');
        return false;
    }
}

export async function saveConfig() {
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
        const editingId = appState.selectedConfig?.id;
        appState.selectedConfig = editingId
            ? await api.updateConfig(editingId, payload)
            : await api.createConfig(payload);

        await loadConfigs();

        if (status) {
            status.textContent = `Saved #${appState.selectedConfig.id}`;
            status.className = 'inline-status ok';
        }

        return appState.selectedConfig;
    } catch (error) {
        if (status) {
            status.textContent = 'Save failed';
            status.className = 'inline-status err';
        }

        console.error(error);
        return null;
    }
}

function newConfig() {
    appState.selectedConfig = null;
    fillConfigForm(emptyConfig());
    renderConfigList();
    updateSelectedConfigSummary();
}

// -- CV script editor --------------------------------------------------------

function defaultCvScriptContent(name) {
    const testName = name.replace(/\.py$/i, '').replace(/[^a-zA-Z0-9_]/g, '_') || 'custom_test';
    return `"""${testName} for the red blob keypoint."""

from vis_ssh_on import fail, load_payload, pass_test, require_keypoint


def main() -> None:
    payload = load_payload()
    keypoint = require_keypoint(payload)

    # Edit the assertions below for your experiment.
    if keypoint.get("area", 0) < 10:
        fail("red blob is too small", area=keypoint.get("area"))

    pass_test(
        x=keypoint["x"],
        y=keypoint["y"],
        area=keypoint.get("area"),
    )


if __name__ == "__main__":
    main()
`;
}

function normalizeCvScriptName(raw) {
    const name = String(raw ?? '').trim().replace(/\\/g, '/').replace(/^\/+/, '');
    if (!name) {
        return '';
    }

    return name.endsWith('.py') ? name : `${name}.py`;
}

function populateCvScriptSelects() {
    const options = appState.cvScripts.length ? appState.cvScripts : [appState.currentCvScript];

    ['#cv-script-select', '#config-script-path'].forEach(selector => {
        const select = $(selector);
        if (!select) {
            return;
        }

        select.innerHTML = options
            .map(path => `<option value="${escapeHtml(path)}">${escapeHtml(path)}</option>`)
            .join('');
        select.value = options.includes(appState.currentCvScript)
            ? appState.currentCvScript
            : options[0];
    });
}

function ensureCvEditor() {
    const textarea = $('#cv-script-editor');
    if (!textarea) {
        return null;
    }

    if (appState.cvCodeMirror || typeof CodeMirror === 'undefined') {
        return appState.cvCodeMirror;
    }

    appState.cvCodeMirror = CodeMirror.fromTextArea(textarea, {
        lineNumbers: true,
        theme: 'dracula',
        mode: 'text/x-python',
        tabSize: 4,
        indentUnit: 4,
        indentWithTabs: false,
        lineWrapping: false,
        matchBrackets: true,
        autoCloseBrackets: true,
        extraKeys: {
            'Ctrl-S': () => saveCvScript(),
            'Cmd-S': () => saveCvScript(),
            'Tab': codeMirror => {
                if (codeMirror.somethingSelected()) {
                    codeMirror.indentSelection('add');
                    return;
                }

                codeMirror.replaceSelection('    ', 'end');
            },
        },
    });

    return appState.cvCodeMirror;
}

function getCvEditorValue() {
    const codeMirror = ensureCvEditor();
    if (codeMirror) {
        return codeMirror.getValue();
    }

    return $('#cv-script-editor')?.value ?? '';
}

function setCvEditorValue(value) {
    const codeMirror = ensureCvEditor();
    const textarea = $('#cv-script-editor');

    if (codeMirror) {
        codeMirror.setValue(value);
        codeMirror.clearHistory();
        requestAnimationFrame(() => codeMirror.refresh());
        return;
    }

    if (textarea) {
        textarea.value = value;
    }
}

export function refreshCvEditor() {
    if (!appState.cvCodeMirror) {
        return;
    }

    requestAnimationFrame(() => appState.cvCodeMirror.refresh());
}

export function setCurrentCvScript(path) {
    appState.currentCvScript = path;

    const editorSelect = $('#cv-script-select');
    const configSelect = $('#config-script-path');

    if (editorSelect) {
        editorSelect.value = path;
    }

    if (configSelect) {
        configSelect.value = path;
    }
}

export async function loadCvScript(path = appState.currentCvScript) {
    if (!$('#cv-script-editor') || !path) {
        return;
    }

    appState.currentCvScript = path;

    try {
        const data = await api.getCvTest(path);
        setCvEditorValue(data.content ?? '');
    } catch (error) {
        setCvEditorValue('');

        const output = $('#cv-script-output');
        if (output) {
            output.textContent = `Could not open ${path}: ${error.message}`;
        }

        console.error(error);
    }
}

export async function loadCvScripts() {
    try {
        const data = await api.listCvTests();
        appState.cvScripts = data.files ?? [];

        if (appState.cvScripts.length && !appState.cvScripts.includes(appState.currentCvScript)) {
            appState.currentCvScript = appState.cvScripts[0];
        }

        populateCvScriptSelects();
        await loadCvScript(appState.currentCvScript);
    } catch (error) {
        const output = $('#cv-script-output');
        if (output) {
            output.textContent = `Could not load CV scripts: ${error.message}`;
        }

        console.error(error);
    }
}

async function createCvScript() {
    const input = $('#new-cv-script-name');
    const output = $('#cv-script-output');
    const name = normalizeCvScriptName(input?.value);

    if (!name) {
        if (output) {
            output.textContent = 'Enter a file name like my_test.py';
        }

        return;
    }

    if (appState.cvScripts.includes(name)) {
        appState.currentCvScript = name;
        populateCvScriptSelects();
        await loadCvScript(name);

        if (output) {
            output.textContent = `${name} already exists. Opened it.`;
        }

        return;
    }

    try {
        await api.saveCvTest(name, defaultCvScriptContent(name));
        appState.currentCvScript = name;

        if (input) {
            input.value = '';
        }

        await loadCvScripts();

        if (output) {
            output.textContent = `Created ${name}`;
        }
    } catch (error) {
        if (output) {
            output.textContent = `Create failed: ${error.message}`;
        }

        console.error(error);
    }
}

async function saveCvScript(quiet = false) {
    const output = $('#cv-script-output');
    if (!$('#cv-script-editor') || !appState.currentCvScript) {
        return;
    }

    try {
        await api.saveCvTest(appState.currentCvScript, getCvEditorValue());

        if (output && !quiet) {
            output.textContent = `Saved ${appState.currentCvScript}`;
        }
    } catch (error) {
        if (output) {
            output.textContent = `Save failed: ${error.message}`;
        }

        console.error(error);
        throw error;
    }
}

// -- Lifecycle ---------------------------------------------------------------

export function initViewConfigs({ onRunSelected } = {}) {
    runSelectedCallback = onRunSelected ?? null;

    $('#new-config-btn')?.addEventListener('click', newConfig);
    $('#delete-config-btn')?.addEventListener('click', deleteConfig);
    $('#config-form')?.addEventListener('submit', event => {
        event.preventDefault();
        saveConfig();
    });
    $('#config-type')?.addEventListener('change', event => {
        if (event.target) {
            updateConfigTypeFields(event.target.value);
        }
    });
    $('#run-selected-config-btn')?.addEventListener('click', () => {
        if (runSelectedCallback) {
            runSelectedCallback();
        }
    });

    $('#cv-script-select')?.addEventListener('change', event => {
        setCurrentCvScript(event.target.value);
        loadCvScript(appState.currentCvScript);
    });
    $('#config-script-path')?.addEventListener('change', event => {
        setCurrentCvScript(event.target.value);
        loadCvScript(appState.currentCvScript);
    });
    $('#save-cv-script-btn')?.addEventListener('click', () => saveCvScript());
    $('#new-cv-script-btn')?.addEventListener('click', createCvScript);
    $('#new-cv-script-name')?.addEventListener('keydown', event => {
        if (event.key === 'Enter') {
            event.preventDefault();
            createCvScript();
        }
    });

    ensureCvEditor();
    fillConfigForm(emptyConfig());
    updateSelectedConfigSummary();
}
