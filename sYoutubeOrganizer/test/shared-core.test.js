'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const core = require('../shared-core.js');

function createState(overrides = {}) {
  return {
    playlists: {},
    channels: {},
    channelPlaylists: {},
    settings: { ...core.DEFAULT_SETTINGS },
    ...overrides
  };
}

test('parseManualChannelInput accepts handles, channel URLs, and bare handles', () => {
  assert.deepEqual(core.parseManualChannelInput('@NetFlix'), {
    handle: '@NetFlix',
    displayName: 'NetFlix'
  });

  assert.deepEqual(core.parseManualChannelInput('https://www.youtube.com/@LinusTechTips/'), {
    handle: '@LinusTechTips',
    displayName: 'LinusTechTips'
  });

  assert.deepEqual(
    core.parseManualChannelInput('https://m.youtube.com/channel/UCXuqSBlHAE6Xw-yeJA0Tunw'),
    {
      handle: 'UCXuqSBlHAE6Xw-yeJA0Tunw',
      displayName: 'UCXuqSBlHAE6Xw-yeJA0Tunw'
    }
  );

  assert.deepEqual(core.parseManualChannelInput('SomeCreator'), {
    handle: '@SomeCreator',
    displayName: 'SomeCreator'
  });
});

test('parseManualChannelInput rejects unsupported URLs and invalid handles', () => {
  assert.equal(core.parseManualChannelInput('   '), null);
  assert.deepEqual(
    core.parseManualChannelInput('https://www.youtube.com/watch?v=abc123'),
    { error: 'Paste a YouTube channel URL, not a video or playlist URL' }
  );
  assert.deepEqual(
    core.parseManualChannelInput('https://example.com/@creator'),
    { error: 'Only YouTube channel URLs are supported' }
  );
  assert.deepEqual(
    core.parseManualChannelInput('@bad handle'),
    { error: 'Enter a valid YouTube @handle' }
  );
});

test('normalizeImportedData filters invalid entries and normalizes assignments', () => {
  const normalized = core.normalizeImportedData({
    playlists: {
      ' later ': { name: ' Later ', color: '#12GG34', order: 7 },
      ' fav ': { name: ' Favorites ', color: '#123456', order: 1 },
      bad: { color: '#000000' }
    },
    channels: {
      ' @Creator ': { channelId: ' UC123 ', name: ' Creator Name ' },
      invalid: { channelId: 'ignored', name: 'Ignored' }
    },
    channelPlaylists: {
      ' @Creator ': [' fav ', ' fav ', 'missing'],
      '@AutoCreated': ['later', 'later'],
      bad: ['fav']
    }
  }, { now: () => 111 });

  assert.deepEqual(Object.keys(normalized.playlists), ['fav', 'later']);
  assert.deepEqual(normalized.playlists.fav, {
    id: 'fav',
    name: 'Favorites',
    color: '#123456',
    order: 0,
    createdAt: 111,
    updatedAt: 111
  });
  assert.equal(normalized.playlists.later.color, '#4a9eff');
  assert.deepEqual(normalized.channels['@Creator'], {
    handle: '@Creator',
    channelId: 'UC123',
    name: 'Creator Name',
    updatedAt: 111
  });
  assert.deepEqual(normalized.channels['@AutoCreated'], {
    handle: '@AutoCreated',
    channelId: '',
    name: '@AutoCreated',
    updatedAt: 111
  });
  assert.deepEqual(normalized.channelPlaylists, {
    '@Creator': ['fav'],
    '@AutoCreated': ['later']
  });
});

test('applyCreatePlaylistMutation adds a playlist with normalized values', () => {
  const state = createState({
    playlists: {
      existing: { id: 'existing', order: 3 }
    }
  });

  const playlist = core.applyCreatePlaylistMutation(
    state,
    { name: '  Long playlist name  ', color: 'bad-color' },
    { now: () => 222, randomUUID: () => 'abcd1234wxyz' }
  );

  assert.deepEqual(playlist, {
    id: 'pl_abcd1234',
    name: 'Long playlist name',
    color: '#4a9eff',
    order: 4,
    createdAt: 222,
    updatedAt: 222
  });
  assert.deepEqual(state.playlists['pl_abcd1234'], playlist);
});

