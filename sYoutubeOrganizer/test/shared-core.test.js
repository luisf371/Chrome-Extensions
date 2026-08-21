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
    parentId: null,
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
  assert.deepEqual({ ...normalized.channelPlaylists }, {
    '@Creator': ['fav'],
    '@AutoCreated': ['later']
  });
});

test('normalizeImportedData drops playlist IDs with unsafe characters', () => {
  const maliciousId = 'x"><img src=x onerror=alert(1)>';
  const normalized = core.normalizeImportedData({
    playlists: {
      [maliciousId]: { name: 'Evil', color: '#ff0000', order: 0 },
      safe: { name: 'Safe', color: '#123456', order: 1 }
    },
    channels: {},
    channelPlaylists: {
      '@Creator': [maliciousId, 'safe']
    }
  }, { now: () => 0 });

  assert.deepEqual(Object.keys(normalized.playlists), ['safe']);
  assert.equal(normalized.playlists[maliciousId], undefined);
  // Assignments referencing the dropped ID are filtered out too.
  assert.deepEqual({ ...normalized.channelPlaylists }, { '@Creator': ['safe'] });
});

test('normalizeImportedData keeps valid parents and repairs invalid ones', () => {
  // normalizeImportedData only format-checks parent links; the cross-record
  // repair runs in applyImportDataMutation once the full playlist set is
  // known (imported alone for replace, merged with existing for merge).
  const normalized = core.normalizeImportedData({
    playlists: {
      gaming: { name: 'Gaming', color: '#4a9eff', order: 0 },
      minecraft: { name: 'Minecraft', color: '#62a744', order: 1, parentId: 'gaming' },
      selfRef: { name: 'Self', color: '#111111', order: 2, parentId: 'selfRef' },
      orphan: { name: 'Orphan', color: '#222222', order: 3, parentId: 'missing' },
      deep: { name: 'Deep', color: '#333333', order: 4, parentId: 'minecraft' },
      cyclicA: { name: 'A', color: '#444444', order: 5, parentId: 'cyclicB' },
      cyclicB: { name: 'B', color: '#555555', order: 6, parentId: 'cyclicA' }
    },
    channels: {},
    channelPlaylists: {}
  }, { now: () => 0 });
  core.sanitizePlaylistParents(normalized.playlists);

  assert.equal(normalized.playlists.minecraft.parentId, 'gaming');
  assert.equal(normalized.playlists.selfRef.parentId, null);
  assert.equal(normalized.playlists.orphan.parentId, null);
  // A child of a subgroup is promoted to top level instead of rejected.
  assert.equal(normalized.playlists.deep.parentId, null);
  // Two-playlist parent cycles resolve to both being top level.
  assert.equal(normalized.playlists.cyclicA.parentId, null);
  assert.equal(normalized.playlists.cyclicB.parentId, null);
});

test('applyImportDataMutation merge reparents existing playlists and repairs chains', () => {
  const mergeState = createState({
    playlists: {
      gaming: { id: 'gaming', name: 'Gaming', color: '#4a9eff', parentId: null, order: 0, createdAt: 5, updatedAt: 5 },
      minecraft: { id: 'minecraft', name: 'Minecraft', color: '#62a744', parentId: 'gaming', order: 1, createdAt: 5, updatedAt: 5 }
    },
    channels: {},
    channelPlaylists: {}
  });

  core.applyImportDataMutation(mergeState, {
    playlists: {
      gaming: { name: 'Gaming', color: '#4a9eff', order: 0, parentId: 'tech' },
      tech: { name: 'Tech', color: '#000000', order: 1 }
    },
    channels: {},
    channelPlaylists: {},
    mode: 'merge'
  }, { now: () => 888 });

  // Imported parent link is applied, and the subgroup that would now be
  // nested two levels deep is promoted to top level.
  assert.equal(mergeState.playlists.gaming.parentId, 'tech');
  assert.equal(mergeState.playlists.minecraft.parentId, null);
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
    parentId: null,
    order: 4,
    createdAt: 222,
    updatedAt: 222
  });
  assert.deepEqual(state.playlists['pl_abcd1234'], playlist);
});

