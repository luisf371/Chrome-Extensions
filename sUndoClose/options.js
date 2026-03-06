/**
 * sUndoClose Options Page
 * Unified design following UI_DESIGN.md
 * Auto-save with toast notification
 */

import { getStorage, setStorage, removeStorage, setBadge, updateIcon, getSessionStorage, removeFromSearchIndex, CLOSEDTAB_PREFIX } from './common.js';

async function initStats() {
  const [localData, sessionData] = await Promise.all([
    getStorage(['restoreCountAllTime', 'installDate']),
    getSessionStorage(['restoreCountSession'])
  ]);
  
  const sessionEl = document.getElementById('stat-session');
  const alltimeEl = document.getElementById('stat-alltime');
  const daysEl = document.getElementById('stat-days');
  const installDateEl = document.getElementById('stats-install-date');
  
  if (sessionEl) sessionEl.textContent = sessionData.restoreCountSession || 0;
  if (alltimeEl) alltimeEl.textContent = localData.restoreCountAllTime || 0;
  
  if (localData.installDate) {
    const installDate = new Date(localData.installDate);
    const today = new Date();
    const daysActive = Math.floor((today - installDate) / (1000 * 60 * 60 * 24));
    
    if (daysEl) daysEl.textContent = daysActive > 0 ? daysActive : 1;
    
    if (installDateEl) {
      const formatted = installDate.toLocaleDateString(undefined, {
        year: 'numeric',
        month: 'short',
        day: 'numeric'
      });
      installDateEl.textContent = `Installed: ${formatted}`;
    }
  } else {
    if (daysEl) daysEl.textContent = '1';
    if (installDateEl) installDateEl.textContent = '';
  }
}

// =====================
// i18n Support
// =====================
function initI18n() {
  document.querySelectorAll('[data-i18n]').forEach(el => {
    const key = el.getAttribute('data-i18n');
    const message = chrome.i18n.getMessage(key);
    if (message) {
      if (el.children.length === 0 || el.tagName === 'OPTION') {
        el.textContent = message;
      }
    }
  });
  
  const titleMsg = chrome.i18n.getMessage('extName');
  if (titleMsg) {
    document.title = titleMsg + ' Options';
  }
}

