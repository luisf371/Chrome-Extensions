// report.js

const elements = {
  brokenTableBody: document.querySelector('#broken-table tbody'),
  brokenEmpty: document.getElementById('broken-empty'),
  brokenCount: document.getElementById('broken-count'),
  deleteBrokenBtn: document.getElementById('delete-broken-btn'),
  recheckBtn: document.getElementById('recheck-btn'),
  ignoreBtn: document.getElementById('ignore-btn'),
  openBtn: document.getElementById('open-btn'),
  selectAllBroken: document.getElementById('select-all-broken'),
  filterContainer: document.getElementById('filter-container'),
  
  duplicatesList: document.getElementById('duplicates-list'),
  dupEmpty: document.getElementById('dup-empty'),
  dupCount: document.getElementById('dup-count'),
  deleteDupBtn: document.getElementById('delete-dup-btn'),
  dupActions: document.getElementById('dup-actions'),
  clearReportBtn: document.getElementById('clear-report-btn'),
  
  themeToggle: document.getElementById('themeToggle'),
  btnOptions: document.getElementById('btn-options')
};

let currentState = null;
let currentFilter = null; // Filter by status code
let selectedIds = new Set(); // Store selected IDs globally

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

// Theme Logic
// 1. Load saved theme
chrome.storage.local.get(['theme'], (result) => {
  const savedTheme = result.theme || 'dark';
  document.body.setAttribute('data-theme', savedTheme);
});

// 2. Handle toggle (guarded so one missing element can't abort the whole
// report script at load time and leave the page un-rendered).
if (elements.themeToggle) {
  elements.themeToggle.addEventListener('click', () => {
    const currentTheme = document.body.getAttribute('data-theme');
    const newTheme = currentTheme === 'light' ? 'dark' : 'light';
    document.body.setAttribute('data-theme', newTheme);
    chrome.storage.local.set({ theme: newTheme });
  });
}

// 3. Listen for changes (Sync)
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.theme) {
    document.body.setAttribute('data-theme', changes.theme.newValue);
  }
});

const statusDescriptions = {
  400: 'Bad Request',
  401: 'Unauthorized',
  403: 'Forbidden',
  404: 'Not Found',
  405: 'Method Not Allowed',
  408: 'Request Timeout',
  410: 'Gone',
  429: 'Too Many Requests',
  500: 'Internal Server Error',
  502: 'Bad Gateway',
  503: 'Service Unavailable',
  504: 'Gateway Timeout',
  'DNS Error': 'DNS Error'
};

function render(state) {
  currentState = state;
  
  // Render Dates
  const brokenDateSpan = document.getElementById('broken-date');
  const dupDateSpan = document.getElementById('dup-date');
  
  if (state.lastScanDateBroken) {
    brokenDateSpan.textContent = new Date(state.lastScanDateBroken).toLocaleString();
  } else {
    brokenDateSpan.textContent = chrome.i18n.getMessage('textNever');
  }

  if (state.lastScanDateDuplicates) {
    dupDateSpan.textContent = new Date(state.lastScanDateDuplicates).toLocaleString();
  } else {
    dupDateSpan.textContent = chrome.i18n.getMessage('textNever');
  }

  renderBroken(state.broken);
  renderDuplicates(state.duplicates);
}

function getStatusLabel(status) {
  if (status === 'DNS Error' || status === 'Error') return 'DNS Error';
  const desc = statusDescriptions[status] || 'Unknown Error';
  return `${status} - ${desc}`;
}

