'use strict';

let data = null;
let selectedPlaylistId = null;
let editingPlaylistId = null;

// --- Init ---

document.addEventListener('DOMContentLoaded', async () => {
  initTheme();
  initI18n();
  await loadData();
  render();
  attachListeners();
});

// Listen for external data changes
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  const keys = ['playlists', 'channels', 'channelPlaylists', 'settings'];
  if (keys.some(k => k in changes)) {
    loadData().then(() => render());
  }
});

// --- Data ---

async function loadData() {
  data = await chrome.runtime.sendMessage({ type: 'GET_ALL_DATA' });
}

function getPlaylistsSorted() {
  return Object.values(data.playlists || {}).sort((a, b) => a.order - b.order);
}

function getChannelsForPlaylist(playlistId) {
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
      <span class="drag-handle" title="Drag to reorder">&#8942;&#8942;</span>
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
      selectedPlaylistId = item.dataset.id;
      render();
    });
  });

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
      const pl = data.playlists[btn.dataset.id];
      if (!confirm(`Delete playlist "${pl.name}"?`)) return;
      await chrome.runtime.sendMessage({ type: 'DELETE_PLAYLIST', id: btn.dataset.id });
      if (selectedPlaylistId === btn.dataset.id) selectedPlaylistId = null;
      await loadData();
      render();
      showToast('Playlist deleted');
    });
  });

  // Edit inline
  list.querySelectorAll('.edit-pl-save').forEach(btn => {
    btn.addEventListener('click', async () => {
      const row = btn.closest('.edit-inline');
      const id = row.dataset.id;
      const name = row.querySelector('.edit-pl-name').value.trim();
      const color = row.querySelector('.edit-pl-color').value;
      if (!name) return;
      await chrome.runtime.sendMessage({ type: 'UPDATE_PLAYLIST', id, name, color });
      editingPlaylistId = null;
      await loadData();
      render();
      showToast('Playlist updated');
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
        <a class="channel-item-handle" href="https://www.youtube.com/${encodeURIComponent(ch.handle)}" target="_blank" rel="noopener">${escapeHtml(ch.handle)}</a>
      </div>
      <span class="item-actions" style="opacity:1;">
        <button class="btn btn-sm btn-danger remove-ch-btn" data-handle="${escapeAttr(ch.handle)}" title="Remove from playlist">&#10005;</button>
      </span>
    </div>`;
  }).join('');

  list.querySelectorAll('.remove-ch-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const handle = btn.dataset.handle;
      await chrome.runtime.sendMessage({
        type: 'ASSIGN_CHANNEL_PLAYLIST',
        handle,
        playlistId: selectedPlaylistId,
        assign: false
      });
      await loadData();
      render();
      showToast('Channel removed');
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

  const playlist = await chrome.runtime.sendMessage({
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

  // Register channel
  await chrome.runtime.sendMessage({
    type: 'REGISTER_CHANNEL',
    handle,
    name: displayName
  });

  // Assign to current playlist
  await chrome.runtime.sendMessage({
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
}

function parseManualChannelInput(rawValue) {
  const value = rawValue.trim();
  if (!value) return null;

  if (/^https?:\/\//i.test(value)) {
    let url;
    try {
      url = new URL(value);
    } catch {
      return { error: 'Enter a valid YouTube channel URL, @handle, or channel ID' };
    }

    const hostname = url.hostname.replace(/^www\./i, '').toLowerCase();
    if (!['youtube.com', 'm.youtube.com'].includes(hostname)) {
      return { error: 'Only YouTube channel URLs are supported' };
    }

    const pathname = url.pathname.replace(/\/+$/, '');
    const handleMatch = pathname.match(/^\/@([^/?]+)/);
    if (handleMatch) {
      return { handle: '@' + handleMatch[1], displayName: handleMatch[1] };
    }

    const channelMatch = pathname.match(/^\/channel\/([^/?]+)/);
    if (channelMatch) {
      return { handle: channelMatch[1], displayName: channelMatch[1] };
    }

    return { error: 'Paste a YouTube channel URL, not a video or playlist URL' };
  }

  if (value.startsWith('@')) {
    if (/\s/.test(value) || !/^@[A-Za-z0-9._-]+$/.test(value)) {
      return { error: 'Enter a valid YouTube @handle' };
    }
    return { handle: value, displayName: value.slice(1) };
  }

  if (/\s/.test(value)) {
    return { error: 'Enter a valid @handle, channel ID, or YouTube channel URL' };
  }

  const compact = value;
  if (/^UC[A-Za-z0-9_-]{20,}$/.test(compact)) {
    return { handle: compact, displayName: compact };
  }

  if (/^[A-Za-z0-9._-]+$/.test(compact)) {
    return { handle: '@' + compact, displayName: compact };
  }

  return { error: 'Enter a valid @handle, channel ID, or YouTube channel URL' };
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
  a.download = `syo-playlists-${new Date().toISOString().slice(0, 10)}.json`;
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

    const result = await chrome.runtime.sendMessage({
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
    chrome.runtime.sendMessage({ type: 'UPDATE_SETTINGS', settings: { theme: next } });
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
  return (str || '').replace(/"/g, '&quot;').replace(/'/g, '&#39;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
