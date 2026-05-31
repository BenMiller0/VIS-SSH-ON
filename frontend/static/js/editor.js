'use strict';

document.addEventListener('DOMContentLoaded', () => {

  // ── DOM ─────────────────────────────────────────────────────────────────────
  const modal          = document.getElementById('editor-modal');
  const fileListEl     = document.getElementById('file-list');
  const saveBtn        = document.getElementById('save-btn');
  const saveStatusEl   = document.getElementById('save-status');
  const closeEditor    = document.getElementById('close-editor');
  const openBtn        = document.getElementById('editor-btn');
  const toggleNewBtn   = document.getElementById('toggle-new-file');
  const newFileRow     = document.getElementById('new-file-row');
  const newFileInput   = document.getElementById('new-file-input');
  const newFileConfirm = document.getElementById('new-file-confirm');
  const newFileErr     = document.getElementById('new-file-err');
  const ideTab         = document.getElementById('ide-tab');
  const ideTabName     = document.getElementById('bar-filename');
  const ideTabDot      = document.getElementById('ide-tab-dot');
  const ideNoFile      = document.getElementById('ide-no-file');
  const cmWrap         = document.getElementById('cm-wrap');
  const ideCursor      = document.getElementById('ide-cursor');
  const ideFiletype    = document.getElementById('ide-filetype');

  const required = { modal, fileListEl, saveBtn, saveStatusEl, closeEditor,
    openBtn, toggleNewBtn, newFileRow, newFileInput, newFileConfirm, newFileErr,
    ideTab, ideTabName, ideTabDot, ideNoFile, cmWrap };
  for (const [id, el] of Object.entries(required)) {
    if (!el) { console.error(`[editor] missing element: #${id}`); return; }
  }

  // ── State ──────────────────────────────────────────────────────────────────
  let cm          = null;
  let currentFile = '';
  let unsaved     = false;

  function normalizePath(filePath) {
    return filePath.replace(/\\/g, '/');
  }

  // ── Modal ──────────────────────────────────────────────────────────────────
  async function openModal() {
    modal.style.display = 'flex';
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
    toggleNewBtn.textContent = '✕';
  }

  function hideNewFileRow() {
    newFileRow.style.display = 'none';
    newFileInput.value = '';
    newFileErr.textContent = '';
    toggleNewBtn.textContent = '+';
  }

  async function createNewFile() {
    const raw = newFileInput.value.trim().replace(/\\/g, '/').replace(/^\/+/, '');
    if (!raw)               return (newFileErr.textContent = 'Enter a filename.');
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
        const norm  = normalizePath(f);
        const slash = norm.lastIndexOf('/');
        const dir   = slash >= 0 ? norm.slice(0, slash) : '';
        const name  = norm.slice(slash + 1);
        (groups[dir] ??= []).push({ name, path: norm });
      }

      fileListEl.innerHTML = '';
      Object.entries(groups).forEach(([dir, items]) => {
        const group = document.createElement('div');
        group.className = 'file-group';

        if (dir) {
          const lbl = document.createElement('div');
          lbl.className   = 'group-label';
          lbl.textContent = dir + '/';
          group.appendChild(lbl);
        }

        items.forEach(({ name, path }) => {
          const row = document.createElement('div');
          row.className = 'file-row';
          row.dataset.filePath = path;
          if (path === currentFile) row.classList.add('active');

          const openBtn2 = document.createElement('button');
          openBtn2.className = 'file-row-open';
          openBtn2.innerHTML = `<span class="fname">${name}</span>`;
          openBtn2.addEventListener('click', () => openFile(path));

          const del = document.createElement('button');
          del.className   = 'file-row-delete';
          del.textContent = '🗑';
          del.title       = 'Delete file';
          del.addEventListener('click', e => { e.stopPropagation(); deleteFile(path); });

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
      if (currentFile === filePath) {
        currentFile = '';
        unsaved = false;
        ideTab.style.display    = 'none';
        cmWrap.style.display    = 'none';
        ideNoFile.style.display = 'flex';
        if (cm) cm.setValue('');
      }
      await loadFileList();
    } catch (err) {
      alert('Could not delete file: ' + err.message);
      console.error(err);
    }
  }

  // ── Editor ─────────────────────────────────────────────────────────────────
  const MODE_MAP = {
    cpp: 'text/x-c++src', cc: 'text/x-c++src', cxx: 'text/x-c++src',
    c:   'text/x-csrc',
    h:   'text/x-c++src', hpp: 'text/x-c++src',
    ino: 'text/x-c++src',
    py:  'text/x-python',
    js:  'text/javascript',
    json: 'application/json',
  };

  const FILETYPE_LABELS = {
    cpp: 'C++', cc: 'C++', cxx: 'C++', c: 'C', h: 'C/C++ Header',
    hpp: 'C++ Header', ino: 'Arduino', py: 'Python', js: 'JavaScript',
    json: 'JSON',
  };

  async function openFile(filePath) {
    filePath = normalizePath(filePath);
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

        cm.on('cursorActivity', () => {
          if (!ideCursor) return;
          const cur = cm.getCursor();
          ideCursor.textContent = `Ln ${cur.line + 1}, Col ${cur.ch + 1}`;
        });
      }

      const ext = filePath.split('.').pop().toLowerCase();
      cm.setOption('mode', MODE_MAP[ext] ?? 'text/x-c++src');
      cm.setValue(data.content);
      cm.clearHistory();
      requestAnimationFrame(() => cm.refresh());

      currentFile = filePath;
      unsaved     = false;
      refreshSaveBtn();

      // Show editor, hide welcome screen
      cmWrap.style.display    = 'block';
      ideNoFile.style.display = 'none';
      ideTabName.textContent  = filePath;
      ideTabDot.style.display = 'none';
      ideTab.style.display    = 'flex';

      // Update status bar
      if (ideFiletype) ideFiletype.textContent = FILETYPE_LABELS[ext] ?? ext.toUpperCase();

      // Highlight active file in sidebar
      document.querySelectorAll('.file-row').forEach(row => {
        row.classList.toggle('active', row.dataset.filePath === currentFile);
      });

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
      ideTabDot.style.display = 'none';
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
    if (ideTabDot) ideTabDot.style.display = unsaved ? 'inline' : 'none';
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
  closeEditor.addEventListener('click', closeModal);
  saveBtn.addEventListener('click', saveFile);

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
