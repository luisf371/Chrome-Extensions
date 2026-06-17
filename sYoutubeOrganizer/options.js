'use strict';

const sharedCore = globalThis.SYPSharedCore;

let data = null;
let selectedPlaylistId = null;
let editingPlaylistId = null;
const MAX_MESSAGE_RETRIES = 2;
const MESSAGE_RETRY_DELAY_MS = 200;
const RETRYABLE_MESSAGE_TYPES = new Set([
  'GET_ALL_DATA',
  'CREATE_PLAYLIST',
  'REGISTER_CHANNEL',
  'ASSIGN_CHANNEL_PLAYLIST',
  'UPDATE_SETTINGS',
  'OPEN_OPTIONS',
  'DELETE_PLAYLIST',
  'UPDATE_PLAYLIST',
  'REORDER_PLAYLISTS',
  'IMPORT_DATA'
]);

// --- Init ---

document.addEventListener('DOMContentLoaded', async () => {
  initTheme();
  initSectionToggles();
  initI18n();
  try {
    await loadData();
  } catch (error) {
    showToast(error.message || 'Could not load extension data', 'error');
  }
  render();
  attachListeners();
});

// Listen for external data changes
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  const keys = ['playlists', 'channels', 'channelPlaylists', 'settings'];
  if (keys.some(k => k in changes)) {
    loadData().then(() => render()).catch((error) => {
      showToast(error.message || 'Could not refresh data', 'error');
    });
  }
});

// --- Data ---

