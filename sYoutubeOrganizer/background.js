'use strict';

const DEFAULT_SETTINGS = { theme: 'dark' };

chrome.runtime.onInstalled.addListener(async (details) => {
  if (details.reason === 'install') {
    await chrome.storage.local.set({
      playlists: {},
      channels: {},
      channelPlaylists: {},
      settings: DEFAULT_SETTINGS
    });
  }
});

// --- Storage helpers ---

async function getAllData() {
  const data = await chrome.storage.local.get([
    'playlists', 'channels', 'channelPlaylists', 'settings'
  ]);
  return {
    playlists: data.playlists || {},
    channels: data.channels || {},
    channelPlaylists: data.channelPlaylists || {},
    settings: { ...DEFAULT_SETTINGS, ...(data.settings || {}) }
  };
}

async function createPlaylist({ name, color }) {
  const { playlists } = await chrome.storage.local.get('playlists');
  const all = playlists || {};
  const id = 'pl_' + crypto.randomUUID().slice(0, 8);
  const order = Object.keys(all).length;
  const now = Date.now();
  const playlist = { id, name, color, order, createdAt: now, updatedAt: now };
  all[id] = playlist;
  await chrome.storage.local.set({ playlists: all });
  await broadcastChange('playlists', all);
  return playlist;
}

async function updatePlaylist({ id, name, color, order }) {
  const { playlists } = await chrome.storage.local.get('playlists');
  const all = playlists || {};
  if (!all[id]) return null;
  if (name !== undefined) all[id].name = name;
  if (color !== undefined) all[id].color = color;
  if (order !== undefined) all[id].order = order;
  all[id].updatedAt = Date.now();
  await chrome.storage.local.set({ playlists: all });
  await broadcastChange('playlists', all);
  return all[id];
}

async function deletePlaylist({ id }) {
  const data = await chrome.storage.local.get(['playlists', 'channelPlaylists']);
  const playlists = data.playlists || {};
  const channelPlaylists = data.channelPlaylists || {};

  delete playlists[id];

  for (const handle of Object.keys(channelPlaylists)) {
    channelPlaylists[handle] = (channelPlaylists[handle] || []).filter(pid => pid !== id);
    if (channelPlaylists[handle].length === 0) delete channelPlaylists[handle];
  }

  await chrome.storage.local.set({ playlists, channelPlaylists });
  await broadcastChange('all');
  return { success: true };
}

async function registerChannel({ handle, channelId, name }) {
  const { channels } = await chrome.storage.local.get('channels');
  const all = channels || {};
  all[handle] = {
    handle,
    channelId: channelId || all[handle]?.channelId || '',
    name: name || all[handle]?.name || handle,
    updatedAt: Date.now()
  };
  await chrome.storage.local.set({ channels: all });
  return { success: true };
}

async function assignChannelPlaylist({ handle, name, playlistId, assign }) {
  const data = await chrome.storage.local.get(['channelPlaylists', 'channels']);
  const channelPlaylists = data.channelPlaylists || {};
  const channels = data.channels || {};

  // Auto-register channel if unknown
  if (!channels[handle]) {
    channels[handle] = { handle, channelId: '', name: name || handle, updatedAt: Date.now() };
    await chrome.storage.local.set({ channels });
  }

  const current = channelPlaylists[handle] || [];
  if (assign) {
    if (!current.includes(playlistId)) current.push(playlistId);
  } else {
    const idx = current.indexOf(playlistId);
    if (idx !== -1) current.splice(idx, 1);
  }

  if (current.length > 0) {
    channelPlaylists[handle] = current;
  } else {
    delete channelPlaylists[handle];
  }

  await chrome.storage.local.set({ channelPlaylists });
  await broadcastChange('channelPlaylists', channelPlaylists);
  return { success: true };
}

async function getChannelAssignments({ handle }) {
  const data = await chrome.storage.local.get(['channelPlaylists']);
  return {
    playlists: (data.channelPlaylists || {})[handle] || []
  };
}

