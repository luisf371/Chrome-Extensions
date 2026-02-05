'use strict';

const DEFAULT_SETTINGS = Object.freeze({
   tabsBehaviour: 'default',
   tabsActivate: 'last_used',
   tabsOpenMethod: 'default',
   preventDuplicates: false,
   duplicateMode: 'teleport'
});

const SETTING_IDS = ['tabsBehaviour', 'tabsActivate', 'tabsOpenMethod', 'preventDuplicates', 'duplicateMode'];

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
  const themeToggle = document.getElementById('themeToggle');
  
  chrome.storage.local.get(['theme'], (result) => {
    const theme = result.theme || 'dark';
    applyTheme(theme);
  });
  
  themeToggle.addEventListener('click', () => {
    const currentTheme = document.body.getAttribute('data-theme') || 'dark';
    const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
    applyTheme(newTheme);
    chrome.storage.local.set({ theme: newTheme });
  });
  
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
  
  // Clear any existing timeout
  if (toastTimeout) {
    clearTimeout(toastTimeout);
  }
  
  // If toast is already visible, hide it first then reshow
  if (toastVisible) {
    toast.classList.remove('show');
    // Brief delay before showing again to create visual "reset"
    setTimeout(() => {
      displayToast();
    }, 100);
  } else {
    displayToast();
  }
  
  function displayToast() {
    // Set content
    toastMessage.textContent = message;
    toastIcon.textContent = type === 'success' ? '✓' : '✕';
    
    // Set type class
    toast.className = 'toast ' + type;
    
    // Show toast
    requestAnimationFrame(() => {
      toast.classList.add('show');
      toastVisible = true;
    });
    
    // Hide after delay
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

function saveOptions() {
  const settings = {};
  
  SETTING_IDS.forEach(id => {
    const element = document.getElementById(id);
    if (element) {
        if (element.type === 'checkbox') {
            settings[id] = element.checked;
        } else {
            settings[id] = element.value;
        }
    }
  });

  chrome.storage.sync.set(settings, () => {
    console.log("Settings saved:", settings);
    const msg = chrome.i18n.getMessage('statusSaved') || 'Saved';
    showToast(msg, 'success');
  });
}

function queueSave() {
  // Debounce saves - wait 300ms after last change
  if (saveTimeout) {
    clearTimeout(saveTimeout);
  }
  saveTimeout = setTimeout(saveOptions, 300);
}

function initAutoSave() {
  // Listen to all form changes
  SETTING_IDS.forEach(id => {
    const element = document.getElementById(id);
    if (element) {
        element.addEventListener('change', () => {
          if (id === 'preventDuplicates') {
            updateDuplicateModeVisibility(element.checked);
          }
          queueSave();
        });
    }
  });
}

function updateDuplicateModeVisibility(show) {
  const row = document.getElementById('duplicateModeRow');
  if (row) {
    row.style.display = show ? 'flex' : 'none';
  }
}

// =====================
// Restore Options
// =====================
async function restoreOptions() {
  await migrateLegacyPreferences();

  const settings = await chrome.storage.sync.get(DEFAULT_SETTINGS);
  
  SETTING_IDS.forEach(id => {
      const element = document.getElementById(id);
      if (element) {
          if (element.type === 'checkbox') {
              element.checked = settings[id] ?? DEFAULT_SETTINGS[id];
              if (id === 'preventDuplicates') {
                updateDuplicateModeVisibility(element.checked);
              }
          } else {
              element.value = settings[id] || DEFAULT_SETTINGS[id];
          }
      }
  });
}

async function migrateLegacyPreferences() {
   const legacyValues = {};
   let hasLegacyData = false;
   for (const key of Object.keys(DEFAULT_SETTINGS)) {
      const value = window.localStorage.getItem(key);
      if (value !== null) {
         legacyValues[key] = value;
         hasLegacyData = true;
      }
   }
   if (!hasLegacyData) return;
   
   const current = await chrome.storage.sync.get(Object.keys(DEFAULT_SETTINGS));
   const updates = {};
   for (const [key, value] of Object.entries(legacyValues)) {
      if (!Object.prototype.hasOwnProperty.call(current, key)) {
         updates[key] = value;
      }
      window.localStorage.removeItem(key);
   }
   if (Object.keys(updates).length > 0) {
      await chrome.storage.sync.set(updates);
   }
}

// =====================
// Initialize
// =====================
document.addEventListener('DOMContentLoaded', function() {
  console.log("Options page loaded");
  
  // Detect popup mode
  if (new URLSearchParams(location.search).has('popup')) {
    document.body.classList.add('popup');
  }
  
  initI18n();
  initTheme();
  restoreOptions();
  initAutoSave();
});
