// options.js

const elements = {
  themeToggle: document.getElementById('themeToggle'),
  timeoutInput: document.getElementById('timeout-input'),
  sortCheck: document.getElementById('sort-check'),
  sortScopeContainer: document.getElementById('sort-scope-container'),
  sortScopeRadios: document.getElementsByName('sort-scope')
};

// Defaults
const defaults = {
  theme: 'dark',
  scanTimeout: 5000,
  autoSort: false,
  sortScope: 'parent' // 'parent' or 'recursive'
};

// =====================
// i18n Support
// =====================
function initI18n() {
  document.querySelectorAll('[data-i18n]').forEach(el => {
    const key = el.getAttribute('data-i18n');
    const message = chrome.i18n.getMessage(key);
    if (message) {
      if (el.children.length === 0) {
        el.textContent = message;
      } else if (el.tagName === 'OPTION') {
        el.textContent = message;
      }
    }
  });
  
  const titleMsg = chrome.i18n.getMessage('extName');
  if (titleMsg) {
    document.title = titleMsg + ' - ' + chrome.i18n.getMessage('optionsTitle');
  }
}

// =====================
// Theme Support
// =====================
function initTheme() {
  chrome.storage.local.get(['theme'], (result) => {
    const theme = result.theme || defaults.theme;
    applyTheme(theme);
  });
  
  if (elements.themeToggle) {
    elements.themeToggle.addEventListener('click', () => {
      const currentTheme = document.body.getAttribute('data-theme') || 'dark';
      const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
      applyTheme(newTheme);
      saveSetting('theme', newTheme);
    });
  }
  
  function applyTheme(theme) {
    document.body.setAttribute('data-theme', theme);
  }
}

// =====================
// Toast Notification
// =====================
let toastTimeout = null;
let toastVisible = false;

function showToast(message, type = 'success') {
  const toast = document.getElementById('toast');
  const toastIcon = toast.querySelector('.toast-icon');
  const toastMessage = toast.querySelector('.toast-message');
  
  if (!toast) return;

  if (toastTimeout) clearTimeout(toastTimeout);
  
  // Reset animation if already visible
  if (toastVisible) {
    toast.classList.remove('show');
    setTimeout(() => displayToast(), 100);
  } else {
    displayToast();
  }
  
  function displayToast() {
    if (message) toastMessage.textContent = message;
    toastIcon.textContent = type === 'success' ? '✓' : '✕';
    toast.className = 'toast ' + type;
    
    requestAnimationFrame(() => {
      toast.classList.add('show');
      toastVisible = true;
    });
    
    toastTimeout = setTimeout(() => {
      toast.classList.remove('show');
      toastVisible = false;
    }, 1500);
  }
}

// =====================
// Auto-Save
// =====================
let saveTimeout = null;

function saveSetting(key, value) {
  chrome.storage.local.set({ [key]: value }, () => {
    // Only show toast for non-theme changes to avoid visual clutter on toggle
    if (key !== 'theme') {
        const msg = chrome.i18n.getMessage('statusSaved') || 'Saved';
        showToast(msg, 'success');
    }
  });
}

function queueSave(key, value) {
  if (saveTimeout) clearTimeout(saveTimeout);
  saveTimeout = setTimeout(() => saveSetting(key, value), 300);
}

// =====================
// Load & Restore
// =====================
function restoreOptions() {
  chrome.storage.local.get(['scanTimeout', 'autoSort', 'sortScope'], (result) => {
    const settings = { ...defaults, ...result };

    // Timeout
    if (elements.timeoutInput) {
        elements.timeoutInput.value = settings.scanTimeout / 1000;
        elements.timeoutInput.addEventListener('change', (e) => {
            let val = parseFloat(e.target.value);
            if (isNaN(val) || val < 1) val = 1;
            if (val > 60) val = 60;
            queueSave('scanTimeout', val * 1000);
        });
    }

    // Auto Sort
    if (elements.sortCheck) {
        elements.sortCheck.checked = settings.autoSort;
        toggleSortScope(settings.autoSort);
        
        elements.sortCheck.addEventListener('change', (e) => {
            const checked = e.target.checked;
            toggleSortScope(checked);
            queueSave('autoSort', checked);
        });
    }

    // Sort Scope
    if (elements.sortScopeRadios) {
        for (const radio of elements.sortScopeRadios) {
            if (radio.value === settings.sortScope) {
                radio.checked = true;
            }
            radio.addEventListener('change', (e) => {
                if (e.target.checked) {
                    queueSave('sortScope', e.target.value);
                }
            });
        }
    }
  });
}

function toggleSortScope(enabled) {
  if (!elements.sortScopeContainer) return;
  // Toggle disabled class instead of hiding
  if (enabled) {
    elements.sortScopeContainer.classList.remove('disabled');
  } else {
    elements.sortScopeContainer.classList.add('disabled');
  }
}

// =====================
// Initialize
// =====================
document.addEventListener('DOMContentLoaded', () => {
  initI18n();
  initTheme();
  restoreOptions();
});
