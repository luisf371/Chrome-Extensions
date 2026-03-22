'use strict';

const DEFAULT_SETTINGS = {
  theme: 'dark',
  subscriptionsFilterPreference: null,
  hideShorts: false,
  hideMostRelevant: false
};
const STORAGE_STATE_KEYS = ['playlists', 'channels', 'channelPlaylists', 'settings'];
const MUTATION_TIMEOUT_MS = 5000;
let mutationQueue = Promise.resolve();

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
  const data = await chrome.storage.local.get(STORAGE_STATE_KEYS);
  return {
    playlists: data.playlists || {},
    channels: data.channels || {},
    channelPlaylists: data.channelPlaylists || {},
    settings: { ...DEFAULT_SETTINGS, ...(data.settings || {}) }
  };
}

function withTimeout(promise, label, timeoutMs = MUTATION_TIMEOUT_MS) {
  let timer = null;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs}ms`)), timeoutMs);
  });
  return Promise.race([promise, timeout]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

async function setStoredState(state) {
  await chrome.storage.local.set({
    playlists: state.playlists,
    channels: state.channels,
    channelPlaylists: state.channelPlaylists,
    settings: state.settings
  });
}

function enqueueMutation(label, handler) {
  const queuedWrite = mutationQueue
    .catch(() => {})
    .then(() => withTimeout((async () => {
      const state = await getAllData();
      const result = await handler(state) || {};
      if (result.changed) {
        await setStoredState(state);
      }
      return { state, result };
    })(), label));

  mutationQueue = queuedWrite.catch(() => {});

  return queuedWrite.then(async ({ state, result }) => {
    if (result.changed && result.broadcastKey) {
      const broadcastData = result.broadcastKey === 'all'
        ? null
        : state[result.broadcastKey];
      await broadcastChange(result.broadcastKey, broadcastData);
    }
    return result.response;
  });
}

function normalizePlaylistName(name) {
  if (typeof name !== 'string') return null;
  const trimmed = name.trim();
  return trimmed ? trimmed.slice(0, 50) : null;
}

function normalizePlaylistId(id) {
  if (typeof id !== 'string') return null;
  const trimmed = id.trim();
  return trimmed || null;
}

function normalizeChannelName(name, fallback) {
  if (typeof name === 'string' && name.trim()) {
    return name.trim().slice(0, 100);
  }
  return fallback;
}

function normalizeChannelId(channelId) {
  if (typeof channelId !== 'string') return '';
  return channelId.trim().slice(0, 64);
}

function normalizeSettingsInput(newSettings) {
  if (!isPlainObject(newSettings)) {
    throw new Error('Invalid settings payload');
  }

  const normalized = {};
  if (newSettings.theme !== undefined) {
    normalized.theme = newSettings.theme === 'light' ? 'light' : 'dark';
  }
  if ('subscriptionsFilterPreference' in newSettings) {
    const pref = newSettings.subscriptionsFilterPreference;
    normalized.subscriptionsFilterPreference = pref && typeof pref === 'object'
      ? pref
      : null;
  }
  if (newSettings.hideShorts !== undefined) {
    normalized.hideShorts = !!newSettings.hideShorts;
  }
  if (newSettings.hideMostRelevant !== undefined) {
    normalized.hideMostRelevant = !!newSettings.hideMostRelevant;
  }
  return normalized;
}

async function createPlaylist({ name, color }) {
  const normalizedName = normalizePlaylistName(name);
  if (!normalizedName) {
    throw new Error('Playlist name is required');
  }
  const normalizedColor = normalizePlaylistColor(color);

  return enqueueMutation('createPlaylist', async (state) => {
    const playlists = state.playlists;
    const id = 'pl_' + crypto.randomUUID().slice(0, 8);
    const order = Object.values(playlists).reduce(
      (max, playlist) => Math.max(max, Number.isFinite(playlist.order) ? playlist.order : -1),
      -1
    ) + 1;
    const now = Date.now();
    const playlist = {
      id,
      name: normalizedName,
      color: normalizedColor,
      order,
      createdAt: now,
      updatedAt: now
    };
    playlists[id] = playlist;
    return {
      changed: true,
      broadcastKey: 'all',
      response: playlist
    };
  });
}

async function updatePlaylist({ id, name, color, order }) {
  const normalizedId = normalizePlaylistId(id);
  if (!normalizedId) {
    throw new Error('Playlist ID is required');
  }

  const nextName = name !== undefined ? normalizePlaylistName(name) : undefined;
  if (name !== undefined && !nextName) {
    throw new Error('Playlist name cannot be empty');
  }
  const nextColor = color !== undefined ? normalizePlaylistColor(color) : undefined;
  const nextOrder = order !== undefined && Number.isFinite(order) ? order : undefined;

  return enqueueMutation('updatePlaylist', async (state) => {
    const playlist = state.playlists[normalizedId];
    if (!playlist) {
      return { changed: false, response: null };
    }

    if (nextName !== undefined) playlist.name = nextName;
    if (nextColor !== undefined) playlist.color = nextColor;
    if (nextOrder !== undefined) playlist.order = nextOrder;
    playlist.updatedAt = Date.now();

    return {
      changed: true,
      broadcastKey: 'all',
      response: playlist
    };
  });
}

async function deletePlaylist({ id }) {
  const normalizedId = normalizePlaylistId(id);
  if (!normalizedId) {
    throw new Error('Playlist ID is required');
  }

  return enqueueMutation('deletePlaylist', async (state) => {
    if (!state.playlists[normalizedId]) {
      return {
        changed: false,
        response: { success: true }
      };
    }

    delete state.playlists[normalizedId];

    for (const handle of Object.keys(state.channelPlaylists)) {
      state.channelPlaylists[handle] = (state.channelPlaylists[handle] || []).filter(
        playlistId => playlistId !== normalizedId
      );
      if (state.channelPlaylists[handle].length === 0) {
        delete state.channelPlaylists[handle];
      }
    }

    return {
      changed: true,
      broadcastKey: 'all',
      response: { success: true }
    };
  });
}

async function registerChannel({ handle, channelId, name }) {
  const normalizedHandle = normalizeStoredHandle(handle);
  if (!normalizedHandle) {
    throw new Error('Invalid channel handle');
  }
  const normalizedChannelId = normalizeChannelId(channelId);

  return enqueueMutation('registerChannel', async (state) => {
    const existing = state.channels[normalizedHandle];
    const normalizedName = normalizeChannelName(name, existing?.name || normalizedHandle);
    const nextChannel = {
      handle: normalizedHandle,
      channelId: normalizedChannelId || existing?.channelId || '',
      name: normalizedName,
      updatedAt: Date.now()
    };

    const changed = !existing
      || existing.channelId !== nextChannel.channelId
      || existing.name !== nextChannel.name;

    if (!changed) {
      return {
        changed: false,
        response: { success: true }
      };
    }

    state.channels[normalizedHandle] = nextChannel;
    return {
      changed: true,
      broadcastKey: null,
      response: { success: true }
    };
  });
}

async function assignChannelPlaylist({ handle, name, playlistId, assign }) {
  const normalizedHandle = normalizeStoredHandle(handle);
  const normalizedPlaylistId = normalizePlaylistId(playlistId);
  if (!normalizedHandle) {
    throw new Error('Invalid channel handle');
  }
  if (!normalizedPlaylistId) {
    throw new Error('Playlist ID is required');
  }
  if (typeof assign !== 'boolean') {
    throw new Error('Assign flag must be boolean');
  }

  return enqueueMutation('assignChannelPlaylist', async (state) => {
    if (!state.playlists[normalizedPlaylistId]) {
      throw new Error('Playlist not found');
    }

    if (assign && !state.channels[normalizedHandle]) {
      state.channels[normalizedHandle] = {
        handle: normalizedHandle,
        channelId: '',
        name: normalizeChannelName(name, normalizedHandle),
        updatedAt: Date.now()
      };
    }

    const current = [...(state.channelPlaylists[normalizedHandle] || [])];
    if (assign) {
      if (!current.includes(normalizedPlaylistId)) current.push(normalizedPlaylistId);
    } else {
      const idx = current.indexOf(normalizedPlaylistId);
      if (idx !== -1) current.splice(idx, 1);
    }

    if (current.length > 0) {
      state.channelPlaylists[normalizedHandle] = current;
    } else {
      delete state.channelPlaylists[normalizedHandle];
    }

    return {
      changed: true,
      broadcastKey: 'all',
      response: { success: true }
    };
  });
}

async function getChannelAssignments({ handle }) {
  const normalizedHandle = normalizeStoredHandle(handle);
  if (!normalizedHandle) {
    throw new Error('Invalid channel handle');
  }

  const data = await chrome.storage.local.get(['channelPlaylists']);
  return {
    playlists: (data.channelPlaylists || {})[normalizedHandle] || []
  };
}

async function updateSettings(newSettings) {
  const normalizedSettings = normalizeSettingsInput(newSettings);

  return enqueueMutation('updateSettings', async (state) => {
    state.settings = {
      ...DEFAULT_SETTINGS,
      ...(state.settings || {}),
      ...normalizedSettings
    };
    return {
      changed: true,
      broadcastKey: 'all',
      response: state.settings
    };
  });
}

async function reorderPlaylists({ orderedIds }) {
  if (!Array.isArray(orderedIds)) {
    throw new Error('orderedIds must be an array');
  }

  const normalizedOrderedIds = [...new Set(
    orderedIds
      .map(normalizePlaylistId)
      .filter(Boolean)
  )];

  return enqueueMutation('reorderPlaylists', async (state) => {
    const currentIds = Object.keys(state.playlists);
    const remainingIds = currentIds
      .filter(id => !normalizedOrderedIds.includes(id))
      .sort((a, b) => (state.playlists[a].order || 0) - (state.playlists[b].order || 0));
    const finalOrder = [...normalizedOrderedIds.filter(id => state.playlists[id]), ...remainingIds];

    finalOrder.forEach((playlistId, index) => {
      state.playlists[playlistId].order = index;
      state.playlists[playlistId].updatedAt = Date.now();
    });

    return {
      changed: true,
      broadcastKey: 'all',
      response: { success: true }
    };
  });
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
  return /^[A-Za-z0-9._-]{10,}$/.test(trimmed) ? trimmed : null;
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
    const results = await Promise.allSettled(
      tabs.map(tab => chrome.tabs.sendMessage(tab.id, payload))
    );
    const failedCount = results.filter(result => result.status === 'rejected').length;
    if (failedCount > 0) {
      console.debug(`SYO broadcast skipped ${failedCount} tab(s)`, { key });
    }
  } catch (error) {
    // Tabs may not be available
    console.debug('SYO broadcast unavailable', error);
  }
}

// --- Import ---

async function importData({ playlists, channels, channelPlaylists, mode }) {
  const imported = normalizeImportedData({ playlists, channels, channelPlaylists });
  if (mode !== 'replace' && mode !== 'merge') {
    throw new Error('Invalid import mode');
  }

  return enqueueMutation('importData', async (state) => {
    if (mode === 'replace') {
      state.playlists = imported.playlists;
      state.channels = imported.channels;
      state.channelPlaylists = imported.channelPlaylists;
      return {
        changed: true,
        broadcastKey: 'all',
        response: { success: true }
      };
    }

    const mergedPlaylists = { ...state.playlists };
    const mergedChannels = { ...state.channels };
    const mergedChannelPlaylists = { ...state.channelPlaylists };
    let nextOrder = Object.values(mergedPlaylists).reduce(
      (max, playlist) => Math.max(max, Number.isFinite(playlist.order) ? playlist.order : -1),
      -1
    );

    for (const [playlistId, playlist] of Object.entries(imported.playlists)) {
      if (mergedPlaylists[playlistId]) {
        mergedPlaylists[playlistId] = {
          ...mergedPlaylists[playlistId],
          name: playlist.name,
          color: playlist.color,
          updatedAt: Date.now()
        };
        continue;
      }

      nextOrder += 1;
      mergedPlaylists[playlistId] = {
        ...playlist,
        order: nextOrder,
        updatedAt: Date.now()
      };
    }

    for (const [handle, channel] of Object.entries(imported.channels)) {
      mergedChannels[handle] = mergedChannels[handle]
        ? {
            ...mergedChannels[handle],
            channelId: channel.channelId || mergedChannels[handle].channelId || '',
            name: channel.name || mergedChannels[handle].name || handle,
            updatedAt: Date.now()
          }
        : { ...channel };
    }

    for (const [handle, playlistIds] of Object.entries(imported.channelPlaylists)) {
      const existing = mergedChannelPlaylists[handle] || [];
      const validPlaylistIds = playlistIds.filter(playlistId => mergedPlaylists[playlistId]);
      mergedChannelPlaylists[handle] = [...new Set([...existing, ...validPlaylistIds])];
    }

    state.playlists = mergedPlaylists;
    state.channels = mergedChannels;
    state.channelPlaylists = mergedChannelPlaylists;

    return {
      changed: true,
      broadcastKey: 'all',
      response: { success: true }
    };
  });
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
