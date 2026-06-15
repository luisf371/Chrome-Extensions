/**
 * sGestures Options Page
 * Auto-save with toast notification
 */

const colorCodes = {
  "red": "FF3300",
  "green": "008000",
  "blue": "00008B",
  "yellow": "FFFF00",
  "black": "000000"
};

const colorNames = {
  "FF3300": "red",
  "008000": "green",
  "00008B": "blue",
  "FFFF00": "yellow",
  "000000": "black"
};

const defaultGests = {
  "U": "newtab",
  "R": "forward",
  "L": "back",
  "D": "closetab"
};

const defaultRockerGests = {
  "RL": "back",
  "LR": "forward"
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

  // Color
  const colorSelect = document.getElementById("color");
  settings.colorCode = colorCodes[colorSelect.value];

  // Width
  const widthSelect = document.getElementById("width");
  settings.width = widthSelect.value;

  // Rocker
  const rocker = document.getElementById('rocker');
  settings.rocker = rocker.checked;

  // Trail
  const trail = document.getElementById('trail');
  settings.trail = trail.checked;

  // Gestures
  const gestures = ["U", "D", "L", "R"];
  gestures.forEach(gesture => {
    const select = document.getElementById(`gesture-${gesture}`);
    settings[gesture] = select.value;
  });

  // Rocker Gestures
  const rockerGestures = ["RL", "LR"];
  rockerGestures.forEach(gesture => {
    const select = document.getElementById(`rocker-${gesture}`);
    settings[`rocker${gesture}`] = select.value;
  });

  // Save all at once
  chrome.storage.local.set(settings, () => {
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
  const inputs = document.querySelectorAll('input, select');
  inputs.forEach(input => {
    input.addEventListener('change', queueSave);
  });
}

// =====================
// Restore Options
// =====================
function restoreOptions() {
  const gestures = ["U", "D", "L", "R"];
  const rockerGestures = ["RL", "LR"];
  const settingsToGet = ["colorCode", "width", "rocker", "trail", ...gestures, "rockerRL", "rockerLR"];
  
  chrome.storage.local.get(settingsToGet, (result) => {
    console.log("Restored options:", result);

    // Restore color
    const colorSelect = document.getElementById("color");
    const colorCode = result.colorCode || "FF3300";
    const colorName = colorNames[colorCode] || "red";
    colorSelect.value = colorName;

    // Restore width
    const widthSelect = document.getElementById("width");
    widthSelect.value = result.width || "3";

    // Restore rocker (default OFF unless explicitly enabled, matching content script)
    const rockerCheckbox = document.getElementById('rocker');
    rockerCheckbox.checked = result.rocker === true;

    // Restore trail (default OFF unless explicitly enabled, matching content script)
    const trailCheckbox = document.getElementById('trail');
    trailCheckbox.checked = result.trail === true;

    // Restore gestures
    gestures.forEach(gesture => {
      const gestureSelect = document.getElementById(`gesture-${gesture}`);
      gestureSelect.value = result[gesture] || defaultGests[gesture];
    });

    // Restore rocker gestures
    rockerGestures.forEach(gesture => {
      const rockerSelect = document.getElementById(`rocker-${gesture}`);
      rockerSelect.value = result[`rocker${gesture}`] || defaultRockerGests[gesture];
    });
  });
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