async function updateSettings(newSettings) {
  const { settings } = await chrome.storage.local.get('settings');
  const merged = { ...DEFAULT_SETTINGS, ...(settings || {}), ...newSettings };
  await chrome.storage.local.set({ settings: merged });
  await broadcastChange('settings', merged);
  return merged;
}

async function reorderPlaylists({ orderedIds }) {
  const { playlists } = await chrome.storage.local.get('playlists');
  const all = playlists || {};
  orderedIds.forEach((id, index) => {
    if (all[id]) all[id].order = index;
  });
  await chrome.storage.local.set({ playlists: all });
  await broadcastChange('playlists', all);
  return { success: true };
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function normalizeStoredHandle(handle) {
  if (typeof handle !== 'string') return null;
  const trimmed = handle.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith('@')) {
    return /^@[A-Za-z0-9._-]+$/.test(trimmed) ? trimmed : null;
  }
  return /^[A-Za-z0-9_-]{10,}$/.test(trimmed) ? trimmed : null;
}

function normalizePlaylistColor(color) {
  return typeof color === 'string' && /^#[0-9A-Fa-f]{6}$/.test(color)
    ? color
    : '#4a9eff';
}

function normalizeImportedData({ playlists, channels, channelPlaylists }) {
  if (!isPlainObject(playlists)) {
    throw new Error('Invalid import: playlists must be an object');
  }
  if (channels !== undefined && !isPlainObject(channels)) {
    throw new Error('Invalid import: channels must be an object');
  }
  if (channelPlaylists !== undefined && !isPlainObject(channelPlaylists)) {
    throw new Error('Invalid import: channelPlaylists must be an object');
  }

  const now = Date.now();
  const normalizedPlaylists = {};
  const playlistEntries = Object.entries(playlists)
    .filter(([id, playlist]) => (
      typeof id === 'string' &&
      id.trim() &&
      isPlainObject(playlist) &&
      typeof playlist.name === 'string' &&
      playlist.name.trim()
    ))
    .sort(([, a], [, b]) => {
      const orderA = Number.isFinite(a.order) ? a.order : Number.MAX_SAFE_INTEGER;
      const orderB = Number.isFinite(b.order) ? b.order : Number.MAX_SAFE_INTEGER;
      return orderA - orderB;
    });

  if (playlistEntries.length === 0) {
    throw new Error('Invalid import: no valid playlists found');
  }

  playlistEntries.forEach(([id, playlist], index) => {
    const playlistId = id.trim();
    normalizedPlaylists[playlistId] = {
      id: playlistId,
      name: playlist.name.trim().slice(0, 50),
      color: normalizePlaylistColor(playlist.color),
      order: index,
      createdAt: Number.isFinite(playlist.createdAt) ? playlist.createdAt : now,
      updatedAt: now
    };
  });

  const normalizedChannels = {};
  for (const [rawHandle, channel] of Object.entries(channels || {})) {
    const handle = normalizeStoredHandle(rawHandle);
    if (!handle) continue;
    normalizedChannels[handle] = {
      handle,
      channelId: typeof channel?.channelId === 'string' ? channel.channelId.trim() : '',
      name: typeof channel?.name === 'string' && channel.name.trim() ? channel.name.trim() : handle,
      updatedAt: now
    };
  }

  const normalizedChannelPlaylists = {};
  for (const [rawHandle, playlistIds] of Object.entries(channelPlaylists || {})) {
    const handle = normalizeStoredHandle(rawHandle);
    if (!handle || !Array.isArray(playlistIds)) continue;

    const validPlaylistIds = [...new Set(
      playlistIds
        .map(id => typeof id === 'string' ? id.trim() : '')
        .filter(id => id && normalizedPlaylists[id])
    )];

    if (validPlaylistIds.length === 0) continue;

    normalizedChannelPlaylists[handle] = validPlaylistIds;
    if (!normalizedChannels[handle]) {
      normalizedChannels[handle] = {
        handle,
        channelId: '',
        name: handle,
        updatedAt: now
      };
    }
  }

  return {
    playlists: normalizedPlaylists,
    channels: normalizedChannels,
    channelPlaylists: normalizedChannelPlaylists
  };
}