async function loadData() {
  data = await sendRuntimeMessage({ type: 'GET_ALL_DATA' });
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function normalizeRuntimeError(error) {
  if (error instanceof Error) return error;
  if (typeof error === 'string' && error) return new Error(error);
  return new Error('Extension request failed');
}

function isRetryableRuntimeError(type, error) {
  if (!RETRYABLE_MESSAGE_TYPES.has(type) || !chrome.runtime?.id) return false;
  const message = error?.message || '';
  return (
    /receiving end does not exist/i.test(message) ||
    /message port closed/i.test(message) ||
    /could not establish connection/i.test(message)
  );
}

async function sendRuntimeMessage(message) {
  if (!message?.type) {
    throw new Error('Invalid extension request');
  }

  const maxRetries = RETRYABLE_MESSAGE_TYPES.has(message.type) ? MAX_MESSAGE_RETRIES : 0;
  let attempt = 0;

  while (true) {
    if (!chrome.runtime?.id) {
      throw new Error('Extension unavailable. Reload the extension and try again.');
    }

    try {
      const response = await chrome.runtime.sendMessage(message);
      if (response?.error) {
        throw new Error(response.error);
      }
      return response;
    } catch (error) {
      const normalizedError = normalizeRuntimeError(error);
      if (attempt >= maxRetries || !isRetryableRuntimeError(message.type, normalizedError)) {
        throw normalizedError;
      }
      await sleep(MESSAGE_RETRY_DELAY_MS * (2 ** attempt));
      attempt += 1;
    }
  }
}

function getPlaylistsSorted() {
  if (!data) return [];
  return Object.values(data.playlists || {}).sort((a, b) => a.order - b.order);
}

function getChannelsForPlaylist(playlistId) {
  if (!data) return [];
  const handles = new Set();

  for (const [handle, plIds] of Object.entries(data.channelPlaylists || {})) {
    if (plIds.includes(playlistId)) handles.add(handle);
  }

  return Array.from(handles).map(h => {
    const ch = (data.channels || {})[h] || { handle: h, name: h };
    return { ...ch };
  }).sort((a, b) => a.name.localeCompare(b.name));
}

// --- Render ---

function render() {
  if (!data) return;
  renderPlaylistList();
  renderDetail();
}

function renderPlaylistList() {
  const list = document.getElementById('playlistList');
  const playlists = getPlaylistsSorted();

  if (playlists.length === 0) {
    list.innerHTML = '<div class="empty-state small"><p>No playlists yet</p></div>';
    return;
  }

  list.innerHTML = playlists.map(pl => {
    if (editingPlaylistId === pl.id) {
      return `<div class="edit-inline" data-id="${pl.id}">
        <input type="color" class="edit-pl-color" value="${pl.color}" style="width:28px;height:28px;padding:1px;border:1px solid var(--border);border-radius:3px;background:var(--bg-input);cursor:pointer;">
        <input type="text" class="edit-pl-name" value="${escapeAttr(pl.name)}" maxlength="50">
        <button class="btn btn-sm edit-pl-save">Save</button>
        <button class="btn btn-sm edit-pl-cancel">Cancel</button>
      </div>`;
    }

    const count = getChannelsForPlaylist(pl.id).length;
    return `<div class="list-item ${selectedPlaylistId === pl.id ? 'active' : ''}" data-id="${pl.id}">
      <span class="drag-handle" title="Drag to reorder" aria-label="Drag to reorder">&#8942;&#8942;</span>
      <span class="item-dot" style="background:${pl.color}"></span>
      <span class="item-name">${escapeHtml(pl.name)}</span>
      <span class="item-count">${count}</span>
      <span class="item-actions">
        <button class="btn btn-sm edit-pl-btn" data-id="${pl.id}" title="Edit">&#9998;</button>
        <button class="btn btn-sm btn-danger del-pl-btn" data-id="${pl.id}" title="Delete">&#10005;</button>
      </span>
    </div>`;
  }).join('');

  // Attach playlist list events
  list.querySelectorAll('.list-item[data-id]').forEach(item => {
    item.addEventListener('click', (e) => {
      if (e.target.closest('.item-actions')) return;
      if (item.dataset.dragged === 'true') { delete item.dataset.dragged; return; }
      selectedPlaylistId = item.dataset.id;
      render();
    });
  });

  attachReorderListeners(list);

  list.querySelectorAll('.edit-pl-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      editingPlaylistId = btn.dataset.id;
      render();
    });
  });

  list.querySelectorAll('.del-pl-btn').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      try {
        const pl = data.playlists[btn.dataset.id];
        if (!pl) { await loadData(); render(); return; }
        if (!confirm(`Delete playlist "${pl.name}"?`)) return;
        await sendRuntimeMessage({ type: 'DELETE_PLAYLIST', id: btn.dataset.id });
        if (selectedPlaylistId === btn.dataset.id) selectedPlaylistId = null;
        await loadData();
        render();
        showToast('Playlist deleted');
      } catch (error) {
        showToast(error.message || 'Could not delete the playlist', 'error');
      }
    });
  });

  // Edit inline
  list.querySelectorAll('.edit-pl-save').forEach(btn => {
    btn.addEventListener('click', async () => {
      try {
        const row = btn.closest('.edit-inline');
        const id = row.dataset.id;
        const name = row.querySelector('.edit-pl-name').value.trim();
        const color = row.querySelector('.edit-pl-color').value;
        if (!name) return;
        await sendRuntimeMessage({ type: 'UPDATE_PLAYLIST', id, name, color });
        editingPlaylistId = null;
        await loadData();
        render();
        showToast('Playlist updated');
      } catch (error) {
        showToast(error.message || 'Could not update the playlist', 'error');
      }
    });
  });

  list.querySelectorAll('.edit-pl-cancel').forEach(btn => {
    btn.addEventListener('click', () => { editingPlaylistId = null; render(); });
  });

  list.querySelectorAll('.edit-pl-name').forEach(input => {
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') input.closest('.edit-inline').querySelector('.edit-pl-save').click();
      if (e.key === 'Escape') { editingPlaylistId = null; render(); }
    });
    input.focus();
  });
}

// --- Drag-and-drop reorder ---

function getDragAfterElement(list, y) {
  const rows = [...list.querySelectorAll('.list-item[data-id]:not(.dragging)')];
  let closest = { offset: Number.NEGATIVE_INFINITY, element: null };
  for (const row of rows) {
    const box = row.getBoundingClientRect();
    const offset = y - box.top - box.height / 2;
    if (offset < 0 && offset > closest.offset) {
      closest = { offset, element: row };
    }
  }
  return closest.element;
}

