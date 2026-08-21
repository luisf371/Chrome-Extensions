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

  function normalizeImportedPlaylistId(id) {
    if (typeof id !== 'string') return null;
    const trimmed = id.trim();
    return /^[A-Za-z0-9._-]+$/.test(trimmed) ? trimmed : null;
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

  // Subgroups are exactly one level deep: a playlist's parent must exist,
  // must not be the playlist itself, and must itself be top-level. These
  // checks also make cycles impossible (a cycle needs two levels).
  // Existence is own-property only: inherited names like "constructor" must
  // never count as playlists.
  function validatePlaylistParent(playlists, parentId, selfId) {
    const parent = Object.hasOwn(playlists, parentId) ? playlists[parentId] : undefined;
    if (!parent) {
      throw new Error('Parent playlist not found');
    }
    if (selfId && parent.id === selfId) {
      throw new Error('A playlist cannot be its own parent');
    }
    if (parent.parentId) {
      throw new Error('Subgroups can only live under top-level playlists');
    }
    return parentId;
  }

  function playlistHasChildren(playlists, playlistId) {
    return Object.values(playlists).some((playlist) => playlist.parentId === playlistId);
  }

  // Repairs stored/imported parent links instead of rejecting the payload:
  // missing or self-referencing parents become null, and any playlist whose
  // parent is itself a subgroup is promoted to top level. Own-property
  // lookups keep reserved names ("constructor", "__proto__") from being
  // mistaken for playlists.
  function sanitizePlaylistParents(playlists) {
    for (const playlist of Object.values(playlists)) {
      const parentId = playlist.parentId;
      if (!parentId || parentId === playlist.id || !Object.hasOwn(playlists, parentId)) {
        playlist.parentId = null;
      }
    }

    // Snapshot the "is my parent a subgroup" flags first so cycles between
    // two playlists resolve in a single pass.
    const nested = Object.values(playlists)
      .map((playlist) => {
        const parent = playlist.parentId && Object.hasOwn(playlists, playlist.parentId)
          ? playlists[playlist.parentId]
          : undefined;
        return { playlist, wasNested: Boolean(parent?.parentId) };
      });
    for (const { playlist, wasNested } of nested) {
      if (wasNested) playlist.parentId = null;
    }
    return playlists;
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
    // Null-prototype maps: an imported "__proto__" key must become an own
    // property, not silently replace the map's prototype, and inherited
    // names like "constructor" must never satisfy existence checks.
    const normalizedPlaylists = Object.create(null);
    const playlistEntries = Object.entries(playlists)
      .filter(([id, playlist]) => (
        normalizeImportedPlaylistId(id) &&
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

    let nextOrder = 0;
    playlistEntries.forEach(([id, playlist]) => {
      const playlistId = normalizeImportedPlaylistId(id);
      // Distinct raw keys can normalize to the same id ("a" vs " a "):
      // keep the first entry (lowest order) and drop later collisions so
      // orders stay contiguous.
      if (!playlistId || Object.hasOwn(normalizedPlaylists, playlistId)) return;
      const parentCandidate = normalizeImportedPlaylistId(playlist.parentId || '');
      normalizedPlaylists[playlistId] = {
        id: playlistId,
        name: playlist.name.trim().slice(0, 50),
        color: normalizePlaylistColor(playlist.color),
        // Parent links are format-validated only here; repair against the
        // full playlist set happens in applyImportDataMutation, after merge
        // mode has combined imported and existing playlists.
        parentId: parentCandidate && parentCandidate !== playlistId ? parentCandidate : null,
        order: nextOrder++,
        createdAt: Number.isFinite(playlist.createdAt) ? playlist.createdAt : now,
        updatedAt: now
      };
    });

    const normalizedChannels = Object.create(null);
    for (const [rawHandle, channel] of Object.entries(channels || {})) {
      const handle = normalizeStoredHandle(rawHandle);
      if (!handle) continue;
      // A missing/invalid name stays null (unknown) instead of falling back
      // to the handle: merge must be able to tell "imported name" apart
      // from "no name in the file" to avoid clobbering a good stored name.
      // Channel keys that normalize to the same handle keep each other's
      // channelId/name rather than the later raw key winning outright.
      const previous = Object.hasOwn(normalizedChannels, handle) ? normalizedChannels[handle] : null;
      normalizedChannels[handle] = {
        handle,
        channelId: normalizeChannelId(channel?.channelId) || previous?.channelId || '',
        name: typeof channel?.name === 'string' && channel.name.trim()
          ? channel.name.trim().slice(0, 100)
          : (previous?.name ?? null),
        updatedAt: now
      };
    }

    const normalizedChannelPlaylists = Object.create(null);
    for (const [rawHandle, playlistIds] of Object.entries(channelPlaylists || {})) {
      const handle = normalizeStoredHandle(rawHandle);
      if (!handle || !Array.isArray(playlistIds)) continue;

      const earlier = Object.hasOwn(normalizedChannelPlaylists, handle)
        ? normalizedChannelPlaylists[handle]
        : [];
      const validPlaylistIds = [...new Set([
        ...earlier,
        ...playlistIds
          .map(id => typeof id === 'string' ? id.trim() : '')
          .filter(id => id && Object.hasOwn(normalizedPlaylists, id))
      ])];

      if (validPlaylistIds.length === 0) continue;

      normalizedChannelPlaylists[handle] = validPlaylistIds;
      if (!Object.hasOwn(normalizedChannels, handle)) {
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

    const playlists = state.playlists || {};
    let parentId = null;
    if (input?.parentId !== undefined && input?.parentId !== null) {
      parentId = normalizePlaylistId(input.parentId);
      if (!parentId) {
        throw new Error('Invalid parent playlist');
      }
      validatePlaylistParent(playlists, parentId);
    }

    const normalizedColor = normalizePlaylistColor(input?.color);
    const id = 'pl_' + getRandomUUID(deps).slice(0, 8);
    const order = Object.values(playlists).reduce(
      (max, playlist) => Math.max(max, Number.isFinite(playlist.order) ? playlist.order : -1),
      -1
    ) + 1;
    const now = getNow(deps);
    const playlist = {
      id,
      name: normalizedName,
      color: normalizedColor,
      parentId,
      order,
      createdAt: now,
      updatedAt: now
    };
    state.playlists[id] = playlist;
    return playlist;
  }

  function applyUpdatePlaylistMutation(state, input, deps) {
    const normalizedId = normalizePlaylistId(input?.id);
    if (!normalizedId) {
      throw new Error('Playlist ID is required');
    }
    const playlists = state.playlists || {};
    const playlist = Object.hasOwn(playlists, normalizedId) ? playlists[normalizedId] : undefined;
    if (!playlist) {
      return null;
    }

    let nextName;
    if (input?.name !== undefined) {
      nextName = normalizePlaylistName(input.name);
      if (!nextName) {
        throw new Error('Playlist name cannot be empty');
      }
    }

    let nextParentId;
    // `undefined` counts as absent so callers may pass destructured message
    // payloads that carry an own `parentId: undefined` property.
    if (input && 'parentId' in input && input.parentId !== undefined) {
      if (input.parentId === null || input.parentId === '') {
        nextParentId = null;
      } else {
        nextParentId = normalizePlaylistId(input.parentId);
        if (!nextParentId) {
          throw new Error('Invalid parent playlist');
        }
        validatePlaylistParent(playlists, nextParentId, normalizedId);
        if (playlistHasChildren(playlists, normalizedId)) {
          throw new Error('A playlist with subgroups cannot become a subgroup');
        }
      }
    }

    if (nextName !== undefined) playlist.name = nextName;
    if (input?.color !== undefined) playlist.color = normalizePlaylistColor(input.color);
    if (input?.order !== undefined && Number.isFinite(input.order)) playlist.order = input.order;
    if (nextParentId !== undefined) playlist.parentId = nextParentId;
    playlist.updatedAt = getNow(deps);
    return playlist;
  }

  function applyDeletePlaylistMutation(state, input, deps) {
    const normalizedId = normalizePlaylistId(input?.id);
    if (!normalizedId) {
      throw new Error('Playlist ID is required');
    }

    const playlists = state.playlists || {};
    if (!Object.hasOwn(playlists, normalizedId)) {
      return { success: true, promotedIds: [] };
    }

    delete playlists[normalizedId];

    // Subgroups survive their parent: they are promoted to top level so the
    // delete never wipes an entire subtree.
    const promotedIds = [];
    const now = getNow(deps);
    for (const playlist of Object.values(playlists)) {
      if (playlist.parentId === normalizedId) {
        playlist.parentId = null;
        playlist.updatedAt = now;
        promotedIds.push(playlist.id);
      }
    }

    const channelPlaylists = state.channelPlaylists || {};
    for (const handle of Object.keys(channelPlaylists)) {
      channelPlaylists[handle] = (channelPlaylists[handle] || []).filter(
        (playlistId) => playlistId !== normalizedId
      );
      if (channelPlaylists[handle].length === 0) {
        delete channelPlaylists[handle];
      }
    }

    return { success: true, promotedIds };
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
    if (!Object.hasOwn(state.playlists, normalizedPlaylistId)) {
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
      const parentId = state.playlists[normalizedPlaylistId].parentId;
      if (parentId && Object.hasOwn(state.playlists, parentId) && !current.includes(parentId)) {
        current.push(parentId);
      }
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
      sanitizePlaylistParents(imported.playlists);
      for (const channel of Object.values(imported.channels)) {
        if (!channel.name) channel.name = channel.handle;
      }
      state.playlists = imported.playlists;
      state.channels = imported.channels;
      state.channelPlaylists = imported.channelPlaylists;
      return { success: true };
    }

    const now = getNow(deps);
    // Null-prototype merges so reserved-name ids can only ever be own keys.
    const mergedPlaylists = Object.assign(Object.create(null), state.playlists);
    const mergedChannels = Object.assign(Object.create(null), state.channels);
    const mergedChannelPlaylists = Object.assign(Object.create(null), state.channelPlaylists);
    let nextOrder = Object.values(mergedPlaylists).reduce(
      (max, playlist) => Math.max(max, Number.isFinite(playlist.order) ? playlist.order : -1),
      -1
    );

    for (const [playlistId, playlist] of Object.entries(imported.playlists)) {
      if (Object.hasOwn(mergedPlaylists, playlistId)) {
        mergedPlaylists[playlistId] = {
          ...mergedPlaylists[playlistId],
          name: playlist.name,
          color: playlist.color,
          parentId: playlist.parentId,
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
    sanitizePlaylistParents(mergedPlaylists);

    for (const [handle, channel] of Object.entries(imported.channels)) {
      const existing = Object.hasOwn(mergedChannels, handle) ? mergedChannels[handle] : null;
      mergedChannels[handle] = existing
        ? {
            ...existing,
            channelId: channel.channelId || existing.channelId || '',
            name: channel.name || existing.name || handle,
            updatedAt: now
          }
        : { ...channel, name: channel.name || handle };
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
    normalizeImportedPlaylistId,
    normalizeChannelName,
    normalizeChannelId,
    normalizeSettingsInput,
    normalizeStoredHandle,
    normalizePlaylistColor,
    sanitizePlaylistParents,
    normalizeImportedData,
    applyCreatePlaylistMutation,
    applyUpdatePlaylistMutation,
    applyDeletePlaylistMutation,
    applyAssignChannelPlaylistMutation,
    applyUpdateSettingsMutation,
    applyImportDataMutation,
    parseManualChannelInput
  };
});
