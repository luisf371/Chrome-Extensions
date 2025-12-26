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
  themeToggle: document.getElementById('theme-toggle')
};

// Theme Logic (Sync with Report)
chrome.storage.local.get(['theme'], (result) => {
  const savedTheme = result.theme || 'light';
  document.body.setAttribute('data-theme', savedTheme);
});

elements.themeToggle.addEventListener('click', () => {
  const currentTheme = document.body.getAttribute('data-theme');
  const newTheme = currentTheme === 'light' ? 'dark' : 'light';
  document.body.setAttribute('data-theme', newTheme);
  chrome.storage.local.set({ theme: newTheme });
});

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
  // Enabled if there are any results from previous scans
  const hasResults = (state.broken && state.broken.length > 0) || dupCount > 0;
  const hasHistory = state.lastScanDateBroken || state.lastScanDateDuplicates;
  elements.btnReport.disabled = !(hasResults || hasHistory);

  // State Logic
  if (state.isScanning) {
    // Scanning
    disableAllActions();
    
    // Resume/Pause button logic is tricky with 3 buttons.
    // We will transform the active button into a "Pause/Scanning" indicator or just global status.
    // For simplicity, we disable all and show status.
    
    let modeText = 'Scanning...';
    if (state.mode === 'broken') modeText = 'Scanning for Broken Links...';
    if (state.mode === 'duplicates') modeText = 'Scanning for Duplicates...';
    
    elements.statusText.textContent = `${modeText} (${Math.round(percentage)}%)`;
    
    // Maybe turn the active button into "Stop/Pause"?
    // The prompt didn't strictly require pause for the split buttons, but it's good UX.
    // Let's keep it simple: "Scanning..." and if they close popup, it continues. 
    // If they re-open, they see progress.
    // If we want to allow Pause, we need a Pause button.
    // Existing logic had a toggle.
    // Let's add a "Pause" button or just change the active one? 
    // It's cleaner to just have a global "Stop/Pause" if running, but we don't have that UI space easily.
    // We'll leave the buttons disabled.
    
    // Actually, let's allow "Pause" by clicking the SAME button if we can?
    // But we disabled them.
    // Let's just update text for now.
    
  } else {
    // Not Scanning
    enableAllActions();
    
    // Check if Paused (started but not finished)
    if (state.total > 0 && state.checked < state.total && state.mode) {
       // Paused State
       elements.statusText.textContent = 'Scan Paused.';
       
       // Highlight the button that was paused to allow Resume
       if (state.mode === 'broken') {
         elements.btnBroken.textContent = 'Resume Broken Scan';
         elements.btnDuplicates.disabled = true;
         elements.btnSort.disabled = true;
       } else if (state.mode === 'duplicates') {
         elements.btnDuplicates.textContent = 'Resume Duplicate Scan';
         elements.btnBroken.disabled = true;
         elements.btnSort.disabled = true;
       }
    } else {
       // Idle / Finished
       resetButtonLabels();
       
       if (state.lastScanDateBroken || state.lastScanDateDuplicates) {
         elements.statusText.textContent = 'Ready.';
       } else {
         elements.statusText.textContent = 'Ready to scan.';
       }
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
  elements.btnBroken.textContent = 'Find Broken Links';
  elements.btnDuplicates.textContent = 'Find Duplicates';
  elements.btnSort.textContent = 'Sort Bookmarks';
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

elements.btnBroken.addEventListener('click', () => {
  if (elements.btnBroken.textContent.includes('Resume')) {
    chrome.runtime.sendMessage({ action: 'resumeScan' }, () => {
       elements.statusText.textContent = 'Resuming...';
       pollStatus();
    });
  } else {
    chrome.runtime.sendMessage({ action: 'startBrokenScan' }, () => {
      elements.statusText.textContent = 'Starting Broken Link Scan...';
      pollStatus();
    });
  }
});

elements.btnDuplicates.addEventListener('click', () => {
  if (elements.btnDuplicates.textContent.includes('Resume')) {
     chrome.runtime.sendMessage({ action: 'resumeScan' }, () => {
       elements.statusText.textContent = 'Resuming...';
       pollStatus();
    });
  } else {
    chrome.runtime.sendMessage({ action: 'startDuplicateScan' }, () => {
      elements.statusText.textContent = 'Starting Duplicate Scan...';
      pollStatus();
    });
  }
});

elements.btnSort.addEventListener('click', () => {
  disableAllActions();
  elements.statusText.textContent = 'Sorting...';
  chrome.runtime.sendMessage({ action: 'startSort' }, (response) => {
    enableAllActions();
    if (response && response.success) {
      elements.statusText.textContent = 'Sorting complete.';
    } else {
      elements.statusText.textContent = 'Sorting failed.';
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

// Initial check
pollStatus();