function attachReorderListeners(list) {
  let dragId = null;

  // Only allow a drag to start from the dedicated handle, so grabbing text
  // (e.g. selecting a playlist name) does not begin a reorder.
  list.querySelectorAll('.list-item[data-id]').forEach(item => {
    const handle = item.querySelector('.drag-handle');
    if (!handle) return;
    // Clear any stale post-drag flag whenever a fresh interaction begins.
    item.addEventListener('mousedown', () => { delete item.dataset.dragged; });
    handle.addEventListener('mousedown', () => { item.setAttribute('draggable', 'true'); });
    item.addEventListener('mouseup', () => item.removeAttribute('draggable'));
    item.addEventListener('mouseleave', () => {
      if (!item.classList.contains('dragging')) item.removeAttribute('draggable');
    });

    item.addEventListener('dragstart', (e) => {
      dragId = item.dataset.id;
      item.classList.add('dragging');
      if (e.dataTransfer) {
        e.dataTransfer.effectAllowed = 'move';
        // Required for Firefox to initiate the drag session.
        try { e.dataTransfer.setData('text/plain', dragId); } catch {}
      }
    });

    item.addEventListener('dragend', () => {
      item.classList.remove('dragging');
      item.removeAttribute('draggable');
      // Flag so the synthetic click after a drag does not change selection.
      item.dataset.dragged = 'true';
      const orderedIds = [...list.querySelectorAll('.list-item[data-id]')].map(el => el.dataset.id);
      const movedId = dragId;
      dragId = null;
      void commitPlaylistReorder(orderedIds, movedId);
    });
  });

  list.addEventListener('dragover', (e) => {
    if (!dragId) return;
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
    const dragging = list.querySelector('.list-item.dragging');
    if (!dragging) return;
    const afterElement = getDragAfterElement(list, e.clientY);
    if (afterElement == null) {
      list.appendChild(dragging);
    } else if (afterElement !== dragging) {
      list.insertBefore(dragging, afterElement);
    }
  });

  list.addEventListener('drop', (e) => { if (dragId) e.preventDefault(); });
}

async function commitPlaylistReorder(orderedIds, movedId) {
  if (!data) return;

  const currentOrder = getPlaylistsSorted().map(pl => pl.id);
  // No-op if the order did not actually change.
  if (orderedIds.length === currentOrder.length &&
      orderedIds.every((id, i) => id === currentOrder[i])) {
    return;
  }

  try {
    await sendRuntimeMessage({ type: 'REORDER_PLAYLISTS', orderedIds });
    await loadData();
    render();
    showToast('Playlists reordered');
  } catch (error) {
    // Restore the persisted order on failure.
    await loadData().catch(() => {});
    render();
    showToast(error.message || 'Could not reorder playlists', 'error');
  }
}

function renderDetail() {
  const detail = document.getElementById('playlistDetail');
  const empty = document.getElementById('emptyDetail');

  if (!selectedPlaylistId || !data.playlists[selectedPlaylistId]) {
    detail.style.display = 'none';
    empty.style.display = '';
    return;
  }

  detail.style.display = '';
  empty.style.display = 'none';

  renderChannelList();
}

