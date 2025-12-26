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
  
  themeToggle: document.getElementById('theme-toggle'),
  btnOptions: document.getElementById('btn-options')
};

let currentState = null;
let currentFilter = null; // Filter by status code
let selectedIds = new Set(); // Store selected IDs globally

// Theme Logic
// 1. Load saved theme
chrome.storage.local.get(['theme'], (result) => {
  const savedTheme = result.theme || 'light';
  document.body.setAttribute('data-theme', savedTheme);
});

// 2. Handle toggle
elements.themeToggle.addEventListener('click', () => {
  const currentTheme = document.body.getAttribute('data-theme');
  const newTheme = currentTheme === 'light' ? 'dark' : 'light';
  document.body.setAttribute('data-theme', newTheme);
  chrome.storage.local.set({ theme: newTheme });
});

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
    brokenDateSpan.textContent = 'Never';
  }

  if (state.lastScanDateDuplicates) {
    dupDateSpan.textContent = new Date(state.lastScanDateDuplicates).toLocaleString();
  } else {
    dupDateSpan.textContent = 'Never';
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
      <td><a href="${item.url}" target="_blank" class="url-col">${escapeHtml(item.url)}</a></td>
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
    return;
  }

  elements.dupEmpty.style.display = 'none';

  dupGroups.forEach(([url, items]) => {
    const group = document.createElement('div');
    group.className = 'dup-group';
    
    let itemsHtml = '<table style="margin:0; width:100%;"><tbody>';
    items.forEach(item => {
      // Duplicates need their own selection logic or shared? 
      // For now, let's keep duplicate selection separate locally as it was before,
      // or we could use the same Set if IDs are unique globally (they are).
      // However, usually duplicate management is separate. Let's keep it separate for now or minimal.
      // The user request was specific to "selected links under a filter", implying the Findings section.
      
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
        <a href="${url}" target="_blank">${escapeHtml(url)}</a>
      </div>
      ${itemsHtml}
    `;
    elements.duplicatesList.appendChild(group);
  });
}

function updateBrokenButtonState() {
  const count = selectedIds.size;
  elements.deleteBrokenBtn.disabled = count === 0;
  elements.deleteBrokenBtn.textContent = count > 0 ? `Delete Selected (${count})` : 'Delete Selected';
  
  elements.recheckBtn.disabled = count === 0;
  elements.recheckBtn.textContent = count > 0 ? `Recheck Selected (${count})` : 'Recheck Selected';

  elements.ignoreBtn.disabled = count === 0;
  elements.ignoreBtn.textContent = count > 0 ? `Ignore Selected (${count})` : 'Ignore Selected';
  
  elements.openBtn.disabled = count === 0;
  elements.openBtn.textContent = count > 0 ? `Open Selected (${count})` : 'Open Selected';

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
  elements.deleteDupBtn.disabled = checked.length === 0;
  elements.deleteDupBtn.textContent = checked.length > 0 ? `Delete Selected (${checked.length})` : 'Delete Selected';
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
    chrome.tabs.create({ url: item.url, active: false });
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

// Initial Load
chrome.runtime.sendMessage({ action: 'getStatus' }, render);
