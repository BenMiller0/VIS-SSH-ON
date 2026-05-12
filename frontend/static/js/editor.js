'use strict';

document.addEventListener('DOMContentLoaded', () => {

  // ── DOM ─────────────────────────────────────────────────────────────────────
  const modal          = document.getElementById('editor-modal');
  const screenPicker   = document.getElementById('screen-picker');
  const screenEditor   = document.getElementById('screen-editor');
  const fileListEl     = document.getElementById('file-list');
  const editorTitle    = document.getElementById('bar-filename');
  const saveBtn        = document.getElementById('save-btn');
  const saveStatusEl   = document.getElementById('save-status');
  const backBtn        = document.getElementById('back-btn');
  const closePicker    = document.getElementById('close-picker');
  const closeEditor    = document.getElementById('close-editor');
  const openBtn        = document.getElementById('editor-btn');
  const toggleNewBtn   = document.getElementById('toggle-new-file');
  const newFileRow     = document.getElementById('new-file-row');
  const newFileInput   = document.getElementById('new-file-input');
  const newFileConfirm = document.getElementById('new-file-confirm');
  const newFileErr     = document.getElementById('new-file-err');

  // Bail early with a clear message if anything is missing
  const required = { modal, screenPicker, screenEditor, fileListEl, editorTitle,
    saveBtn, saveStatusEl, backBtn, closePicker, closeEditor, openBtn,
    toggleNewBtn, newFileRow, newFileInput, newFileConfirm, newFileErr };
  for (const [id, el] of Object.entries(required)) {
    if (!el) { console.error(`[editor] missing element: #${id}`); return; }
  }

  // ── State ──────────────────────────────────────────────────────────────────
  let cm          = null;
  let currentFile = '';
  let unsaved     = false;

  // ── Screens ────────────────────────────────────────────────────────────────
  function showPicker() {
    screenEditor.style.display = 'none';
    screenPicker.style.display = 'flex';
    hideNewFileRow();
  }

  function showEditor() {
    screenPicker.style.display = 'none';
    screenEditor.style.display = 'flex';
    requestAnimationFrame(() => cm && cm.refresh());
  }

  // ── Modal ──────────────────────────────────────────────────────────────────
  async function openModal() {
    modal.style.display = 'flex';
    showPicker();
    await loadFileList();
  }

  function closeModal() {
    if (unsaved && !confirm(`Discard unsaved changes to "${currentFile}"?`)) return;
    modal.style.display = 'none';
    unsaved = false;
  }

  // ── New-file row ───────────────────────────────────────────────────────────
  function showNewFileRow() {
    newFileRow.style.display = 'flex';
    newFileInput.value = '';
    newFileErr.textContent = '';
    newFileInput.focus();
    toggleNewBtn.textContent = '✕ CANCEL';
  }

  function hideNewFileRow() {
    newFileRow.style.display = 'none';
    newFileInput.value = '';
    newFileErr.textContent = '';
    toggleNewBtn.textContent = '+ NEW FILE';
  }

  async function createNewFile() {
    const raw = newFileInput.value.trim().replace(/\\/g, '/').replace(/^\/+/, '');
    if (!raw)              return (newFileErr.textContent = 'Enter a filename.');
    if (!raw.includes('.')) return (newFileErr.textContent = 'Include an extension (e.g. .cpp).');

    newFileConfirm.disabled = true;
    newFileErr.textContent  = '';
    try {
      const res = await fetch(`/api/files/${encodeURIComponent(raw)}`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ content: '' }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      await loadFileList();
      hideNewFileRow();
      await openFile(raw);
    } catch (err) {
      newFileErr.textContent = 'Could not create file.';
      console.error(err);
    } finally {
      newFileConfirm.disabled = false;
    }
  }

  // ── File list ──────────────────────────────────────────────────────────────
  function isExcluded(p) {
    return p.split(/[/\\]/).some(s => s === '.pio' || s === '.git' || s === '__pycache__');
  }

  async function loadFileList() {
    fileListEl.innerHTML = '<div class="file-msg">scanning…</div>';
    try {
      const data  = await fetch('/api/files').then(r => r.json());
      const files = data.files.filter(f => !isExcluded(f)).sort();

      if (!files.length) {
        fileListEl.innerHTML = '<div class="file-msg">no files found</div>';
        return;
      }

      const groups = {};
      for (const f of files) {
        const norm  = f.replace(/\\/g, '/');
        const slash = norm.lastIndexOf('/');
        const dir   = slash >= 0 ? norm.slice(0, slash) : '';
        const name  = norm.slice(slash + 1);
        (groups[dir] ??= []).push({ name, path: norm });
      }

      fileListEl.innerHTML = '';
      Object.entries(groups).forEach(([dir, items], gi) => {
        const group = document.createElement('div');
        group.className = 'file-group';

        if (dir) {
          const lbl = document.createElement('div');
          lbl.className   = 'group-label';
          lbl.textContent = dir + '/';
          group.appendChild(lbl);
        }

        items.forEach(({ name, path }) => {
          const ext = name.includes('.') ? name.split('.').pop().toUpperCase() : '?';

          const row = document.createElement('div');
          row.className = 'file-row';

          const openBtn2 = document.createElement('button');
          openBtn2.className = 'file-row-open';
          openBtn2.innerHTML =
            `<span class="ext-badge">${ext}</span>` +
            `<span class="fname">${name}</span>` +
            `<span class="fopen">OPEN →</span>`;
          openBtn2.addEventListener('click', () => openFile(path));

          const del = document.createElement('button');
          del.className   = 'file-row-delete';
          del.textContent = '🗑';
          del.title       = 'Delete file';
          del.addEventListener('click', (e) => {
            e.stopPropagation();
            deleteFile(path);
          });

          row.appendChild(openBtn2);
          row.appendChild(del);
          group.appendChild(row);
        });

        fileListEl.appendChild(group);
      });

    } catch (err) {
      fileListEl.innerHTML = '<div class="file-msg err">error loading files</div>';
      console.error(err);
    }
  }

  // ── Delete file ────────────────────────────────────────────────────────────
  async function deleteFile(filePath) {
    if (!confirm(`Delete "${filePath}"? This cannot be undone.`)) return;
    try {
      const res = await fetch(`/api/files/${encodeURIComponent(filePath)}`, { method: 'DELETE' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      // If the deleted file is currently open, go back to picker
      if (currentFile === filePath) {
        currentFile = '';
        unsaved = false;
        showPicker();
      }
      await loadFileList();
    } catch (err) {
      alert('Could not delete file: ' + err.message);
      console.error(err);
    }
  }

    // ── Editor ─────────────────────────────────────────────────────────────────
  const MODE_MAP = {
    cpp:'text/x-c++src', cc:'text/x-c++src', cxx:'text/x-c++src',
    c:  'text/x-csrc',
    h:  'text/x-c++src', hpp:'text/x-c++src',
    ino:'text/x-c++src',
    py: 'text/x-python',
    js: 'text/javascript',
    json:'application/json',
  };

  async function openFile(filePath) {
    try {
      const res  = await fetch(`/api/files/${encodeURIComponent(filePath)}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();

      if (!cm) {
        cm = CodeMirror.fromTextArea(document.getElementById('code-editor'), {
          lineNumbers:       true,
          theme:             'dracula',
          tabSize:           4,
          indentUnit:        4,
          indentWithTabs:    false,
          lineWrapping:      false,
          matchBrackets:     true,
          autoCloseBrackets: true,
          extraKeys: {
            'Ctrl-S': () => saveFile(),
            'Cmd-S':  () => saveFile(),
            'Tab': c => c.somethingSelected()
              ? c.indentSelection('add')
              : c.replaceSelection('    ', 'end'),
          },
        });
        cm.on('change', () => { unsaved = true; refreshSaveBtn(); });
      }

      cm.setOption('mode', MODE_MAP[filePath.split('.').pop().toLowerCase()] ?? 'text/x-c++src');
      cm.setValue(data.content);
      cm.clearHistory();

      currentFile = filePath;
      unsaved     = false;
      refreshSaveBtn();
      editorTitle.textContent = filePath;
      showEditor();

    } catch (err) {
      console.error('[editor] openFile:', err);
      alert('Could not open file: ' + err.message);
    }
  }

  async function saveFile() {
    if (!currentFile || !cm) return;
    saveBtn.disabled = true;
    try {
      const res = await fetch(`/api/files/${encodeURIComponent(currentFile)}`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ content: cm.getValue() }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      unsaved = false;
      refreshSaveBtn();
      showSaveStatus('saved', 'ok');
    } catch (err) {
      showSaveStatus('save failed', 'err');
      console.error(err);
    } finally {
      saveBtn.disabled = false;
    }
  }

  function refreshSaveBtn() {
    saveBtn.classList.toggle('dirty', unsaved);
    saveBtn.textContent = unsaved ? '● SAVE' : 'SAVE';
  }

  let _statusTimer;
  function showSaveStatus(msg, type) {
    saveStatusEl.textContent = msg;
    saveStatusEl.className   = `save-status ${type}`;
    clearTimeout(_statusTimer);
    _statusTimer = setTimeout(() => {
      saveStatusEl.textContent = '';
      saveStatusEl.className   = 'save-status';
    }, 2500);
  }

  // ── Event wiring ───────────────────────────────────────────────────────────
  openBtn.addEventListener('click', openModal);
  closePicker.addEventListener('click', closeModal);
  closeEditor.addEventListener('click', closeModal);
  saveBtn.addEventListener('click', saveFile);
  backBtn.addEventListener('click', () => {
    if (unsaved && !confirm(`Discard unsaved changes to "${currentFile}"?`)) return;
    unsaved = false;
    refreshSaveBtn();
    showPicker();
  });

  toggleNewBtn.addEventListener('click', () =>
    newFileRow.style.display === 'none' ? showNewFileRow() : hideNewFileRow()
  );
  newFileConfirm.addEventListener('click', createNewFile);
  newFileInput.addEventListener('keydown', e => {
    if (e.key === 'Enter')  createNewFile();
    if (e.key === 'Escape') hideNewFileRow();
  });

  modal.addEventListener('click', e => { if (e.target === modal) closeModal(); });

  document.addEventListener('keydown', e => {
    if (modal.style.display === 'none') return;
    if ((e.ctrlKey || e.metaKey) && e.key === 's') { e.preventDefault(); saveFile(); }
    if (e.key === 'Escape') {
      if (newFileRow.style.display !== 'none') { hideNewFileRow(); return; }
      closeModal();
    }
  });

}); // end DOMContentLoaded