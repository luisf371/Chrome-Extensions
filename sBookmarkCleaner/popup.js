// popup.js

const elements = {
  statusText: document.getElementById('status-text'),
  progressBar: document.getElementById('progress-bar'),
  progressCounts: document.getElementById('progress-counts'),
  brokenCount: document.getElementById('broken-count'),
  duplicateCount: document.getElementById('duplicate-count'),
  lastScanBroken: document.getElementById('last-scan-broken'),
  lastScanDuplicates: document.getElementById('last-scan-duplicates'),
  btnBroken: document.getElementById('btn-broken'),
  btnDuplicates: document.getElementById('btn-duplicates'),
  btnSort: document.getElementById('btn-sort'),
  btnReport: document.getElementById('btn-report'),
  themeToggle: document.getElementById('theme-toggle'),
  scanControls: document.getElementById('scan-controls'),
  btnPause: document.getElementById('btn-pause'),
  btnCancel: document.getElementById('btn-cancel')
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
}

// Theme Logic (Sync with Report)
chrome.storage.local.get(['theme'], (result) => {
  const savedTheme = result.theme || 'dark';
  document.body.setAttribute('data-theme', savedTheme);
});

if (elements.themeToggle) {
    elements.themeToggle.addEventListener('click', () => {
      const currentTheme = document.body.getAttribute('data-theme');
      const newTheme = currentTheme === 'light' ? 'dark' : 'light';
      document.body.setAttribute('data-theme', newTheme);
      chrome.storage.local.set({ theme: newTheme });
    });
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.theme) {
    document.body.setAttribute('data-theme', changes.theme.newValue);
  }
});

let pollInterval;

