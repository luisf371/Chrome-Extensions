/**
 * sGestures Options Page
 * Updated with unified theme support and i18n
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

// =====================
// i18n Support
// =====================
function initI18n() {
  // Translate all elements with data-i18n attribute
  document.querySelectorAll('[data-i18n]').forEach(el => {
    const key = el.getAttribute('data-i18n');
    const message = chrome.i18n.getMessage(key);
    if (message) {
      // For elements with child nodes (like options), only set text if it's a leaf
      if (el.children.length === 0) {
        el.textContent = message;
      } else if (el.tagName === 'OPTION') {
        el.textContent = message;
      }
    }
  });
  
  // Update page title
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
  const themeIcon = themeToggle.querySelector('.theme-icon');
  
  // Load saved theme or default to dark
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
    if (theme === 'light') {
      document.body.setAttribute('data-theme', 'light');
      themeIcon.textContent = '☀️';
    } else {
      document.body.removeAttribute('data-theme');
      themeIcon.textContent = '🌙';
    }
  }
}

// =====================
// Options Save/Restore
// =====================
function save_options() {
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

  // Save all at once
  chrome.storage.local.set(settings, () => {
    console.log("Settings saved:", settings);
    showStatus('success', chrome.i18n.getMessage('statusSaved') || 'Configuration Saved');
  });
}

function restore_options() {
  const gestures = ["U", "D", "L", "R"];
  const settingsToGet = ["colorCode", "width", "rocker", "trail", ...gestures];
  
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

    // Restore rocker
    const rockerCheckbox = document.getElementById('rocker');
    rockerCheckbox.checked = result.rocker !== false; // Default to true

    // Restore trail
    const trailCheckbox = document.getElementById('trail');
    trailCheckbox.checked = result.trail !== false; // Default to true

    // Restore gestures
    gestures.forEach(gesture => {
      const gestureSelect = document.getElementById(`gesture-${gesture}`);
      gestureSelect.value = result[gesture] || defaultGests[gesture];
    });
  });
}

// =====================
// Status Messages
// =====================
function showStatus(type, message) {
  const status = document.getElementById("status");
  status.textContent = message;
  status.className = `status-message ${type}`;
  
  setTimeout(() => {
    status.textContent = '';
    status.className = 'status-message';
  }, 2000);
}

// =====================
// Initialize
// =====================
document.addEventListener('DOMContentLoaded', function() {
  console.log("Options page loaded");
  
  // Initialize i18n (will use fallback text if no locales exist yet)
  initI18n();
  
  // Initialize theme
  initTheme();
  
  // Restore saved options
  restore_options();
  
  // Save button handler
  document.getElementById('save').addEventListener('click', save_options);
});