function renderChannelList() {
  const list = document.getElementById('channelList');
  const noChannels = document.getElementById('noChannels');
  const searchInput = document.getElementById('channelSearch');
  const searchTerm = searchInput.value.toLowerCase();

  let channels = getChannelsForPlaylist(selectedPlaylistId);
  if (searchTerm) {
    channels = channels.filter(ch =>
      ch.name.toLowerCase().includes(searchTerm) ||
      ch.handle.toLowerCase().includes(searchTerm)
    );
  }

  if (channels.length === 0) {
    list.innerHTML = '';
    noChannels.style.display = searchTerm ? 'none' : '';
    if (searchTerm) {
      list.innerHTML = '<div style="padding:12px 0;color:var(--text-muted);font-size:12px;text-align:center;">No matches</div>';
    }
    return;
  }

  noChannels.style.display = 'none';

  list.innerHTML = channels.map(ch => {
    return `<div class="list-item channel-item" data-handle="${escapeAttr(ch.handle)}">
      <div class="channel-item-info">
        <div class="channel-item-name">${escapeHtml(ch.name)}</div>
        <a class="channel-item-handle" href="https://www.youtube.com/${ch.handle.startsWith('@') ? '@' + encodeURIComponent(ch.handle.slice(1)) : 'channel/' + encodeURIComponent(ch.handle)}" target="_blank" rel="noopener">${escapeHtml(ch.handle)}</a>
      </div>
      <span class="item-actions" style="opacity:1;">
        <button class="btn btn-sm btn-danger remove-ch-btn" data-handle="${escapeAttr(ch.handle)}" title="Remove from playlist">&#10005;</button>
      </span>
    </div>`;
  }).join('');

  list.querySelectorAll('.remove-ch-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      try {
        const handle = btn.dataset.handle;
        await sendRuntimeMessage({
          type: 'ASSIGN_CHANNEL_PLAYLIST',
          handle,
          playlistId: selectedPlaylistId,
          assign: false
        });
        await loadData();
        render();
        showToast('Channel removed');
      } catch (error) {
        showToast(error.message || 'Could not remove the channel', 'error');
      }
    });
  });
}

// --- Event Listeners ---

function attachListeners() {
  // Playlist add: click "+" to reveal input, Enter commits, blur/Escape discards
  setupInlineAdd('addPlaylistBtn', 'addPlaylistRow', addPlaylist);

  // Channel add: same behavior
  setupInlineAdd('addChannelBtn', 'addChannelRow', addChannelManually);

  document.getElementById('channelSearch').addEventListener('input', () => {
    renderChannelList();
  });

  document.getElementById('exportBtn').addEventListener('click', exportPlaylists);
  document.getElementById('importBtn').addEventListener('click', () => document.getElementById('importFile').click());
  document.getElementById('importFile').addEventListener('change', importPlaylists);
}

function setupInlineAdd(btnId, rowId, commitFn) {
  const btn = document.getElementById(btnId);
  const row = document.getElementById(rowId);
  const textInput = row.querySelector('input[type="text"]');

  const isOpen = () => row.style.display !== 'none';

  const show = () => {
    row.style.display = '';
    textInput.focus();
  };

  const hide = () => {
    textInput.value = '';
    row.style.display = 'none';
  };

  btn.addEventListener('click', () => {
    if (!isOpen()) {
      show();
    } else {
      commitFn();
    }
  });

  textInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') commitFn();
    if (e.key === 'Escape') hide();
  });

  textInput.addEventListener('blur', () => {
    // Allow clicking the "+" button or color picker without discarding
    setTimeout(() => {
      if (!row.contains(document.activeElement)) {
        hide();
      }
    }, 120);
  });
}

async function addPlaylist() {
  const nameInput = document.getElementById('newPlaylistName');
  const colorInput = document.getElementById('newPlaylistColor');
  const name = nameInput.value.trim();
  if (!name) return;

  try {
    const playlist = await sendRuntimeMessage({
      type: 'CREATE_PLAYLIST',
      name,
      color: colorInput.value
    });

    nameInput.value = '';
    document.getElementById('addPlaylistRow').style.display = 'none';
    await loadData();
    selectedPlaylistId = playlist.id;
    render();
    showToast('Playlist created');
  } catch (error) {
    showToast(error.message || 'Could not create the playlist', 'error');
  }
}

async function addChannelManually() {
  if (!selectedPlaylistId) return;
  const input = document.getElementById('addChannelHandle');
  const parsed = parseManualChannelInput(input.value);
  if (!parsed) return;
  if (parsed.error) {
    showToast(parsed.error, 'error');
    return;
  }

  const { handle, displayName } = parsed;

  try {
    // Register channel
    await sendRuntimeMessage({
      type: 'REGISTER_CHANNEL',
      handle,
      name: displayName
    });

    // Assign to current playlist
    await sendRuntimeMessage({
      type: 'ASSIGN_CHANNEL_PLAYLIST',
      handle,
      name: displayName,
      playlistId: selectedPlaylistId,
      assign: true
    });

    input.value = '';
    document.getElementById('addChannelRow').style.display = 'none';
    await loadData();
    render();
    showToast('Channel added');
  } catch (error) {
    showToast(error.message || 'Could not add the channel', 'error');
  }
}

