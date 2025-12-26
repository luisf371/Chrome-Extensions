// options.js

const elements = {
  themeSelect: document.getElementById('theme-select'),
  timeoutInput: document.getElementById('timeout-input'),
  sortCheck: document.getElementById('sort-check'),
  sortScopeContainer: document.getElementById('sort-scope-container'),
  sortScopeRadios: document.getElementsByName('sort-scope'),
  statusMsg: document.getElementById('status-msg')
};

// Defaults
const defaults = {
  theme: 'light',
  scanTimeout: 5000,
  autoSort: false,
  sortScope: 'parent' // 'parent' or 'recursive'
};

// Load Settings
chrome.storage.local.get(['theme', 'scanTimeout', 'autoSort', 'sortScope'], (result) => {
  const settings = { ...defaults, ...result };

  // Theme
  elements.themeSelect.value = settings.theme;
  document.body.setAttribute('data-theme', settings.theme);

  // Timeout
  elements.timeoutInput.value = settings.scanTimeout / 1000;

  // Auto Sort
  elements.sortCheck.checked = settings.autoSort;
  toggleSortScope(settings.autoSort);

  // Sort Scope
  for (const radio of elements.sortScopeRadios) {
    if (radio.value === settings.sortScope) {
      radio.checked = true;
    }
  }
});

function toggleSortScope(enabled) {
  if (enabled) {
    elements.sortScopeContainer.classList.add('active');
  } else {
    elements.sortScopeContainer.classList.remove('active');
  }
}

function showStatus(msg) {
  elements.statusMsg.textContent = msg;
  setTimeout(() => {
    elements.statusMsg.textContent = '';
  }, 2000);
}

function saveSetting(key, value) {
  chrome.storage.local.set({ [key]: value }, () => {
    showStatus('Saved');
  });
}

// Listeners

elements.themeSelect.addEventListener('change', (e) => {
  const newTheme = e.target.value;
  document.body.setAttribute('data-theme', newTheme);
  saveSetting('theme', newTheme);
});

elements.timeoutInput.addEventListener('change', (e) => {
  let val = parseFloat(e.target.value);
  if (isNaN(val) || val < 1) val = 1;
  if (val > 60) val = 60;
  saveSetting('scanTimeout', val * 1000);
});

elements.sortCheck.addEventListener('change', (e) => {
  const checked = e.target.checked;
  toggleSortScope(checked);
  saveSetting('autoSort', checked);
});

for (const radio of elements.sortScopeRadios) {
  radio.addEventListener('change', (e) => {
    if (e.target.checked) {
      saveSetting('sortScope', e.target.value);
    }
  });
}