// --- Broadcast ---

async function broadcastChange(key, data) {
  try {
    const tabs = await chrome.tabs.query({ url: 'https://www.youtube.com/*' });
    const payload = key === 'all'
      ? { type: 'DATA_CHANGED', key: 'all', data: await getAllData() }
      : { type: 'DATA_CHANGED', key, data };
    for (const tab of tabs) {
      chrome.tabs.sendMessage(tab.id, payload).catch(() => {});
    }
  } catch (e) {
    // Tabs may not be available
  }
}

// --- Import ---

async function importData({ playlists, channels, channelPlaylists, mode }) {
  const imported = normalizeImportedData({ playlists, channels, channelPlaylists });
  const current = await getAllData();

  if (mode === 'replace') {
    await chrome.storage.local.set(imported);
    await broadcastChange('all');
    return { success: true };
  }

  // Merge mode: add new playlists, merge channels and assignments
  const mergedPlaylists = { ...current.playlists };
  const mergedChannels = { ...current.channels };
  const mergedCP = { ...current.channelPlaylists };
  const idMap = {};

  // Map imported playlist IDs — reuse existing if same name, else create new
  for (const [id, pl] of Object.entries(imported.playlists)) {
    const existing = Object.values(mergedPlaylists).find(p => p.name === pl.name);
    if (existing) {
      idMap[id] = existing.id;
    } else {
      const maxOrder = Math.max(0, ...Object.values(mergedPlaylists).map(p => p.order || 0));
      const newId = 'pl_' + crypto.randomUUID().slice(0, 8);
      mergedPlaylists[newId] = { ...pl, id: newId, order: maxOrder + 1, createdAt: Date.now(), updatedAt: Date.now() };
      idMap[id] = newId;
    }
  }

  // Merge channels
  for (const [handle, ch] of Object.entries(imported.channels)) {
    if (!mergedChannels[handle]) {
      mergedChannels[handle] = { ...ch };
    }
  }

  // Merge assignments using mapped IDs
  for (const [handle, plIds] of Object.entries(imported.channelPlaylists)) {
    const existing = mergedCP[handle] || [];
    const mapped = plIds.map(id => idMap[id] || id);
    mergedCP[handle] = [...new Set([...existing, ...mapped])];
  }

  await chrome.storage.local.set({
    playlists: mergedPlaylists,
    channels: mergedChannels,
    channelPlaylists: mergedCP
  });
  await broadcastChange('all');
  return { success: true };
}

// --- Message router ---

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const handlers = {
    GET_ALL_DATA: () => getAllData(),
    CREATE_PLAYLIST: () => createPlaylist(message),
    UPDATE_PLAYLIST: () => updatePlaylist(message),
    DELETE_PLAYLIST: () => deletePlaylist(message),
    REORDER_PLAYLISTS: () => reorderPlaylists(message),
    REGISTER_CHANNEL: () => registerChannel(message),
    ASSIGN_CHANNEL_PLAYLIST: () => assignChannelPlaylist(message),
    GET_CHANNEL_ASSIGNMENTS: () => getChannelAssignments(message),
    UPDATE_SETTINGS: () => updateSettings(message.settings),
    IMPORT_DATA: () => importData(message),
    OPEN_OPTIONS: () => { chrome.runtime.openOptionsPage(); return Promise.resolve({ success: true }); }
  };

  const handler = handlers[message.type];
  if (handler) {
    handler().then(sendResponse).catch(err => sendResponse({ error: err.message }));
    return true;
  }
});