test('applyCreatePlaylistMutation creates subgroups under top-level playlists only', () => {
  const state = createState({
    playlists: {
      gaming: { id: 'gaming', name: 'Gaming', parentId: null, order: 0 },
      minecraft: { id: 'minecraft', name: 'Minecraft', parentId: 'gaming', order: 1 }
    }
  });
  const deps = { now: () => 1, randomUUID: () => 'aaaa1111bbbb' };

  const subgroup = core.applyCreatePlaylistMutation(
    state,
    { name: 'Fortnite', color: '#8b5cf6', parentId: 'gaming' },
    deps
  );
  assert.equal(subgroup.parentId, 'gaming');

  assert.throws(
    () => core.applyCreatePlaylistMutation(state, { name: 'X', parentId: 'missing' }, deps),
    /Parent playlist not found/
  );
  assert.throws(
    () => core.applyCreatePlaylistMutation(state, { name: 'X', parentId: 'minecraft' }, deps),
    /Subgroups can only live under top-level playlists/
  );
  assert.throws(
    () => core.applyCreatePlaylistMutation(state, { name: 'X', parentId: '   ' }, deps),
    /Invalid parent playlist/
  );
});

test('applyUpdatePlaylistMutation moves subgroups and enforces one-level depth', () => {
  const state = createState({
    playlists: {
      gaming: { id: 'gaming', name: 'Gaming', parentId: null, order: 0 },
      tech: { id: 'tech', name: 'Tech', parentId: null, order: 1 },
      minecraft: { id: 'minecraft', name: 'Minecraft', parentId: 'gaming', order: 2 }
    }
  });
  const deps = { now: () => 999 };

  // Move between top-level parents.
  const moved = core.applyUpdatePlaylistMutation(
    state,
    { id: 'minecraft', parentId: 'tech' },
    deps
  );
  assert.equal(moved.parentId, 'tech');

  // Promote to top level.
  core.applyUpdatePlaylistMutation(state, { id: 'minecraft', parentId: null }, deps);
  assert.equal(state.playlists.minecraft.parentId, null);

  // Reject self-parenting, missing parents, nesting under a subgroup, and
  // turning a parent-with-children into a subgroup.
  assert.throws(
    () => core.applyUpdatePlaylistMutation(state, { id: 'gaming', parentId: 'gaming' }, deps),
    /cannot be its own parent/
  );
  assert.throws(
    () => core.applyUpdatePlaylistMutation(state, { id: 'gaming', parentId: 'nope' }, deps),
    /Parent playlist not found/
  );
  state.playlists.minecraft.parentId = 'gaming';
  assert.throws(
    () => core.applyUpdatePlaylistMutation(state, { id: 'tech', parentId: 'minecraft' }, deps),
    /Subgroups can only live under top-level playlists/
  );
  assert.throws(
    () => core.applyUpdatePlaylistMutation(state, { id: 'gaming', parentId: 'tech' }, deps),
    /with subgroups cannot become a subgroup/
  );

  // Name/color/order still update; unknown ids return null.
  assert.equal(core.applyUpdatePlaylistMutation(state, { id: 'ghost' }, deps), null);
  const renamed = core.applyUpdatePlaylistMutation(
    state,
    { id: 'tech', name: 'Technology', color: '#111111', order: 5 },
    deps
  );
  assert.equal(renamed.name, 'Technology');
  assert.equal(renamed.color, '#111111');
  assert.equal(renamed.order, 5);
});

test('applyUpdatePlaylistMutation treats an explicit undefined parentId as absent', () => {
  // Regression: background.js used to pass a destructured payload whose own
  // `parentId: undefined` property was read as a reparent request, making
  // every ordinary rename fail with "Invalid parent playlist".
  const state = createState({
    playlists: {
      gaming: { id: 'gaming', name: 'Gaming', parentId: null, order: 0 },
      minecraft: { id: 'minecraft', name: 'Minecraft', parentId: 'gaming', order: 1 }
    }
  });

  const renamed = core.applyUpdatePlaylistMutation(
    state,
    { id: 'minecraft', name: 'Minecraft Java', color: '#62a744', order: 7, parentId: undefined },
    { now: () => 1 }
  );
  assert.equal(renamed.name, 'Minecraft Java');
  assert.equal(renamed.parentId, 'gaming');
});

