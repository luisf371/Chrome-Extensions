'use strict';

// Layer-by-layer verification of the export/import data path (the pure
// logic; the live browser round trip is verified separately). Each helper
// mirrors one production layer so the payload shapes stay honest:
//   options.js exportPlaylists()  -> file shape
//   options.js importPlaylists()  -> pre-validation + message payload
//   background.js importData()    -> applyImportDataMutation
//   shared-core normalizeImportedData() -> storage shape
// Then asserts the stored invariants the options page tree relies on.

const test = require('node:test');
const assert = require('node:assert');
const core = require('../shared-core.js');

const deps = { now: () => 12345, randomUUID: () => 'aaaaaaaa-1111-2222-3333-444444444444' };

// --- helpers mirroring the real layers ---

// background.js getAllData() shape
function storedState(playlists, channels, channelPlaylists) {
  return {
    playlists: playlists || {},
    channels: channels || {},
    channelPlaylists: channelPlaylists || {},
    settings: { ...core.DEFAULT_SETTINGS }
  };
}

// options.js exportPlaylists() — the exact file shape written to disk
function exportFile(state) {
  return {
    playlists: state.playlists || {},
    channels: state.channels || {},
    channelPlaylists: state.channelPlaylists || {},
    exportedAt: '2026-08-21T00:00:00.000Z'
  };
}

// options.js importPlaylists() pre-validation: reject only when playlists is
// missing or not an `object` (matches the typeof check in options.js). Note
// an ARRAY passes this layer (typeof [] === 'object'); shared-core is the
// real guard and rejects it — verified further down.
function optionsPreValidate(imported) {
  return Boolean(imported.playlists) && typeof imported.playlists === 'object';
}

// background.js IMPORT_DATA handler (message shape from options.js:1081-1087)
function importViaBackground(state, file, mode) {
  return core.applyImportDataMutation(state, {
    playlists: file.playlists,
    channels: file.channels || {},
    channelPlaylists: file.channelPlaylists || {},
    mode
  }, deps);
}

