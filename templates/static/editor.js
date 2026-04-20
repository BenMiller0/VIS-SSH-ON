'use strict';

// ── State ─────────────────────────────────────────────────────────────────────
let editor        = null;
let currentFile   = '';
let unsaved       = false;

// ── DOM ───────────────────────────────────────────────────────────────────────
const modal       = document.getElementById('editor-modal');
const screenFiles = document.getElementById('screen-files');
const screenEdit  = document.getElementById('screen-edit');
const fileList    = document.getElementById('file-list');
const editorTitle = document.getElementById('editor-title');
const saveBtn     = document.getElementById('save-btn');
const saveStatus  = document.getElementById('save-status');
const backBtn     = document.getElementById('back-btn');
const closeBtn    = document.getElementById('close-modal');
const openBtn     = document.getElementById('editor-btn');

// ── Filtering ─────────────────────────────────────────────────────────────────
function isExcluded(filePath) {
  return filePath.split(/[\/\\]/).some(seg =>
    seg === '.pio' || seg.startsWith('.pio') || seg === '.git' || seg === '__pycache__'
  );
}

// ── Screen transitions ────────────────────────────────────────────────────────
function showFilePicker() {
  screenEdit.classList.remove('active');
  screenFiles.classList.add('active');
}

function showEditor() {
  screenFiles.classList.remove('active');
  screenEdit.classList.add('active');
  setTimeout(() => editor && editor.refresh(), 20);
}

// ── Modal open/close ──────────────────────────────────────────────────────────
async function openModal() {
  modal.classList.add('active');
  showFilePicker();
  await loadFileList();
}

function closeModal() {
  if (unsaved && !confirm(`Discard unsaved changes to "${currentFile}"?`)) return;
  modal.classList.remove('active');
  unsaved = false;
}

// ── File list ─────────────────────────────────────────────────────────────────
async function loadFileList() {
  fileList.innerHTML = '<div class="file-msg">scanning…</div>';
  try {
    const res  = await fetch('/api/files');
    const data = await res.json();
    const files = data.files.filter(f => !isExcluded(f)).sort();

    if (!files.length) {
      fileList.innerHTML = '<div class="file-msg">no files found</div>';
      return;
    }

    // Group by directory
    const groups = {};
    files.forEach(f => {
      const parts = f.replace(/\\/g, '/').split('/');
      const dir   = parts.length > 1 ? parts.slice(0, -1).join('/') : '';
      const name  = parts[parts.length - 1];
      (groups[dir] = groups[dir] || []).push({ name, path: f });
    });

    fileList.innerHTML = '';
    Object.entries(groups).forEach(([dir, items], gi) => {
      const group = document.createElement('div');
      group.className = 'file-group';
      group.style.animationDelay = `${gi * 40}ms`;

      if (dir) {
        const label = document.createElement('div');
        label.className = 'group-label';
        label.textContent = dir + '/';
        group.appendChild(label);
      }

      items.forEach(({ name, path }, fi) => {
        const ext = name.includes('.') ? name.split('.').pop().toUpperCase() : '?';
        const btn = document.createElement('button');
        btn.className = 'file-row';
        btn.style.animationDelay = `${(gi * items.length + fi) * 30}ms`;
        btn.innerHTML =
          `<span class="ext-badge">${ext}</span>` +
          `<span class="fname">${name}</span>` +
          `<span class="fopen">OPEN →</span>`;
        btn.addEventListener('click', () => openFile(path));
        group.appendChild(btn);
      });

      fileList.appendChild(group);
    });

  } catch (err) {
    fileList.innerHTML = '<div class="file-msg err">error loading files</div>';
    console.error(err);
  }
}

// ── Editor ────────────────────────────────────────────────────────────────────
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
    if (!res.ok) throw new Error('not found');
    const data = await res.json();

    if (!editor) {
      editor = CodeMirror.fromTextArea(
        document.getElementById('code-editor'), {
          lineNumbers:       true,
          theme:             'dracula',
          tabSize:           4,
          indentUnit:        4,
          indentWithTabs:    false,
          lineWrapping:      false,
          matchBrackets:     true,
          autoCloseBrackets: true,
          extraKeys: {
            'Ctrl-S': saveFile,
            'Cmd-S':  saveFile,
            'Tab': cm => cm.somethingSelected()
              ? cm.indentSelection('add')
              : cm.replaceSelection('    ', 'end'),
          },
        }
      );
      editor.on('change', () => { unsaved = true; updateSaveBtn(); });
    }

    const ext = filePath.split('.').pop().toLowerCase();
    editor.setOption('mode', MODE_MAP[ext] || 'text/x-c++src');
    editor.setValue(data.content);
    editor.clearHistory();

    currentFile = filePath;
    unsaved     = false;
    updateSaveBtn();
    editorTitle.textContent = filePath.replace(/\\/g, '/');
    showEditor();

  } catch (err) {
    console.error('openFile error:', err);
  }
}

async function saveFile() {
  if (!currentFile || !editor) return;
  saveBtn.disabled = true;
  try {
    const res = await fetch(`/api/files/${encodeURIComponent(currentFile)}`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ content: editor.getValue() }),
    });
    if (!res.ok) throw new Error();
    unsaved = false;
    updateSaveBtn();
    flashStatus('saved', 'ok');
  } catch {
    flashStatus('save failed', 'err');
  } finally {
    saveBtn.disabled = false;
  }
}

function updateSaveBtn() {
  saveBtn.classList.toggle('dirty', unsaved);
  saveBtn.textContent = unsaved ? '● SAVE' : 'SAVE';
}

function flashStatus(msg, type) {
  saveStatus.textContent = msg;
  saveStatus.className = `save-status on ${type}`;
  clearTimeout(flashStatus._t);
  flashStatus._t = setTimeout(() => { saveStatus.className = 'save-status'; }, 2500);
}

// ── Wiring ────────────────────────────────────────────────────────────────────
openBtn.addEventListener('click', openModal);
closeBtn.addEventListener('click', closeModal);
saveBtn.addEventListener('click', saveFile);

backBtn.addEventListener('click', () => {
  if (unsaved && !confirm(`Discard unsaved changes to "${currentFile}"?`)) return;
  unsaved = false;
  updateSaveBtn();
  showFilePicker();
});

modal.addEventListener('click', e => { if (e.target === modal) closeModal(); });

document.addEventListener('keydown', e => {
  if (!modal.classList.contains('active')) return;
  if ((e.ctrlKey || e.metaKey) && e.key === 's') { e.preventDefault(); saveFile(); }
  if (e.key === 'Escape') closeModal();
});