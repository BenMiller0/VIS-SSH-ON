'use strict';

/**
 * static/js/pages/modal_editor.js
 *
 * Controller for partials/modal_editor.html.
 * Owns the embedded firmware file browser/editor modal, file creation,
 * deletion, CodeMirror lifecycle, dirty-state tracking, and save behavior.
 *
 * Architecture notes:
 * - modal state is private because it is not part of global app workflow state
 * - file I/O flows through core/api.js to keep fetch details out of the UI
 * - CodeMirror is created lazily when a file is opened to reduce startup work
 */

import { api } from '../core/api.js';
import { $ } from '../core/ui.js';

const MODE_MAP = {
    cpp: 'text/x-c++src',
    cc: 'text/x-c++src',
    cxx: 'text/x-c++src',
    c: 'text/x-csrc',
    h: 'text/x-c++src',
    hpp: 'text/x-c++src',
    ino: 'text/x-c++src',
    py: 'text/x-python',
    js: 'text/javascript',
    json: 'application/json',
};

let codeMirror = null;
let currentFile = '';
let unsaved = false;
let statusTimer = null;

function getElements() {
    return {
        modal: $('#editor-modal'),
        screenPicker: $('#screen-picker'),
        screenEditor: $('#screen-editor'),
        fileList: $('#file-list'),
        editorTitle: $('#bar-filename'),
        saveButton: $('#save-btn'),
        saveStatus: $('#save-status'),
        backButton: $('#back-btn'),
        closePicker: $('#close-picker'),
        closeEditor: $('#close-editor'),
        openButton: $('#editor-btn'),
        toggleNewButton: $('#toggle-new-file'),
        newFileRow: $('#new-file-row'),
        newFileInput: $('#new-file-input'),
        newFileConfirm: $('#new-file-confirm'),
        newFileError: $('#new-file-err'),
    };
}

function requiredElementsAvailable(elements) {
    const missing = Object.entries(elements).find(([, element]) => !element);
    if (missing) {
        console.error(`[editor] missing element: #${missing[0]}`);
        return false;
    }

    return true;
}

// -- Modal screens -----------------------------------------------------------

function showPicker() {
    const { screenEditor, screenPicker } = getElements();
    screenEditor.style.display = 'none';
    screenPicker.style.display = 'flex';
    hideNewFileRow();
}

function showEditor() {
    const { screenEditor, screenPicker } = getElements();
    screenPicker.style.display = 'none';
    screenEditor.style.display = 'flex';

    requestAnimationFrame(() => {
        if (codeMirror) {
            codeMirror.refresh();
        }
    });
}

async function openModal() {
    const { modal } = getElements();
    modal.style.display = 'flex';
    showPicker();
    await loadFileList();
}

function closeModal() {
    const { modal } = getElements();
    if (unsaved && !confirm(`Discard unsaved changes to "${currentFile}"?`)) {
        return;
    }

    modal.style.display = 'none';
    unsaved = false;
}

// -- New file row ------------------------------------------------------------

function showNewFileRow() {
    const { newFileRow, newFileInput, newFileError, toggleNewButton } = getElements();
    newFileRow.style.display = 'flex';
    newFileInput.value = '';
    newFileError.textContent = '';
    newFileInput.focus();
    toggleNewButton.textContent = 'CANCEL';
}

function hideNewFileRow() {
    const { newFileRow, newFileInput, newFileError, toggleNewButton } = getElements();
    newFileRow.style.display = 'none';
    newFileInput.value = '';
    newFileError.textContent = '';
    toggleNewButton.textContent = '+ NEW FILE';
}

async function createNewFile() {
    const { newFileInput, newFileConfirm, newFileError } = getElements();
    const raw = newFileInput.value.trim().replace(/\\/g, '/').replace(/^\/+/, '');

    if (!raw) {
        newFileError.textContent = 'Enter a filename.';
        return;
    }

    if (!raw.includes('.')) {
        newFileError.textContent = 'Include an extension (e.g. .cpp).';
        return;
    }

    newFileConfirm.disabled = true;
    newFileError.textContent = '';

    try {
        await api.saveFile(raw, '');
        await loadFileList();
        hideNewFileRow();
        await openFile(raw);
    } catch (error) {
        newFileError.textContent = 'Could not create file.';
        console.error(error);
    } finally {
        newFileConfirm.disabled = false;
    }
}

// -- File browser ------------------------------------------------------------

function isExcluded(path) {
    return path.split(/[/\\]/).some(segment => {
        return segment === '.pio' || segment === '.git' || segment === '__pycache__';
    });
}

async function loadFileList() {
    const { fileList } = getElements();
    fileList.innerHTML = '<div class="file-msg">scanning...</div>';

    try {
        const data = await api.listFiles();
        const files = data.files.filter(file => !isExcluded(file)).sort();

        if (!files.length) {
            fileList.innerHTML = '<div class="file-msg">no files found</div>';
            return;
        }

        renderFileGroups(fileList, files);
    } catch (error) {
        fileList.innerHTML = '<div class="file-msg err">error loading files</div>';
        console.error(error);
    }
}

function renderFileGroups(fileList, files) {
    const groups = {};

    files.forEach(file => {
        const normalized = file.replace(/\\/g, '/');
        const slash = normalized.lastIndexOf('/');
        const directory = slash >= 0 ? normalized.slice(0, slash) : '';
        const name = normalized.slice(slash + 1);

        groups[directory] ??= [];
        groups[directory].push({ name, path: normalized });
    });

    fileList.innerHTML = '';
    Object.entries(groups).forEach(([directory, items]) => {
        const group = document.createElement('div');
        group.className = 'file-group';

        if (directory) {
            const label = document.createElement('div');
            label.className = 'group-label';
            label.textContent = `${directory}/`;
            group.appendChild(label);
        }

        items.forEach(({ name, path }) => {
            group.appendChild(createFileRow(name, path));
        });

        fileList.appendChild(group);
    });
}