test('applyDeletePlaylistMutation promotes subgroups and cleans assignments', () => {
  const state = createState({
    playlists: {
      gaming: { id: 'gaming', name: 'Gaming', parentId: null, order: 0 },
      minecraft: { id: 'minecraft', name: 'Minecraft', parentId: 'gaming', order: 1 },
      tech: { id: 'tech', name: 'Tech', parentId: null, order: 2 }
    },
    channels: {
      '@A': { handle: '@A', channelId: '', name: 'A', updatedAt: 1 },
      '@B': { handle: '@B', channelId: '', name: 'B', updatedAt: 1 }
    },
    channelPlaylists: {
      '@A': ['gaming', 'minecraft'],
      '@B': ['tech', 'gaming']
    }
  });

  const result = core.applyDeletePlaylistMutation(state, { id: 'gaming' }, { now: () => 42 });

  assert.deepEqual(result, { success: true, promotedIds: ['minecraft'] });
  assert.equal(state.playlists.gaming, undefined);
  assert.equal(state.playlists.minecraft.parentId, null);
  assert.equal(state.playlists.minecraft.updatedAt, 42);
  assert.deepEqual(state.channelPlaylists['@A'], ['minecraft']);
  assert.deepEqual(state.channelPlaylists['@B'], ['tech']);

  // Idempotent for unknown ids.
  assert.deepEqual(
    core.applyDeletePlaylistMutation(state, { id: 'ghost' }, { now: () => 42 }),
    { success: true, promotedIds: [] }
  );
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

test('assigning a subgroup also assigns its parent', () => {
  const state = createState({
    playlists: {
      gaming: { id: 'gaming', order: 0 },
      sims: { id: 'sims', parentId: 'gaming', order: 1 }
    }
  });

  core.applyAssignChannelPlaylistMutation(
    state,
    { handle: '@Creator', playlistId: 'sims', assign: true },
    { now: () => 333 }
  );
  assert.deepEqual(state.channelPlaylists['@Creator'], ['gaming', 'sims']);

  core.applyAssignChannelPlaylistMutation(
    state,
    { handle: '@Creator', playlistId: 'sims', assign: false },
    { now: () => 444 }
  );
  assert.deepEqual(state.channelPlaylists['@Creator'], ['gaming']);
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
  assert.deepEqual({ ...replaceState.channelPlaylists }, { '@New': ['keep'] });

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

test('import treats reserved property names as plain ids, never prototypes', () => {
  // Regression: a "__proto__" playlist key used to replace the map's
  // prototype instead of becoming a record, and inherited names like
  // "constructor" satisfied parent/assignment existence checks.
  // The payload is parsed from a raw string like a real import file:
  // only JSON.parse keeps "__proto__" as an own key.
  const parsed = JSON.parse(`{
    "playlists": {
      "__proto__": { "name": "Proto Kid", "color": "#111111", "order": 0 },
      "constructor": { "name": "Ctor", "color": "#222222", "order": 1 },
      "kid": { "name": "Kid", "color": "#333333", "order": 2, "parentId": "constructor" }
    },
    "channels": {},
    "channelPlaylists": { "@x": ["__proto__", "constructor", "kid"] }
  }`);
  const state = createState();

  core.applyImportDataMutation(state, { ...parsed, mode: 'replace' }, { now: () => 0 });

  assert.deepEqual(Object.keys(state.playlists).sort(), ['__proto__', 'constructor', 'kid']);
  assert.equal(Object.getPrototypeOf(state.playlists), null);
  assert.equal(state.playlists.__proto__.name, 'Proto Kid');
  assert.equal(state.playlists.kid.parentId, 'constructor', 'own-key parent is a real parent now');
  assert.deepEqual(state.channelPlaylists['@x'], ['__proto__', 'constructor', 'kid']);
});

test('import drops dangling parents and assignments to nonexistent playlists', () => {
  // Regression: parentId "constructor"/"toString" used to survive sanitize
  // (inherited truthiness) and made the playlist invisible in the tree.
  const state = createState();
  core.applyImportDataMutation(state, {
    playlists: { kid: { name: 'Kid', color: '#111111', order: 0, parentId: 'toString' } },
    channels: {},
    channelPlaylists: { '@x': ['valueOf', 'kid'] },
    mode: 'replace'
  }, { now: () => 0 });

  assert.equal(state.playlists.kid.parentId, null);
  assert.deepEqual(state.channelPlaylists['@x'], ['kid']);
});

test('merge with a reserved-name id creates a complete record', () => {
  // Regression: the merge conflict check treated inherited "constructor" as
  // an existing playlist and stored a malformed update-branch record.
  const state = createState({
    playlists: { real: { id: 'real', name: 'R', color: '#111111', parentId: null, order: 0, createdAt: 5, updatedAt: 5 } }
  });

  core.applyImportDataMutation(state, {
    playlists: { constructor: { name: 'Ctor', color: '#222222', order: 0 } },
    channels: {},
    channelPlaylists: {},
    mode: 'merge'
  }, { now: () => 9 });

  const merged = state.playlists.constructor;
  assert.equal(merged.id, 'constructor');
  assert.equal(merged.order, 1);
  assert.equal(merged.createdAt, 9);
  assert.equal(state.playlists.real.name, 'R');
});

test('import deduplicates ids that normalize to the same value and keeps orders contiguous', () => {
  // Regression: "a" and " a " both normalized to "a"; the later entry
  // overwrote the first and left gaps in the 0..n-1 order sequence.
  const state = createState();
  core.applyImportDataMutation(state, {
    playlists: {
      a: { name: 'First', color: '#111111', order: 0 },
      ' a ': { name: 'Second', color: '#222222', order: 1 },
      b: { name: 'Third', color: '#333333', order: 2 }
    },
    channels: {},
    channelPlaylists: {},
    mode: 'replace'
  }, { now: () => 0 });

  const playlists = Object.values(state.playlists);
  assert.deepEqual(playlists.map(p => p.name), ['First', 'Third']);
  assert.deepEqual(playlists.map(p => p.order), [0, 1]);
});

test('merge can attach an imported subgroup to a parent that only exists in storage', () => {
  // Regression: normalize sanitized the imported parent link against the
  // imported subset alone, so a partial merge file lost its parent link
  // even though the parent existed in current state.
  const state = createState({
    playlists: { root: { id: 'root', name: 'Root', color: '#111111', parentId: null, order: 0, createdAt: 5, updatedAt: 5 } }
  });

  core.applyImportDataMutation(state, {
    playlists: { child: { name: 'Child', color: '#222222', order: 0, parentId: 'root' } },
    channels: {},
    channelPlaylists: {},
    mode: 'merge'
  }, { now: () => 9 });

  assert.equal(state.playlists.child.parentId, 'root');
});

test('merge does not let a missing imported channel name clobber a stored name', () => {
  // Regression: normalization substituted the handle for a missing name, so
  // merging a degraded file replaced a good display name with the handle.
  const state = createState({
    playlists: { p: { id: 'p', name: 'P', color: '#111111', parentId: null, order: 0, createdAt: 5, updatedAt: 5 } },
    channels: { '@Creator': { handle: '@Creator', channelId: '', name: 'Real Name', updatedAt: 5 } }
  });

  core.applyImportDataMutation(state, {
    playlists: { p: { name: 'P', color: '#111111', order: 0 } },
    channels: { '@Creator': { name: 42 } },
    channelPlaylists: {},
    mode: 'merge'
  }, { now: () => 9 });

  assert.equal(state.channels['@Creator'].name, 'Real Name');

  // Replace still falls back to the handle when the file has no usable name.
  const replaceState = createState();
  core.applyImportDataMutation(replaceState, {
    playlists: { p: { name: 'P', color: '#111111', order: 0 } },
    channels: { '@Creator': { name: 42 } },
    channelPlaylists: {},
    mode: 'replace'
  }, { now: () => 9 });
  assert.equal(replaceState.channels['@Creator'].name, '@Creator');
});