// The invariants the options-page tree + every consumer relies on
// (getPlaylistTree, filter roll-ups, quick-add). All existence checks are
// own-property so inherited names ("constructor") cannot pass silently.
function assertSubgroupInvariants(state, label) {
  const playlists = Object.values(state.playlists);
  const seenOrders = new Set();
  for (const pl of playlists) {
    assert.ok(typeof pl.id === 'string' && pl.id, `${label}: id`);
    assert.ok(/^[A-Za-z0-9._-]+$/.test(pl.id), `${label}: id charset (${pl.id})`);
    assert.ok(pl.name && pl.name.trim(), `${label}: name`);
    assert.ok(/^#[0-9A-Fa-f]{6}$/.test(pl.color), `${label}: color (${pl.color})`);
    assert.ok(Number.isInteger(pl.order), `${label}: integer order (${pl.order})`);
    assert.ok(!seenOrders.has(pl.order), `${label}: duplicate order ${pl.order}`);
    seenOrders.add(pl.order);
    if (pl.parentId !== null) {
      assert.ok(Object.hasOwn(state.playlists, pl.parentId), `${label}: parent ${pl.parentId} is an own record`);
      const parent = state.playlists[pl.parentId];
      assert.equal(parent.parentId, null, `${label}: parent ${pl.parentId} is top-level (max 1 level)`);
      assert.notEqual(parent.id, pl.id, `${label}: not self-parented`);
    }
  }
  for (const [handle, ids] of Object.entries(state.channelPlaylists || {})) {
    assert.ok(core.normalizeStoredHandle(handle), `${label}: channel handle ${handle}`);
    for (const id of ids) {
      assert.ok(Object.hasOwn(state.playlists, id), `${label}: assignment ${handle}->${id} resolves to an own record`);
    }
  }
  // Every playlist renders: top-level or under an existing top-level parent.
  const tops = playlists.filter(pl => !pl.parentId);
  assert.ok(tops.length > 0, `${label}: at least one top-level playlist`);
}

// A realistic current state: two top-level groups, one with two subgroups,
// channels assigned across parents, children, and both.
function realisticState() {
  return storedState(
    {
      pl_music: { id: 'pl_music', name: 'Music', color: '#ff0000', parentId: null, order: 0, createdAt: 1, updatedAt: 1 },
      pl_rock: { id: 'pl_rock', name: 'Rock', color: '#00ff00', parentId: 'pl_music', order: 1, createdAt: 2, updatedAt: 2 },
      pl_jazz: { id: 'pl_jazz', name: 'Jazz', color: '#0000ff', parentId: 'pl_music', order: 2, createdAt: 3, updatedAt: 3 },
      pl_tech: { id: 'pl_tech', name: 'Tech', color: '#4a9eff', parentId: null, order: 3, createdAt: 4, updatedAt: 4 }
    },
    {
      '@queen': { handle: '@queen', channelId: 'UCqueen', name: 'Queen', updatedAt: 1 },
      '@collier': { handle: '@collier', channelId: 'UCcollier', name: 'Jacob Collier', updatedAt: 2 },
      '@veritasium': { handle: '@veritasium', channelId: 'UCveri', name: 'Veritasium', updatedAt: 3 }
    },
    {
      '@queen': ['pl_rock'],
      '@collier': ['pl_music', 'pl_jazz'],
      '@veritasium': ['pl_tech']
    }
  );
}

// --- 1. identity round trip (replace) preserves subgroups exactly ---

test('export -> import(replace) preserves subgroups, assignments and order', () => {
  const state = realisticState();
  const file = exportFile(state); // JSON.stringify/parse is shape-preserving; simulate it
  const onDisk = JSON.parse(JSON.stringify(file));

  assert.ok(optionsPreValidate(onDisk), 'options.js pre-validation passes');
  assert.equal(optionsPreValidate({ playlists: null }), false, 'options.js rejects a file with no playlists key');
  const restored = storedState();
  const result = importViaBackground(restored, onDisk, 'replace');
  assert.equal(result.success, true);

  assert.equal(Object.keys(restored.playlists).length, 4);
  // exact parent links survive
  assert.equal(restored.playlists.pl_rock.parentId, 'pl_music');
  assert.equal(restored.playlists.pl_jazz.parentId, 'pl_music');
  assert.equal(restored.playlists.pl_tech.parentId, null);
  assert.equal(restored.playlists.pl_music.parentId, null);
  // relative order is preserved exactly (export order 0..3 -> import 0..3)
  assert.deepEqual(
    ['pl_music', 'pl_rock', 'pl_jazz', 'pl_tech'].map(id => restored.playlists[id].order),
    [0, 1, 2, 3]
  );
  // assignments survive verbatim
  assert.deepEqual(restored.channelPlaylists['@queen'], ['pl_rock']);
  assert.deepEqual(restored.channelPlaylists['@collier'], ['pl_music', 'pl_jazz']);
  assert.deepEqual(restored.channelPlaylists['@veritasium'], ['pl_tech']);
  assert.equal(restored.channels['@queen'].channelId, 'UCqueen');
  assertSubgroupInvariants(restored, 'replace round trip');
});

// --- 2. merge round trip onto unrelated existing state ---

test('export -> import(merge) adds subgroups without disturbing existing ones', () => {
  const existing = realisticState();
  const otherFile = {
    playlists: {
      pl_cook: { id: 'pl_cook', name: 'Cooking', color: '#123456', parentId: null, order: 0, createdAt: 9, updatedAt: 9 },
      pl_bake: { id: 'pl_bake', name: 'Baking', color: '#654321', parentId: 'pl_cook', order: 1, createdAt: 9, updatedAt: 9 }
    },
    channels: { '@chef': { handle: '@chef', channelId: '', name: 'Chef', updatedAt: 9 } },
    channelPlaylists: { '@chef': ['pl_bake'] }
  };

  const before = JSON.parse(JSON.stringify(existing.playlists.pl_rock)); // existing subgroup untouched
  const result = importViaBackground(existing, otherFile, 'merge');
  assert.equal(result.success, true);

  assert.equal(existing.playlists.pl_bake.parentId, 'pl_cook', 'imported subgroup link preserved');
  assert.equal(existing.playlists.pl_rock.parentId, before.parentId, 'existing subgroup untouched');
  assert.deepEqual(existing.channelPlaylists['@chef'], ['pl_bake']);
  assertSubgroupInvariants(existing, 'merge');
});

// --- 3. merge conflict: imported record wins for known ids (documented semantics) ---

test('import(merge) overwrite of an existing id keeps hierarchy valid', () => {
  const state = realisticState();
  // Older export where pl_rock was top-level and pl_tech was under pl_cook
  const olderFile = {
    playlists: {
      pl_music: { id: 'pl_music', name: 'Music', color: '#ff0000', parentId: null, order: 0 },
      pl_rock: { id: 'pl_rock', name: 'Rock', color: '#00ff00', parentId: null, order: 1 },
      pl_tech: { id: 'pl_tech', name: 'Tech', color: '#4a9eff', parentId: 'pl_cook', order: 2 },
      pl_cook: { id: 'pl_cook', name: 'Cooking', color: '#123456', parentId: null, order: 3 }
    },
    channels: {},
    channelPlaylists: {}
  };

  importViaBackground(state, olderFile, 'merge');
  // imported pl_rock.parentId null wins (documented merge semantics: import wins)
  assert.equal(state.playlists.pl_rock.parentId, null);
  // pl_tech claimed a parent that exists -> valid subgroup now
  assert.equal(state.playlists.pl_tech.parentId, 'pl_cook');
  assert.equal(state.playlists.pl_jazz.parentId, 'pl_music', 'untouched subgroup survives');
  assertSubgroupInvariants(state, 'merge conflict');
});

// --- 4. hostile/malformed files: never throw uncaught, never store garbage ---

test('malformed parent structures are repaired, never stored', () => {
  const file = {
    playlists: {
      ok1: { name: 'One', color: '#111111', order: 0, parentId: null },
      selfy: { name: 'Self', color: '#222222', order: 1, parentId: 'selfy' },
      orphan: { name: 'Orphan', color: '#333333', order: 2, parentId: 'gone' },
      lvl2: { name: 'Level2', color: '#444444', order: 3, parentId: 'childof1' },
      childof1: { name: 'Child', color: '#555555', order: 4, parentId: 'ok1' },
      cycA: { name: 'A', color: '#666666', order: 5, parentId: 'cycB' },
      cycB: { name: 'B', color: '#777777', order: 6, parentId: 'cycA' },
      // unsafe id chars -> whole entry dropped; child referencing it must be repaired
      'bad id!': { name: 'Bad', color: '#888888', order: 7, parentId: null },
      refsBad: { name: 'RefsBad', color: '#999999', order: 8, parentId: 'bad id!' }
    },
    channels: { '@x': { handle: '@x', channelId: '', name: 'X' } },
    channelPlaylists: { '@x': ['ok1', 'bad id!', 'gone'] }
  };

  const state = storedState();
  importViaBackground(state, file, 'replace');

  assert.equal(state.playlists['bad id!'], undefined, 'unsafe id dropped');
  assert.equal(state.playlists.refsBad.parentId, null, 'child of dropped playlist repaired');
  assert.equal(state.playlists.selfy.parentId, null, 'self-parent repaired');
  assert.equal(state.playlists.orphan.parentId, null, 'orphan repaired');
  assert.equal(state.playlists.lvl2.parentId, null, '2-level-deep promoted');
  assert.equal(state.playlists.childof1.parentId, 'ok1', 'valid subgroup kept');
  assert.equal(state.playlists.cycA.parentId, null, 'cycle member A repaired');
  assert.equal(state.playlists.cycB.parentId, null, 'cycle member B repaired');
  assert.deepEqual(state.channelPlaylists['@x'], ['ok1'], 'assignments filtered to surviving playlists');
  assertSubgroupInvariants(state, 'malformed');
});

test('empty and non-object playlists are rejected, and a failed import leaves state untouched', () => {
  assert.throws(() => importViaBackground(storedState(), { playlists: {} }, 'replace'),
    /no valid playlists found/);
  // An array passes options.js typeof check (documented layering gap) but
  // must be rejected by shared-core before anything is stored.
  assert.equal(optionsPreValidate({ playlists: [] }), true, 'options.js layer passes arrays through');
  assert.throws(() => importViaBackground(storedState(), { playlists: [] }, 'replace'),
    /playlists must be an object/);
  assert.throws(() => importViaBackground(storedState(), { playlists: { a: { name: 'A' } } }, 'bogus'),
    /Invalid import mode/);
  // A rejected import must not partially mutate the caller's state.
  const state = realisticState();
  const before = JSON.stringify({ p: state.playlists, c: state.channels, a: state.channelPlaylists });
  assert.throws(() => importViaBackground(state, { playlists: {} }, 'replace'), /no valid playlists found/);
  assert.equal(JSON.stringify({ p: state.playlists, c: state.channels, a: state.channelPlaylists }), before,
    'state untouched after rejected import');
});

// --- 5. name/order edge cases from real exports ---

test('names are trimmed/clamped, order gaps compacted, unicode names survive', () => {
  const file = {
    playlists: {
      pl_a: { id: 'pl_a', name: '  Спорт & <b>bold</b> ', color: '#abcdef', order: 7, parentId: null },
      pl_b: { id: 'pl_b', name: 'B'.repeat(99), color: 'notacolor', order: 3, parentId: 'pl_a' },
      pl_c: { id: 'pl_c', name: 'C', color: '#4a9eff', order: NaN, parentId: null }
    },
    channels: {},
    channelPlaylists: {}
  };
  const state = storedState();
  importViaBackground(state, file, 'replace');

  assert.equal(state.playlists.pl_a.name, 'Спорт & <b>bold</b>');
  assert.equal(state.playlists.pl_b.name.length, 50, 'name clamped to 50');
  assert.equal(state.playlists.pl_b.color, '#4a9eff', 'invalid color -> default');
  assert.equal(state.playlists.pl_b.parentId, 'pl_a', 'subgroup survives name clamp');
  // order re-indexed by the file's order: pl_b(3) then pl_a(7); pl_c (no order) last
  assert.equal(state.playlists.pl_b.order, 0);
  assert.equal(state.playlists.pl_a.order, 1);
  assert.equal(state.playlists.pl_c.order, 2);
  assertSubgroupInvariants(state, 'names');
});

// --- 6. deleted-parent partial file: assignments to dropped parents vanish ---

test('replace import onto a damaged state fully restores parents and assignments', () => {
  const damaged = realisticState();
  delete damaged.playlists.pl_music; // e.g. a bad partial write earlier
  const file = exportFile(realisticState());
  importViaBackground(damaged, file, 'replace');
  assert.equal(damaged.playlists.pl_music.name, 'Music', 'parent restored from file');
  assert.equal(damaged.playlists.pl_rock.parentId, 'pl_music', 'subgroup link restored');
  assert.deepEqual(damaged.channelPlaylists['@collier'], ['pl_music', 'pl_jazz']);
  assertSubgroupInvariants(damaged, 'restore damaged');
});
