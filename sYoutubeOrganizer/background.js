'use strict';

importScripts('shared-core.js');

const sharedCore = globalThis.SYPSharedCore;

const DEFAULT_SETTINGS = { ...sharedCore.DEFAULT_SETTINGS };
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
  return sharedCore.normalizePlaylistName(name);
}

function normalizePlaylistId(id) {
  return sharedCore.normalizePlaylistId(id);
}

function normalizeChannelName(name, fallback) {
  return sharedCore.normalizeChannelName(name, fallback);
}

function normalizeChannelId(channelId) {
  return sharedCore.normalizeChannelId(channelId);
}

function normalizeSettingsInput(newSettings) {
  return sharedCore.normalizeSettingsInput(newSettings);
}

async function createPlaylist({ name, color }) {
  return enqueueMutation('createPlaylist', async (state) => {
    const playlist = sharedCore.applyCreatePlaylistMutation(state, { name, color }, {
      now: () => Date.now(),
      randomUUID: () => crypto.randomUUID()
    });
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
  return enqueueMutation('assignChannelPlaylist', async (state) => {
    const response = sharedCore.applyAssignChannelPlaylistMutation(state, {
      handle,
      name,
      playlistId,
      assign
    }, {
      now: () => Date.now()
    });
    return {
      changed: true,
      broadcastKey: 'all',
      response
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
  return enqueueMutation('updateSettings', async (state) => {
    const response = sharedCore.applyUpdateSettingsMutation(state, newSettings);
    return {
      changed: true,
      broadcastKey: 'all',
      response
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
  return sharedCore.isPlainObject(value);
}

function normalizeStoredHandle(handle) {
  return sharedCore.normalizeStoredHandle(handle);
}

function normalizePlaylistColor(color) {
  return sharedCore.normalizePlaylistColor(color);
}

function normalizeImportedData({ playlists, channels, channelPlaylists }) {
  return sharedCore.normalizeImportedData({ playlists, channels, channelPlaylists });
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
  return enqueueMutation('importData', async (state) => {
    const response = sharedCore.applyImportDataMutation(state, {
      playlists,
      channels,
      channelPlaylists,
      mode
    }, {
      now: () => Date.now()
    });
    return {
      changed: true,
      broadcastKey: 'all',
      response
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