function renderBroken(brokenList) {
  elements.brokenTableBody.innerHTML = '';
  
  // Apply Filter
  let displayList = brokenList;
  if (currentFilter) {
    displayList = brokenList.filter(item => String(item.status) === String(currentFilter));
    
    // Render Filter Bar
    elements.filterContainer.style.display = 'block';
    elements.filterContainer.innerHTML = `
      <div class="filter-bar">
        <span>Filtering by: <strong>${getStatusLabel(currentFilter)}</strong> (${displayList.length})</span>
        <button id="clear-filter-btn">Clear Filter (x)</button>
      </div>
    `;
    document.getElementById('clear-filter-btn').addEventListener('click', () => {
      currentFilter = null;
      render(currentState);
    });
  } else {
    elements.filterContainer.style.display = 'none';
  }

  // Update Global Count (Total Findings)
  elements.brokenCount.textContent = brokenList.length;

  if (displayList.length === 0) {
    if (brokenList.length > 0 && currentFilter) {
        // Filter result is empty
        elements.brokenTableBody.innerHTML = '<tr><td colspan="4" style="text-align:center; padding: 20px;">No findings matching this filter.</td></tr>';
    } else {
        // Total list is empty
        elements.brokenTableBody.parentElement.style.display = 'none';
        elements.brokenEmpty.style.display = 'block';
    }
    // Update button state based on global selection, not just visible
    updateBrokenButtonState();
    return;
  }

  elements.brokenTableBody.parentElement.style.display = 'table';
  elements.brokenEmpty.style.display = 'none';

  displayList.forEach(item => {
    const isChecked = selectedIds.has(item.id);
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><input type="checkbox" class="broken-check" data-id="${item.id}" ${isChecked ? 'checked' : ''}></td>
      <td class="selectable-cell">
        <strong>${escapeHtml(item.title)}</strong><br>
        <span class="path-col">${escapeHtml(item.path)}</span>
      </td>
      <td><a href="${safeHref(item.url)}" target="_blank" rel="noopener noreferrer" class="url-col">${escapeHtml(item.url)}</a></td>
      <td><span class="status-badge ${item.status == 404 ? 'status-404' : 'status-error'}" data-status="${item.status}">${getStatusLabel(item.status)}</span></td>
    `;
    elements.brokenTableBody.appendChild(tr);
  });
  
  // Re-attach status click listeners
  document.querySelectorAll('.status-badge').forEach(badge => {
    badge.addEventListener('click', (e) => {
      currentFilter = e.target.dataset.status;
      render(currentState);
    });
  });
  
  updateBrokenButtonState();
}

function renderDuplicates(duplicatesMap) {
  elements.duplicatesList.innerHTML = '';
  
  // Filter for actual duplicates (count > 1)
  const dupGroups = Object.entries(duplicatesMap).filter(([url, items]) => items.length > 1);
  
  elements.dupCount.textContent = dupGroups.length;

  if (dupGroups.length === 0) {
    elements.dupEmpty.style.display = 'block';
    elements.deleteDupBtn.disabled = true;
    elements.dupActions.style.display = 'none';
    return;
  }

  elements.dupEmpty.style.display = 'none';
  elements.dupActions.style.display = 'flex';

  dupGroups.forEach(([url, items]) => {
    const group = document.createElement('div');
    group.className = 'dup-group';
    
    let itemsHtml = '<table style="margin:0; width:100%;"><tbody>';
    items.forEach(item => {
      itemsHtml += `
        <tr>
            <td style="width:30px; border:none;"><input type="checkbox" class="dup-check" data-id="${item.id}"></td>
            <td style="border:none;">
                <strong>${escapeHtml(item.title)}</strong>
                <div class="path-col">${escapeHtml(item.path)}</div>
            </td>
        </tr>
      `;
    });
    itemsHtml += '</tbody></table>';

    group.innerHTML = `
      <div class="dup-header">
        <a href="${safeHref(url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(url)}</a>
      </div>
      ${itemsHtml}
    `;
    elements.duplicatesList.appendChild(group);
  });
}

function updateBrokenButtonState() {
  const count = selectedIds.size;
  const countStr = count > 0 ? ` (${count})` : '';

  elements.deleteBrokenBtn.disabled = count === 0;
  elements.deleteBrokenBtn.textContent = chrome.i18n.getMessage('btnDeleteSelected') + countStr;
  
  elements.recheckBtn.disabled = count === 0;
  elements.recheckBtn.textContent = chrome.i18n.getMessage('btnRecheckSelected') + countStr;

  elements.ignoreBtn.disabled = count === 0;
  elements.ignoreBtn.textContent = chrome.i18n.getMessage('btnIgnoreSelected') + countStr;
  
  elements.openBtn.disabled = count === 0;
  elements.openBtn.textContent = chrome.i18n.getMessage('btnOpenSelected') + countStr;

  // Update "Select All" checkbox state based on visible items
  const visibleChecks = Array.from(document.querySelectorAll('.broken-check'));
  if (visibleChecks.length > 0) {
    const allVisibleChecked = visibleChecks.every(c => c.checked);
    elements.selectAllBroken.checked = allVisibleChecked;
    elements.selectAllBroken.indeterminate = !allVisibleChecked && visibleChecks.some(c => c.checked);
  } else {
    elements.selectAllBroken.checked = false;
    elements.selectAllBroken.indeterminate = false;
  }
}

function updateDupButtonState() {
  const checked = document.querySelectorAll('.dup-check:checked');
  const countStr = checked.length > 0 ? ` (${checked.length})` : '';
  elements.deleteDupBtn.disabled = checked.length === 0;
  elements.deleteDupBtn.textContent = chrome.i18n.getMessage('btnDeleteSelected') + countStr;
}

// Helpers
function escapeHtml(text) {
  if (!text) return '';
  return text
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
}

// Return a safe href value: escaped and restricted to known-safe schemes.
// Prevents javascript:-scheme injection and attribute breakout via the URL.
function safeHref(url) {
  if (!url) return '#';
  const safeSchemes = ['http:', 'https:', 'ftp:', 'mailto:'];
  try {
    const parsed = new URL(url, document.baseURI);
    if (!safeSchemes.includes(parsed.protocol)) return '#';
  } catch (e) {
    return '#';
  }
  return escapeHtml(url);
}

function getSelectedIds(selector) {
  // Return from Set for broken, DOM for duplicates
  if (selector === '.broken-check') {
    return Array.from(selectedIds);
  }
  return Array.from(document.querySelectorAll(selector + ':checked')).map(cb => cb.dataset.id);
}

// Event Listeners

// Broken Links Events
elements.brokenTableBody.addEventListener('click', (e) => {
  // Handle cell clicks for selection
  const cell = e.target.closest('.selectable-cell');
  if (cell) {
    const tr = cell.parentElement;
    const checkbox = tr.querySelector('.broken-check');
    if (checkbox) {
      checkbox.checked = !checkbox.checked;
      // Trigger change event manually or update logic directly
      const id = checkbox.dataset.id;
      if (checkbox.checked) {
        selectedIds.add(id);
      } else {
        selectedIds.delete(id);
      }
      updateBrokenButtonState();
    }
  }
});

elements.brokenTableBody.addEventListener('change', (e) => {
  if (e.target.classList.contains('broken-check')) {
    const id = e.target.dataset.id;
    if (e.target.checked) {
      selectedIds.add(id);
    } else {
      selectedIds.delete(id);
    }
    updateBrokenButtonState();
  }
});

elements.selectAllBroken.addEventListener('change', (e) => {
  const isChecked = e.target.checked;
  // Apply to all VISIBLE checks
  const visibleChecks = document.querySelectorAll('.broken-check');
  visibleChecks.forEach(c => {
    c.checked = isChecked;
    const id = c.dataset.id;
    if (isChecked) {
      selectedIds.add(id);
    } else {
      selectedIds.delete(id);
    }
  });
  updateBrokenButtonState();
});

elements.deleteBrokenBtn.addEventListener('click', () => {
  const ids = Array.from(selectedIds);
  if (confirm(`Delete ${ids.length} bookmarks?`)) {
    chrome.runtime.sendMessage({ action: 'deleteBookmarks', ids }, () => {
      // Clear selection after delete
      selectedIds.clear();
      // Refresh after delete
      chrome.runtime.sendMessage({ action: 'getStatus' }, render);
    });
  }
});

elements.recheckBtn.addEventListener('click', () => {
  const ids = Array.from(selectedIds);
  // Show loading state
  elements.recheckBtn.disabled = true;
  elements.recheckBtn.textContent = 'Checking...';
  
  chrome.runtime.sendMessage({ action: 'recheckBookmarks', ids }, (results) => {
    if (chrome.runtime.lastError || !results || !results.fixed) {
      elements.recheckBtn.disabled = false;
      elements.recheckBtn.textContent = chrome.i18n.getMessage('btnRecheckSelected') || 'Recheck Selected';
      return;
    }
    // Determine what happened
    const fixedCount = results.fixed.length;
    
    if (fixedCount > 0) {
      // Remove fixed items from selection
      results.fixed.forEach(id => selectedIds.delete(id));
      alert(`${fixedCount} bookmarks were valid and have been removed from the list.`);
    } else {
      alert('No bookmarks were recovered. They are still invalid.');
    }
    
    // Refresh page
    chrome.runtime.sendMessage({ action: 'getStatus' }, render);
  });
});

elements.ignoreBtn.addEventListener('click', () => {
  const ids = Array.from(selectedIds);
  chrome.runtime.sendMessage({ action: 'ignoreBookmarks', ids }, () => {
    // Remove from selection
    ids.forEach(id => selectedIds.delete(id));
    // Refresh page
    chrome.runtime.sendMessage({ action: 'getStatus' }, render);
  });
});

elements.openBtn.addEventListener('click', () => {
  const ids = Array.from(selectedIds);
  // Find URLs for selected IDs
  const itemsToOpen = currentState.broken.filter(item => selectedIds.has(item.id));
  
  if (itemsToOpen.length > 5) {
    if (!confirm(`Warning: You are about to open ${itemsToOpen.length} tabs. This might slow down your browser.\n\nAre you sure?`)) {
      return;
    }
  }
  
  itemsToOpen.forEach(item => {
    // Only hand http(s) URLs to tabs.create; skip file:/other schemes.
    let proto = '';
    try { proto = new URL(item.url).protocol; } catch (e) { return; }
    if (proto === 'http:' || proto === 'https:') {
      chrome.tabs.create({ url: item.url, active: false });
    }
  });
});

// Duplicates Events
elements.duplicatesList.addEventListener('change', (e) => {
  if (e.target.classList.contains('dup-check')) {
    updateDupButtonState();
  }
});

elements.deleteDupBtn.addEventListener('click', () => {
  const ids = getSelectedIds('.dup-check');
  if (confirm(`Delete ${ids.length} bookmarks?`)) {
    chrome.runtime.sendMessage({ action: 'deleteBookmarks', ids }, () => {
      chrome.runtime.sendMessage({ action: 'getStatus' }, render);
    });
  }
});

elements.btnOptions.addEventListener('click', () => {
  if (chrome.runtime.openOptionsPage) {
    chrome.runtime.openOptionsPage();
  } else {
    window.open(chrome.runtime.getURL('options.html'));
  }
});

elements.clearReportBtn.addEventListener('click', () => {
  if (confirm('Are you sure you want to clear all scan reports? This action cannot be undone.')) {
    chrome.runtime.sendMessage({ action: 'clearReport' }, () => {
       chrome.runtime.sendMessage({ action: 'getStatus' }, render);
    });
  }
});

// Initial Load
document.addEventListener('DOMContentLoaded', () => {
  initI18n();
  chrome.runtime.sendMessage({ action: 'getStatus' }, render);
});