function createFileRow(name, path) {
    const extension = name.includes('.') ? name.split('.').pop().toUpperCase() : '?';
    const row = document.createElement('div');
    const openButton = document.createElement('button');
    const deleteButton = document.createElement('button');

    row.className = 'file-row';
    openButton.className = 'file-row-open';
    openButton.innerHTML = `<span class="ext-badge">${extension}</span><span class="fname">${name}</span><span class="fopen">OPEN -></span>`;
    openButton.addEventListener('click', () => openFile(path));

    deleteButton.className = 'file-row-delete';
    deleteButton.textContent = 'DEL';
    deleteButton.title = 'Delete file';
    deleteButton.addEventListener('click', event => {
        event.stopPropagation();
        deleteFile(path);
    });

    row.appendChild(openButton);
    row.appendChild(deleteButton);
    return row;
}

async function deleteFile(filePath) {
    if (!confirm(`Delete "${filePath}"? This cannot be undone.`)) {
        return;
    }

    try {
        await api.deleteFile(filePath);

        if (currentFile === filePath) {
            currentFile = '';
            unsaved = false;
            showPicker();
        }

        await loadFileList();
    } catch (error) {
        alert(`Could not delete file: ${error.message}`);
        console.error(error);
    }
}

// -- CodeMirror editor -------------------------------------------------------

function ensureCodeMirror() {
    if (codeMirror) {
        return codeMirror;
    }

    codeMirror = CodeMirror.fromTextArea($('#code-editor'), {
        lineNumbers: true,
        theme: 'dracula',
        tabSize: 4,
        indentUnit: 4,
        indentWithTabs: false,
        lineWrapping: false,
        matchBrackets: true,
        autoCloseBrackets: true,
        extraKeys: {
            'Ctrl-S': () => saveFile(),
            'Cmd-S': () => saveFile(),
            'Tab': editor => {
                if (editor.somethingSelected()) {
                    editor.indentSelection('add');
                    return;
                }

                editor.replaceSelection('    ', 'end');
            },
        },
    });
    codeMirror.on('change', () => {
        unsaved = true;
        refreshSaveButton();
    });

    return codeMirror;
}

async function openFile(filePath) {
    const { editorTitle } = getElements();

    try {
        const data = await api.getFile(filePath);
        const editor = ensureCodeMirror();
        const extension = filePath.split('.').pop().toLowerCase();

        editor.setOption('mode', MODE_MAP[extension] ?? 'text/x-c++src');
        editor.setValue(data.content);
        editor.clearHistory();

        currentFile = filePath;
        unsaved = false;
        refreshSaveButton();
        editorTitle.textContent = filePath;
        showEditor();
    } catch (error) {
        console.error('[editor] openFile:', error);
        alert(`Could not open file: ${error.message}`);
    }
}

async function saveFile() {
    const { saveButton } = getElements();
    if (!currentFile || !codeMirror) {
        return;
    }

    saveButton.disabled = true;

    try {
        await api.saveFile(currentFile, codeMirror.getValue());
        unsaved = false;
        refreshSaveButton();
        showSaveStatus('saved', 'ok');
    } catch (error) {
        showSaveStatus('save failed', 'err');
        console.error(error);
    } finally {
        saveButton.disabled = false;
    }
}

function refreshSaveButton() {
    const { saveButton } = getElements();
    saveButton.classList.toggle('dirty', unsaved);
    saveButton.textContent = unsaved ? 'SAVE *' : 'SAVE';
}

function showSaveStatus(message, type) {
    const { saveStatus } = getElements();
    saveStatus.textContent = message;
    saveStatus.className = `save-status ${type}`;
    clearTimeout(statusTimer);
    statusTimer = setTimeout(() => {
        saveStatus.textContent = '';
        saveStatus.className = 'save-status';
    }, 2500);
}

function backToPicker() {
    if (unsaved && !confirm(`Discard unsaved changes to "${currentFile}"?`)) {
        return;
    }

    unsaved = false;
    refreshSaveButton();
    showPicker();
}

// -- Lifecycle ---------------------------------------------------------------

export function initModalEditor() {
    const elements = getElements();
    if (!requiredElementsAvailable(elements)) {
        return;
    }

    elements.openButton.addEventListener('click', openModal);
    elements.closePicker.addEventListener('click', closeModal);
    elements.closeEditor.addEventListener('click', closeModal);
    elements.saveButton.addEventListener('click', saveFile);
    elements.backButton.addEventListener('click', backToPicker);
    elements.toggleNewButton.addEventListener('click', () => {
        if (elements.newFileRow.style.display === 'none') {
            showNewFileRow();
            return;
        }

        hideNewFileRow();
    });
    elements.newFileConfirm.addEventListener('click', createNewFile);
    elements.newFileInput.addEventListener('keydown', event => {
        if (event.key === 'Enter') {
            createNewFile();
        }

        if (event.key === 'Escape') {
            hideNewFileRow();
        }
    });
    elements.modal.addEventListener('click', event => {
        if (event.target === elements.modal) {
            closeModal();
        }
    });

    document.addEventListener('keydown', event => {
        if (elements.modal.style.display === 'none') {
            return;
        }

        if ((event.ctrlKey || event.metaKey) && event.key === 's') {
            event.preventDefault();
            saveFile();
        }

        if (event.key === 'Escape') {
            if (elements.newFileRow.style.display !== 'none') {
                hideNewFileRow();
                return;
            }

            closeModal();
        }
    });
}
