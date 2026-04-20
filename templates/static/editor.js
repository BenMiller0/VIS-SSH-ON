const editorModal = document.getElementById('editor-modal');
const editorBtn = document.getElementById('editor-btn');
const closeEditorBtn = document.getElementById('close-editor');
const fileSelect = document.getElementById('file-select');
const saveBtn = document.getElementById('save-btn');
const saveStatus = document.getElementById('save-status');
const codeEditorTextarea = document.getElementById('code-editor');

let editor;
let currentFile = '';

async function loadFiles() {
  try {
    const response = await fetch('/api/files');
    const data = await response.json();
    fileSelect.innerHTML = '';
    data.files.forEach(file => {
      const option = document.createElement('option');
      option.value = file;
      option.textContent = file;
      fileSelect.appendChild(option);
    });
    if (data.files.length > 0) {
      currentFile = data.files[0];
      await loadFileContent(currentFile);
    }
  } catch (error) {
    console.error('Error loading files:', error);
    showStatus('Error loading files', 'error');
  }
}

async function loadFileContent(filePath) {
  try {
    const response = await fetch(`/api/files/${encodeURIComponent(filePath)}`);
    if (!response.ok) {
      throw new Error('Failed to load file');
    }
    const data = await response.json();
    if (editor) {
      editor.setValue(data.content);
    }
    currentFile = filePath;
  } catch (error) {
    console.error('Error loading file content:', error);
    showStatus('Error loading file', 'error');
  }
}

async function saveFile() {
  if (!currentFile || !editor) return;
  
  const content = editor.getValue();
  try {
    const response = await fetch(`/api/files/${encodeURIComponent(currentFile)}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ content }),
    });
    
    if (!response.ok) {
      throw new Error('Failed to save file');
    }
    
    showStatus('File saved successfully!', 'success');
  } catch (error) {
    console.error('Error saving file:', error);
    showStatus('Error saving file', 'error');
  }
}

function showStatus(message, type) {
  saveStatus.textContent = message;
  saveStatus.className = `save-status show ${type}`;
  setTimeout(() => {
    saveStatus.className = 'save-status';
  }, 3000);
}

function openEditor() {
  editorModal.classList.add('active');
  if (!editor) {
    editor = CodeMirror.fromTextArea(codeEditorTextarea, {
      lineNumbers: true,
      mode: 'text/x-c++src',
      theme: 'dracula',
      tabSize: 4,
      indentUnit: 4,
      indentWithTabs: false,
    });
    loadFiles();
  }
}

function closeEditor() {
  editorModal.classList.remove('active');
}

editorBtn.addEventListener('click', openEditor);
closeEditorBtn.addEventListener('click', closeEditor);
saveBtn.addEventListener('click', saveFile);
fileSelect.addEventListener('change', (e) => {
  loadFileContent(e.target.value);
});

editorModal.addEventListener('click', (e) => {
  if (e.target === editorModal) {
    closeEditor();
  }
});