function formatTimestamp(ts) {
  if (!ts) return 'Never scanned';
  const date = new Date(ts);
  const now = new Date();
  
  // If today, show time, else show date
  if (date.toDateString() === now.toDateString()) {
    return `Today at ${date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
  }
  return date.toLocaleDateString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function updateUI(state) {
  // Calculate Progress
  const percentage = state.total > 0 ? Math.round((state.checked / state.total) * 100) : 0;
  elements.progressBar.style.width = `${percentage}%`;
  elements.progressCounts.textContent = `${state.checked} / ${state.total}`;
  
  // Update Stats
  elements.brokenCount.textContent = state.broken ? state.broken.length : 0;
  
  let dupCount = 0;
  if (state.duplicates) {
    Object.values(state.duplicates).forEach(list => {
      if (list.length > 1) dupCount++;
    });
  }
  elements.duplicateCount.textContent = dupCount;

  // Update Timestamps
  elements.lastScanBroken.textContent = formatTimestamp(state.lastScanDateBroken);
  elements.lastScanDuplicates.textContent = formatTimestamp(state.lastScanDateDuplicates);

  // Determine if report should be enabled
  const hasResults = (state.broken && state.broken.length > 0) || dupCount > 0;
  const hasHistory = state.lastScanDateBroken || state.lastScanDateDuplicates;
  elements.btnReport.disabled = !(hasResults || hasHistory);

  // Scan Logic (Active or Paused)
  if (state.mode) {
    // In a scan session
    disableAllActions();
    elements.scanControls.style.display = 'flex';
    
    if (state.isScanning) {
      // Running
      elements.btnPause.title = 'Pause';
      elements.btnPause.innerHTML = '<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg>';
      
      let modeText = chrome.i18n.getMessage('statusScanning');
      if (state.mode === 'broken') modeText = chrome.i18n.getMessage('statusScanningBroken');
      if (state.mode === 'duplicates') modeText = chrome.i18n.getMessage('statusScanningDuplicates');
      elements.statusText.textContent = `${modeText} (${Math.round(percentage)}%)`;
    } else {
      // Paused
      elements.btnPause.title = 'Resume';
      elements.btnPause.innerHTML = '<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>';
      elements.statusText.textContent = chrome.i18n.getMessage('statusPaused');
    }
  } else {
    // Idle - Ensure buttons are enabled immediately
    enableAllActions();
    elements.scanControls.style.display = 'none';
    
    if (state.lastScanDateBroken || state.lastScanDateDuplicates) {
       // "Ready." is not in messages.json, I used statusReady for "Ready to scan."
       // I'll reuse statusReady for both cases or just use "Ready" text if strict i18n not required for dynamic small texts, 
       // but better to be consistent. I'll use statusReady for now.
      elements.statusText.textContent = chrome.i18n.getMessage('statusReady'); 
    } else {
      elements.statusText.textContent = chrome.i18n.getMessage('statusReady');
    }
  }
}

function disableAllActions() {
  elements.btnBroken.disabled = true;
  elements.btnDuplicates.disabled = true;
  elements.btnSort.disabled = true;
}

function enableAllActions() {
  elements.btnBroken.disabled = false;
  elements.btnDuplicates.disabled = false;
  elements.btnSort.disabled = false;
}

function resetButtonLabels() {
  elements.btnBroken.textContent = chrome.i18n.getMessage('btnFindBroken');
  elements.btnDuplicates.textContent = chrome.i18n.getMessage('btnFindDuplicates');
  elements.btnSort.textContent = chrome.i18n.getMessage('btnSortBookmarks');
}

function pollStatus() {
  chrome.runtime.sendMessage({ action: 'getStatus' }, (response) => {
    if (chrome.runtime.lastError) return;
    if (response) {
      updateUI(response);
      if (response.isScanning && !pollInterval) {
        pollInterval = setInterval(pollStatus, 1000);
      } else if (!response.isScanning && pollInterval) {
        clearInterval(pollInterval);
        pollInterval = null;
      }
    }
  });
}

// Event Listeners

elements.btnPause.addEventListener('click', () => {
  if (elements.btnPause.title === 'Pause') {
    chrome.runtime.sendMessage({ action: 'pauseScan' }, () => {
      elements.statusText.textContent = chrome.i18n.getMessage('statusPausing');
      pollStatus();
    });
  } else {
    chrome.runtime.sendMessage({ action: 'resumeScan' }, () => {
      elements.statusText.textContent = chrome.i18n.getMessage('statusResuming');
      pollStatus();
    });
  }
});

elements.btnCancel.addEventListener('click', () => {
  chrome.runtime.sendMessage({ action: 'cancelScan' }, () => {
    elements.statusText.textContent = chrome.i18n.getMessage('statusCancelling');
    pollStatus();
  });
});

elements.btnBroken.addEventListener('click', () => {
  chrome.runtime.sendMessage({ action: 'startBrokenScan' }, () => {
    elements.statusText.textContent = chrome.i18n.getMessage('statusStartingBroken');
    pollStatus();
  });
});

elements.btnDuplicates.addEventListener('click', () => {
  chrome.runtime.sendMessage({ action: 'startDuplicateScan' }, () => {
    elements.statusText.textContent = chrome.i18n.getMessage('statusStartingDuplicates');
    pollStatus();
  });
});

elements.btnSort.addEventListener('click', () => {
  disableAllActions();
  elements.statusText.textContent = chrome.i18n.getMessage('statusSorting');
  chrome.runtime.sendMessage({ action: 'startSort' }, (response) => {
    enableAllActions();
    if (response && response.success) {
      elements.statusText.textContent = chrome.i18n.getMessage('statusSortingComplete');
    } else {
      elements.statusText.textContent = chrome.i18n.getMessage('statusSortingFailed');
    }
  });
});

elements.btnReport.addEventListener('click', () => {
  chrome.runtime.sendMessage({ action: 'openReport' });
});

document.getElementById('btn-options').addEventListener('click', () => {
  if (chrome.runtime.openOptionsPage) {
    chrome.runtime.openOptionsPage();
  } else {
    window.open(chrome.runtime.getURL('options.html'));
  }
});

// Initialize
document.addEventListener('DOMContentLoaded', () => {
  initI18n();
  pollStatus();
});