test('applyAssignChannelPlaylistMutation adds, deduplicates, and removes assignments', () => {
  const state = createState({
    playlists: {
      fav: { id: 'fav', order: 0 }
    }
  });

  assert.deepEqual(
    core.applyAssignChannelPlaylistMutation(
      state,
      { handle: '@Creator', name: ' Creator Name ', playlistId: 'fav', assign: true },
      { now: () => 333 }
    ),
    { success: true }
  );
  assert.deepEqual(state.channels['@Creator'], {
    handle: '@Creator',
    channelId: '',
    name: 'Creator Name',
    updatedAt: 333
  });
  assert.deepEqual(state.channelPlaylists['@Creator'], ['fav']);

  core.applyAssignChannelPlaylistMutation(
    state,
    { handle: '@Creator', playlistId: 'fav', assign: true },
    { now: () => 444 }
  );
  assert.deepEqual(state.channelPlaylists['@Creator'], ['fav']);

  core.applyAssignChannelPlaylistMutation(
    state,
    { handle: '@Creator', playlistId: 'fav', assign: false },
    { now: () => 555 }
  );
  assert.equal(state.channelPlaylists['@Creator'], undefined);
});

test('applyUpdateSettingsMutation normalizes theme and boolean settings', () => {
  const state = createState({
    settings: {
      ...core.DEFAULT_SETTINGS,
      theme: 'light'
    }
  });

  const nextSettings = core.applyUpdateSettingsMutation(state, {
    theme: 'unknown',
    hideShorts: 1,
    hideMostRelevant: 0,
    redirectRootToSubscriptions: 'yes',
    subscriptionsFilterPreference: 'bad'
  });

  assert.deepEqual(nextSettings, {
    theme: 'dark',
    subscriptionsFilterPreference: null,
    hideShorts: true,
    hideMostRelevant: false,
    redirectRootToSubscriptions: true
  });
});

test('applyImportDataMutation replaces and merges state predictably', () => {
  const replaceState = createState({
    playlists: {
      stale: { id: 'stale', name: 'Old', color: '#ffffff', order: 0, createdAt: 1, updatedAt: 1 }
    },
    channels: {
      '@Old': { handle: '@Old', channelId: '', name: 'Old', updatedAt: 1 }
    },
    channelPlaylists: {
      '@Old': ['stale']
    }
  });

  assert.deepEqual(core.applyImportDataMutation(replaceState, {
    playlists: {
      keep: { name: ' Keep ', color: '#111111', order: 0 }
    },
    channels: {
      '@New': { channelId: ' UC999 ', name: ' New Name ' }
    },
    channelPlaylists: {
      '@New': ['keep']
    },
    mode: 'replace'
  }, { now: () => 666 }), { success: true });

  assert.deepEqual(Object.keys(replaceState.playlists), ['keep']);
  assert.deepEqual(replaceState.channelPlaylists, { '@New': ['keep'] });

  const mergeState = createState({
    playlists: {
      keep: { id: 'keep', name: 'Original', color: '#000000', order: 0, createdAt: 5, updatedAt: 5 }
    },
    channels: {
      '@Existing': { handle: '@Existing', channelId: '', name: 'Existing', updatedAt: 5 }
    },
    channelPlaylists: {
      '@Existing': ['keep']
    }
  });

  core.applyImportDataMutation(mergeState, {
    playlists: {
      keep: { name: 'Updated Name', color: '#222222', order: 0 },
      later: { name: 'Later', color: '#333333', order: 1 }
    },
    channels: {
      '@Existing': { channelId: 'UC777', name: 'Existing Updated' },
      '@Fresh': { channelId: '', name: 'Fresh' }
    },
    channelPlaylists: {
      '@Existing': ['keep', 'later'],
      '@Fresh': ['later']
    },
    mode: 'merge'
  }, { now: () => 777 });

  assert.equal(mergeState.playlists.keep.name, 'Updated Name');
  assert.equal(mergeState.playlists.keep.color, '#222222');
  assert.equal(mergeState.playlists.keep.updatedAt, 777);
  assert.equal(mergeState.playlists.later.order, 1);
  assert.deepEqual(mergeState.channelPlaylists['@Existing'], ['keep', 'later']);
  assert.deepEqual(mergeState.channelPlaylists['@Fresh'], ['later']);
});