// =====================
// Theme Support (Sun/Moon Toggle)
// =====================
async function initTheme() {
  const themeToggle = document.getElementById('themeToggle');
  
  const data = await getStorage(['settings']);
  const settings = data.settings || {};
  const theme = settings.theme || 'dark';
  applyTheme(theme);
  
  themeToggle.addEventListener('click', async () => {
    const currentTheme = document.body.getAttribute('data-theme') || 'dark';
    const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
    applyTheme(newTheme);
    
    const data = await getStorage(['settings']);
    const settings = data.settings || {};
    settings.theme = newTheme;
    await setStorage({ settings: settings });
    await updateIcon();
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
  
  if (toastTimeout) {
    clearTimeout(toastTimeout);
  }
  
  // If visible, hide first then reshow (visual feedback for concurrent saves)
  if (toastVisible) {
    toast.classList.remove('show');
    setTimeout(() => displayToast(), 100);
  } else {
    displayToast();
  }
  
  function displayToast() {
    toastMessage.textContent = message;
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
let settings = {};

async function saveOptions() {
  // Gather all settings
  settings.showClear = document.getElementById('showClear').checked;
  settings.showBadge = document.getElementById('showBadge').checked;
  settings.showTime = document.getElementById('showTime').checked;
  settings.showSearch = document.getElementById('showSearch').checked;
  settings.saveHistory = document.getElementById('saveHistory').checked;
  settings.removeHistory = document.getElementById('removeHistory').checked;
  settings.menuTop = document.getElementById('menuTop').checked;
  settings.tooltipText = document.getElementById('tooltipText').checked;
  settings.useAlternateIcon = document.getElementById('useAlternateIcon').checked;
  settings.mClickClose = document.getElementById('mClickClose').checked;
  
  settings.searchMode = document.getElementById('searchMode').value;
  settings.style = document.getElementById('popupStyle').value;
  
  settings.longPressDelay = document.getElementById('longPressDelay').value;
  settings.popupWidth = parseInt(document.getElementById('popupWidth').value, 10);
  settings.numLimit = Math.max(20, Math.min(200, parseInt(document.getElementById('numLimit').value, 10) || 60));
  settings.numItems = Math.max(5, Math.min(80, parseInt(document.getElementById('numItems').value, 10) || 15));
  settings.numLines = Math.max(1, Math.min(3, parseInt(document.getElementById('numLines').value, 10) || 2));
  
  await setStorage({ settings: settings });
  
  // Update background/badge state
  let data = await getStorage(['ClosedTabIndex']);
  let closedTabIndex = data.ClosedTabIndex || [];
  
  if (closedTabIndex.length > settings.numLimit) {
    await trimTabs(settings.numLimit);
  }
  await setBadge();
  await updateIcon();
  
  // Show toast
  const msg = chrome.i18n.getMessage('statusSaved') || 'Saved';
  showToast(msg, 'success');
}

function queueSave() {
  if (saveTimeout) {
    clearTimeout(saveTimeout);
  }
  saveTimeout = setTimeout(saveOptions, 300);
}

function initAutoSave() {
  const inputs = document.querySelectorAll('input, select');
  inputs.forEach(input => {
    // Skip buttons
    if (input.type === 'button' || input.tagName === 'BUTTON') return;
    input.addEventListener('change', queueSave);
  });
}

// =====================
// Trim Tabs Helper
// =====================
async function trimTabs(tablimit) {
  await navigator.locks.request('sUndoClose_data', async (lock) => {
    let data = await getStorage(['ClosedTabIndex']);
    let closedTabIndex = data.ClosedTabIndex || [];
    
    const noToDelete = closedTabIndex.length - tablimit;
    
    if (noToDelete <= 0) {
      return;
    }
    
    let keysToRemove = [];
    let idsToRemove = [];
    for (let i = 0; i < noToDelete; i++) {
      if (closedTabIndex.length > 0) {
        const id = closedTabIndex[0];
        keysToRemove.push(CLOSEDTAB_PREFIX + id);
        idsToRemove.push(id);
        closedTabIndex.shift();
      } else {
        break;
      }
    }
    
    if (keysToRemove.length > 0) {
      await removeStorage(keysToRemove);
      await removeFromSearchIndex(idsToRemove);
    }
    await setStorage({ ClosedTabIndex: closedTabIndex });
  });
}

// =====================
// Restore Options
// =====================
async function restoreOptions() {
  let data = await getStorage(['settings']);
  settings = data.settings || {};
  
  // Checkboxes
  const setChecked = (id, val) => {
    const el = document.getElementById(id);
    if (el) el.checked = !!val;
  };
  
  setChecked('showClear', settings.showClear);
  setChecked('showBadge', settings.showBadge);
  setChecked('showTime', settings.showTime);
  setChecked('showSearch', settings.showSearch);
  setChecked('saveHistory', settings.saveHistory);
  setChecked('removeHistory', settings.removeHistory);
  setChecked('menuTop', settings.menuTop);
  setChecked('tooltipText', settings.tooltipText);
  setChecked('useAlternateIcon', settings.useAlternateIcon);
  setChecked('mClickClose', settings.mClickClose);
  
  // Selects
  const setSelect = (id, val, defaultVal) => {
    const el = document.getElementById(id);
    if (el) el.value = val || defaultVal;
  };
  
  setSelect('searchMode', settings.searchMode, '1');
  setSelect('popupStyle', settings.style, '1');
  setSelect('popupWidth', settings.popupWidth, '400');
  setSelect('numLimit', settings.numLimit, '60');
  setSelect('numItems', settings.numItems, '15');
  setSelect('numLines', settings.numLines, '2');
  
  // Number input
  const lpDelay = document.getElementById('longPressDelay');
  if (lpDelay) {
    lpDelay.value = settings.longPressDelay || 1;
  }
}

// =====================
// Button Actions
// =====================
function initButtons() {
  // Clear History
  const resetButton = document.getElementById('resetButton');
  if (resetButton) {
    resetButton.addEventListener('click', async () => {
      const msg = chrome.i18n.getMessage('opt_resetbtn_popupMsg') || 'Clear all history?';
      if (confirm(msg)) {
        await navigator.locks.request('sUndoClose_data', async (lock) => {
          await setStorage({ ClosedTabIndex: [], SearchIndex: [] });
          // Remove all ClosedTab-* entries
          let data = await getStorage(null);
          let keysToRemove = Object.keys(data).filter(k => k.startsWith('ClosedTab-'));
          if (keysToRemove.length > 0) {
            await removeStorage(keysToRemove);
          }
        });
        await setBadge();
        showToast('History cleared', 'success');
      }
    });
  }
  
  // Keyboard Shortcuts
  const kbBtn = document.getElementById('openKBshort');
  if (kbBtn) {
    kbBtn.addEventListener('click', () => {
      if (window.navigator.vendor === "Opera Software ASA" || window.navigator.userAgent.includes("OPR/")) {
        chrome.tabs.create({ url: 'chrome://settings/configureCommands' });
      } else {
        chrome.tabs.create({ url: 'chrome://extensions/configureCommands' });
      }
    });
  }
}

// =====================
// Initialize
// =====================
document.addEventListener('DOMContentLoaded', async function() {
  // Detect popup mode
  if (new URLSearchParams(location.search).has('popup')) {
    document.body.classList.add('popup');
  }
  
  const manifest = chrome.runtime.getManifest();
  const versionBadge = document.querySelector('.version-badge');
  if (versionBadge) {
    versionBadge.textContent = 'v' + manifest.version;
  }
  
  initI18n();
  await initTheme();
  await restoreOptions();
  await initStats();
  initAutoSave();
  initButtons();
  await updateIcon();
});
