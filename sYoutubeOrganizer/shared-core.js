(function (root, factory) {
  const api = factory();
  root.SYPSharedCore = api;
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const DEFAULT_SETTINGS = {
    theme: 'dark',
    subscriptionsFilterPreference: null,
    hideShorts: false,
    hideMostRelevant: false,
    redirectRootToSubscriptions: false
  };

  function isPlainObject(value) {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
  }

  function getNow(deps) {
    return typeof deps?.now === 'function' ? deps.now() : Date.now();
  }

  function getRandomUUID(deps) {
    if (typeof deps?.randomUUID === 'function') {
      return deps.randomUUID();
    }
    if (typeof crypto?.randomUUID === 'function') {
      return crypto.randomUUID();
    }
    throw new Error('randomUUID is unavailable');
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
    if (newSettings.redirectRootToSubscriptions !== undefined) {
      normalized.redirectRootToSubscriptions = !!newSettings.redirectRootToSubscriptions;
    }
    return normalized;
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

  function normalizeImportedData(input, deps) {
    const { playlists, channels, channelPlaylists } = input || {};

    if (!isPlainObject(playlists)) {
      throw new Error('Invalid import: playlists must be an object');
    }
    if (channels !== undefined && !isPlainObject(channels)) {
      throw new Error('Invalid import: channels must be an object');
    }
    if (channelPlaylists !== undefined && !isPlainObject(channelPlaylists)) {
      throw new Error('Invalid import: channelPlaylists must be an object');
    }

    const now = getNow(deps);
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
        channelId: normalizeChannelId(channel?.channelId),
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

  function applyCreatePlaylistMutation(state, input, deps) {
    const normalizedName = normalizePlaylistName(input?.name);
    if (!normalizedName) {
      throw new Error('Playlist name is required');
    }

    const normalizedColor = normalizePlaylistColor(input?.color);
    const id = 'pl_' + getRandomUUID(deps).slice(0, 8);
    const order = Object.values(state.playlists || {}).reduce(
      (max, playlist) => Math.max(max, Number.isFinite(playlist.order) ? playlist.order : -1),
      -1
    ) + 1;
    const now = getNow(deps);
    const playlist = {
      id,
      name: normalizedName,
      color: normalizedColor,
      order,
      createdAt: now,
      updatedAt: now
    };
    state.playlists[id] = playlist;
    return playlist;
  }

  function applyAssignChannelPlaylistMutation(state, input, deps) {
    const normalizedHandle = normalizeStoredHandle(input?.handle);
    const normalizedPlaylistId = normalizePlaylistId(input?.playlistId);
    if (!normalizedHandle) {
      throw new Error('Invalid channel handle');
    }
    if (!normalizedPlaylistId) {
      throw new Error('Playlist ID is required');
    }
    if (typeof input?.assign !== 'boolean') {
      throw new Error('Assign flag must be boolean');
    }
    if (!state.playlists[normalizedPlaylistId]) {
      throw new Error('Playlist not found');
    }

    if (input.assign && !state.channels[normalizedHandle]) {
      state.channels[normalizedHandle] = {
        handle: normalizedHandle,
        channelId: '',
        name: normalizeChannelName(input?.name, normalizedHandle),
        updatedAt: getNow(deps)
      };
    }

    const current = [...(state.channelPlaylists[normalizedHandle] || [])];
    if (input.assign) {
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

    return { success: true };
  }

  function applyUpdateSettingsMutation(state, newSettings) {
    const normalizedSettings = normalizeSettingsInput(newSettings);
    state.settings = {
      ...DEFAULT_SETTINGS,
      ...(state.settings || {}),
      ...normalizedSettings
    };
    return state.settings;
  }

  function applyImportDataMutation(state, input, deps) {
    const mode = input?.mode;
    const imported = normalizeImportedData(input, deps);
    if (mode !== 'replace' && mode !== 'merge') {
      throw new Error('Invalid import mode');
    }

    if (mode === 'replace') {
      state.playlists = imported.playlists;
      state.channels = imported.channels;
      state.channelPlaylists = imported.channelPlaylists;
      return { success: true };
    }

    const now = getNow(deps);
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
          updatedAt: now
        };
        continue;
      }

      nextOrder += 1;
      mergedPlaylists[playlistId] = {
        ...playlist,
        order: nextOrder,
        updatedAt: now
      };
    }

    for (const [handle, channel] of Object.entries(imported.channels)) {
      mergedChannels[handle] = mergedChannels[handle]
        ? {
            ...mergedChannels[handle],
            channelId: channel.channelId || mergedChannels[handle].channelId || '',
            name: channel.name || mergedChannels[handle].name || handle,
            updatedAt: now
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
    return { success: true };
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

    if (/^UC[A-Za-z0-9._-]{20,}$/.test(value)) {
      return { handle: value, displayName: value };
    }

    if (/^[A-Za-z0-9._-]+$/.test(value)) {
      return { handle: '@' + value, displayName: value };
    }

    return { error: 'Enter a valid @handle, channel ID, or YouTube channel URL' };
  }

  return {
    DEFAULT_SETTINGS,
    isPlainObject,
    normalizePlaylistName,
    normalizePlaylistId,
    normalizeChannelName,
    normalizeChannelId,
    normalizeSettingsInput,
    normalizeStoredHandle,
    normalizePlaylistColor,
    normalizeImportedData,
    applyCreatePlaylistMutation,
    applyAssignChannelPlaylistMutation,
    applyUpdateSettingsMutation,
    applyImportDataMutation,
    parseManualChannelInput
  };
});
