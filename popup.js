// popup.js

const elements = {
  statusText: document.getElementById('status-text'),
  progressBar: document.getElementById('progress-bar'),
  progressCounts: document.getElementById('progress-counts'),
  brokenCount: document.getElementById('broken-count'),
  duplicateCount: document.getElementById('duplicate-count'),
  btnScan: document.getElementById('btn-scan'),
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
let currentAction = 'startScan'; // default

function updateUI(state) {
  // Calculate Progress
  const percentage = state.total > 0 ? Math.round((state.checked / state.total) * 100) : 0;
  elements.progressBar.style.width = `${percentage}%`;
  elements.progressCounts.textContent = `${state.checked} / ${state.total}`;
  
  elements.brokenCount.textContent = state.broken.length;
  
  // Calculate duplicates count (number of URLs with > 1 entry)
  let dupCount = 0;
  if (state.duplicates) {
    Object.values(state.duplicates).forEach(list => {
      if (list.length > 1) dupCount++;
    });
  }
  elements.duplicateCount.textContent = dupCount;

  // State Logic
  if (state.isScanning) {
    // Scanning
    elements.btnScan.disabled = true;
    elements.btnScan.textContent = 'Scanning...';
    elements.statusText.textContent = `Scanning bookmarks... (${Math.round(percentage)}%)`;
    elements.btnReport.disabled = true;
    
  } else {
    // Not Scanning (Idle, Paused, or Finished)
    elements.btnScan.disabled = false;
    
    // Check if Paused (started but not finished)
    // We assume if checked < total and total > 0, it's paused.
    // NOTE: This relies on total being accurate.
    if (state.total > 0 && state.checked < state.total) {
       // Paused State
       elements.statusText.textContent = 'Scan Paused.';
       elements.btnScan.textContent = 'Resume Scan';
       currentAction = 'resumeScan';
       
       // Allow reporting even if paused? Yes, why not see what we found so far.
       elements.btnReport.disabled = (state.broken.length === 0 && dupCount === 0);

    } else {
       // Finished or Fresh State
       elements.btnScan.textContent = 'Start New Scan';
       currentAction = 'startScan';
       
       if (state.total > 0) {
          elements.statusText.textContent = 'Scan complete.';
       } else if (state.lastScanDate) {
          elements.statusText.textContent = 'Scan complete (0 items found).';
       } else {
          elements.statusText.textContent = 'Ready to scan.';
       }

       elements.btnReport.disabled = (state.broken.length === 0 && dupCount === 0);
    }
  }
}

function pollStatus() {
  chrome.runtime.sendMessage({ action: 'getStatus' }, (response) => {
    if (chrome.runtime.lastError) {
      // If extension reloaded, this might fail temporarily
      console.warn(chrome.runtime.lastError);
      return;
    }
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

elements.btnScan.addEventListener('click', () => {
  if (currentAction === 'resumeScan') {
    chrome.runtime.sendMessage({ action: 'resumeScan' }, () => {
       elements.statusText.textContent = 'Resuming...';
       pollStatus();
    });
  } else {
    // Start New Scan
    chrome.runtime.sendMessage({ action: 'startScan' }, () => {
      elements.statusText.textContent = 'Starting...';
      pollStatus();
    });
  }
});

elements.btnReport.addEventListener('click', () => {
  chrome.runtime.sendMessage({ action: 'openReport' });
});

// Initial check
pollStatus();