// popup.js

const elements = {
  statusText: document.getElementById('status-text'),
  progressBar: document.getElementById('progress-bar'),
  progressCounts: document.getElementById('progress-counts'),
  brokenCount: document.getElementById('broken-count'),
  duplicateCount: document.getElementById('duplicate-count'),
  btnScan: document.getElementById('btn-scan'),
  btnReport: document.getElementById('btn-report')
};

let pollInterval;

function updateUI(state) {
  if (state.isScanning) {
    elements.btnScan.disabled = true;
    elements.btnScan.textContent = 'Scanning...';
    elements.statusText.textContent = 'Scanning bookmarks...';
  } else {
    elements.btnScan.disabled = false;
    elements.btnScan.textContent = 'Start Scan & Sort';
    
    if (state.total > 0) {
       elements.statusText.textContent = 'Scan complete.';
    }
  }

  // Calculate Progress
  // Note: Total might increase as we traverse if we count dynamically, 
  // but in our logic we count during sort.
  const percentage = state.total > 0 ? Math.round((state.checked / state.total) * 100) : 0;
  
  elements.progressBar.style.width = `${percentage}%`;
  elements.progressCounts.textContent = `${state.checked} / ${state.total}`;
  
  elements.brokenCount.textContent = state.broken.length;
  
  // Calculate duplicates count (number of URLs with > 1 entry)
  let dupCount = 0;
  Object.values(state.duplicates).forEach(list => {
    if (list.length > 1) dupCount++;
  });
  elements.duplicateCount.textContent = dupCount;

  if (!state.isScanning && (state.broken.length > 0 || dupCount > 0)) {
    elements.btnReport.disabled = false;
  } else {
    elements.btnReport.disabled = true;
  }
}

function pollStatus() {
  chrome.runtime.sendMessage({ action: 'getStatus' }, (response) => {
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
  chrome.runtime.sendMessage({ action: 'startScan' }, (response) => {
    elements.statusText.textContent = 'Starting...';
    pollStatus();
  });
});

elements.btnReport.addEventListener('click', () => {
  chrome.runtime.sendMessage({ action: 'openReport' });
});

// Initial check
pollStatus();