function parseManualChannelInput(rawValue) {
  return sharedCore.parseManualChannelInput(rawValue);
}

// --- Export ---

function exportPlaylists() {
  if (!data) return;

  const exportData = {
    playlists: data.playlists || {},
    channels: data.channels || {},
    channelPlaylists: data.channelPlaylists || {},
    exportedAt: new Date().toISOString()
  };

  const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `sYoutubePlaylist-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
  showToast('Playlists exported');
}

async function importPlaylists(e) {
  const file = e.target.files[0];
  if (!file) return;

  try {
    const text = await file.text();
    const imported = JSON.parse(text);

    // Validate structure
    if (!imported.playlists || typeof imported.playlists !== 'object') {
      showToast('Invalid file: missing playlists', 'error');
      return;
    }

    const mode = confirm(
      'Replace all existing data?\n\nOK = Replace everything\nCancel = Merge with existing'
    ) ? 'replace' : 'merge';

    const result = await sendRuntimeMessage({
      type: 'IMPORT_DATA',
      playlists: imported.playlists,
      channels: imported.channels || {},
      channelPlaylists: imported.channelPlaylists || {},
      mode
    });
    if (result?.error) throw new Error(result.error);

    selectedPlaylistId = null;
    await loadData();
    render();
    showToast('Playlists imported');
  } catch (err) {
    showToast(err?.message || 'Failed to read file', 'error');
  } finally {
    e.target.value = '';
  }
}

// --- Theme ---

function initTheme() {
  const toggle = document.getElementById('themeToggle');
  chrome.storage.local.get(['settings'], (result) => {
    const theme = result.settings?.theme || 'dark';
    document.body.setAttribute('data-theme', theme);
  });

  toggle.addEventListener('click', () => {
    const current = document.body.getAttribute('data-theme') || 'dark';
    const next = current === 'dark' ? 'light' : 'dark';
    document.body.setAttribute('data-theme', next);
    void sendRuntimeMessage({ type: 'UPDATE_SETTINGS', settings: { theme: next } }).catch((error) => {
      document.body.setAttribute('data-theme', current);
      showToast(error.message || 'Could not update the theme', 'error');
    });
  });
}

function initSectionToggles() {
  const toggles = [
    { element: document.getElementById('hideShortsToggle'), key: 'hideShorts' },
    { element: document.getElementById('hideMostRelevantToggle'), key: 'hideMostRelevant' },
    { element: document.getElementById('redirectRootToSubscriptionsToggle'), key: 'redirectRootToSubscriptions' }
  ];

  // Load current state
  chrome.storage.local.get(['settings'], (result) => {
    toggles.forEach(({ element, key }) => {
      element.checked = !!result.settings?.[key];
    });
  });

  toggles.forEach(({ element, key }) => {
    element.addEventListener('change', () => {
      void sendRuntimeMessage({ type: 'UPDATE_SETTINGS', settings: { [key]: element.checked } }).catch((error) => {
        element.checked = !element.checked;
        showToast(error.message || 'Could not update setting', 'error');
      });
    });
  });
}

// --- i18n ---

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
}

// --- Toast ---

let toastTimeout = null;
let toastVisible = false;

function showToast(message, type = 'success') {
  const toast = document.getElementById('toast');
  const toastIcon = toast.querySelector('.toast-icon');
  const toastMessage = toast.querySelector('.toast-message');

  if (toastTimeout) clearTimeout(toastTimeout);

  if (toastVisible) {
    toast.classList.remove('show');
    setTimeout(() => displayToast(), 100);
  } else {
    displayToast();
  }

  function displayToast() {
    toastMessage.textContent = message;
    toastIcon.textContent = type === 'success' ? '\u2713' : '\u2715';
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

// --- Helpers ---

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str || '';
  return div.innerHTML;
}

function escapeAttr(str) {
  return (str || '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/'/g, '&#39;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
