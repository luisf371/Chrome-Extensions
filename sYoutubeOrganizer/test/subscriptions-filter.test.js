'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function loadFilterActions() {
  const makeButton = (dataset = {}) => {
    const listeners = new Map();
    return {
      dataset,
      addEventListener(type, listener) {
        listeners.set(type, listener);
      },
      dispatch(type, event = {}) {
        return listeners.get(type)?.(event);
      }
    };
  };
  const makeCard = (handle) => ({
    style: { display: '' },
    querySelector(selector) {
      return selector === 'a[href*="/@"]'
        ? { getAttribute: () => `/@${handle.slice(1)}` }
        : null;
    }
  });
  const cards = {
    parent: makeCard('@parent'),
    a1: makeCard('@a1'),
    a2: makeCard('@a2'),
    loose: makeCard('@loose')
  };
  const uncategorizedButton = makeButton({ playlist: '__uncategorized' });
  const directButton = makeButton({ popPlaylist: 'a', popParent: 'a' });
  const filterShadow = {
    innerHTML: '',
    querySelectorAll(selector) {
      if (selector === '[data-action="uncategorized"]') return [uncategorizedButton];
      if (selector === '[data-playlist]' && this.innerHTML.includes('data-playlist="__uncategorized"')) {
        return [uncategorizedButton];
      }
      if (selector === '[data-pop-playlist]' && this.innerHTML.includes('data-pop-playlist="a"')) {
        return [directButton];
      }
      return [];
    },
    querySelector: () => null,
    getElementById: () => null
  };
  const grid = {
    querySelectorAll: () => Object.values(cards)
  };
  const browse = {
    querySelector: () => grid
  };
  const state = {
    data: {
      playlists: {
        a: { id: 'a', name: 'A', color: '#111', order: 0 },
        b: { id: 'b', name: 'B', color: '#222', order: 1 },
        c: { id: 'c', name: 'C', color: '#333', order: 2 },
        a1: { id: 'a1', name: 'A1', color: '#444', order: 3, parentId: 'a' },
        a2: { id: 'a2', name: 'A2', color: '#555', order: 4, parentId: 'a' }
      }
    },
    subscriptionsFilterMode: 'all',
    subscriptionsIncludeGroups: new Map(),
    subduedPlaylistIds: new Set(),
    subduedDirectPlaylistIds: new Set(),
    playlistChannels: new Map([
      ['a', new Set(['@parent', '@a1', '@a2'])],
      ['a1', new Set(['@a1'])],
      ['a2', new Set(['@a2'])]
    ]),
    playlistChannelsRollup: new Map([
      ['a', new Set(['@parent', '@a1', '@a2'])],
      ['a1', new Set(['@a1'])],
      ['a2', new Set(['@a2'])]
    ]),
    allAssignedHandles: new Set(['@parent', '@a1', '@a2']),
    filterShadow,
    filterPopupPlaylistId: null,
    filterMenuOpen: false,
    filterPopupCloseState: {},
    filterMenuCloseState: {}
  };
  const app = {
    constants: {
      UNCATEGORIZED_ID: '__uncategorized',
      FILTER_MODE_ALL: 'all',
      FILTER_MODE_INCLUDE: 'include',
      FILTER_MODE_EXCLUDE: 'exclude',
      FILTER_MODE_UNCATEGORIZED: 'uncategorized'
    },
    state,
    api: {
      armDocumentCloseListener: () => {},
      clearDocumentCloseListener: () => {},
      escapeHtml: (value) => String(value),
      isVisibleElement: () => true
    },
    pages: {}
  };
  const context = {
    console,
    document: {
      documentElement: { hasAttribute: () => false },
      querySelectorAll: () => [browse]
    },
    __SYP_CONTENT__: app
  };
  context.globalThis = context;

  const filename = path.join(__dirname, '..', 'content', 'pages', 'subscriptions.js');
  const source = fs.readFileSync(filename, 'utf8').replace(
    '  pages.subscriptions = {',
    '  app.__filterTest = { applyFilter, applySubscriptionsFilterPreference, checkedSubgroupIdsOf, getCurrentSubscriptionsPreference, normalizeSubscriptionsFilterPreference, renderFilterBar, setIncludeSubscriptionsFilter, setWholeGroupInclude, toggleIncludedSubgroup, toggleSubscriptionsGroup };\n\n  pages.subscriptions = {'
  );
  vm.runInNewContext(source, context, { filename });
  return { cards, directButton, state, uncategorizedButton, ...app.__filterTest };
}

test('All and saved groups seed toggles while modifier selection is exclusive', () => {
  const actions = loadFilterActions();

  actions.toggleSubscriptionsGroup('a');
  assert.equal(actions.state.subscriptionsFilterMode, 'exclude');
  assert.deepEqual(Array.from(actions.state.subduedPlaylistIds), ['a']);

  actions.toggleSubscriptionsGroup('b');
  assert.deepEqual(Array.from(actions.state.subduedPlaylistIds), ['a', 'b']);

  actions.toggleSubscriptionsGroup('a');
  assert.deepEqual(Array.from(actions.state.subduedPlaylistIds), ['b']);

  actions.toggleSubscriptionsGroup('b');
  assert.equal(actions.state.subscriptionsFilterMode, 'all');

  actions.applySubscriptionsFilterPreference({
    mode: 'include',
    includeGroups: [{ activePlaylistId: 'a' }, { activePlaylistId: 'b' }]
  });
  actions.toggleSubscriptionsGroup('a');
  assert.deepEqual(Array.from(actions.state.subscriptionsIncludeGroups.keys()), ['b']);

  actions.toggleSubscriptionsGroup('c');
  assert.deepEqual(Array.from(actions.state.subscriptionsIncludeGroups.keys()), ['b', 'c']);

  actions.setIncludeSubscriptionsFilter('a');
  assert.deepEqual(Array.from(actions.state.subscriptionsIncludeGroups.keys()), ['a']);
  assert.equal(actions.state.subscriptionsIncludeGroups.get('a'), null);

  actions.toggleSubscriptionsGroup('a');
  assert.equal(actions.state.subscriptionsFilterMode, 'include');
  assert.equal(actions.state.subscriptionsIncludeGroups.size, 0);
  const emptyPreference = actions.getCurrentSubscriptionsPreference();
  assert.equal(emptyPreference.includeGroups.length, 0);
  const normalizedEmptyPreference = actions.normalizeSubscriptionsFilterPreference(emptyPreference);
  assert.equal(normalizedEmptyPreference.includeGroups.length, 0);
  actions.applySubscriptionsFilterPreference(normalizedEmptyPreference);
  assert.equal(actions.state.subscriptionsFilterMode, 'include');
  assert.equal(actions.state.subscriptionsIncludeGroups.size, 0);
});

test('subgroup caret mirrors and controls its parent selection', () => {
  const actions = loadFilterActions();

  assert.deepEqual(Array.from(actions.checkedSubgroupIdsOf('a')), ['a1', 'a2']);

  actions.toggleIncludedSubgroup('a', 'a1');
  assert.equal(actions.state.subscriptionsFilterMode, 'exclude');
  assert.deepEqual(Array.from(actions.state.subduedPlaylistIds), ['a1']);
  assert.deepEqual(Array.from(actions.checkedSubgroupIdsOf('a')), ['a2']);

  actions.toggleSubscriptionsGroup('a');
  assert.deepEqual(Array.from(actions.state.subduedPlaylistIds), ['a']);
  assert.deepEqual(Array.from(actions.checkedSubgroupIdsOf('a')), []);

  actions.toggleSubscriptionsGroup('a');
  assert.equal(actions.state.subscriptionsFilterMode, 'all');
  assert.deepEqual(Array.from(actions.checkedSubgroupIdsOf('a')), ['a1', 'a2']);

  actions.toggleSubscriptionsGroup('a');
  actions.toggleIncludedSubgroup('a', 'a1');
  assert.deepEqual(Array.from(actions.state.subduedPlaylistIds), ['a2']);
  assert.deepEqual(Array.from(actions.checkedSubgroupIdsOf('a')), ['a1']);

  actions.setWholeGroupInclude('a');
  assert.equal(actions.state.subscriptionsFilterMode, 'all');
  assert.deepEqual(Array.from(actions.checkedSubgroupIdsOf('a')), ['a1', 'a2']);

  actions.setIncludeSubscriptionsFilter('b');
  actions.toggleIncludedSubgroup('a', 'a1');
  assert.deepEqual(Array.from(actions.state.subscriptionsIncludeGroups.keys()), ['b', 'a']);
  assert.deepEqual(Array.from(actions.checkedSubgroupIdsOf('a')), ['a1']);

  actions.toggleIncludedSubgroup('a', 'a2');
  assert.deepEqual(Array.from(actions.state.subscriptionsIncludeGroups.get('a')), ['a1', 'a2']);
  assert.deepEqual(Array.from(actions.checkedSubgroupIdsOf('a')), ['a1', 'a2']);
});

test('caret subset filters only checked subgroup channels', () => {
  const actions = loadFilterActions();

  actions.applySubscriptionsFilterPreference({
    mode: 'include',
    includeGroups: [{ activePlaylistId: 'a', includedPlaylistIds: ['a1'] }]
  });
  actions.applyFilter();
  assert.equal(actions.cards.parent.style.display, 'none');
  assert.equal(actions.cards.a1.style.display, '');
  assert.equal(actions.cards.a2.style.display, 'none');

  actions.applySubscriptionsFilterPreference({
    mode: 'include',
    includeGroups: [{ activePlaylistId: 'a', includedPlaylistIds: ['a1', 'a2'] }]
  });
  actions.applyFilter();
  assert.deepEqual(Array.from(actions.state.subscriptionsIncludeGroups.get('a')), ['a1', 'a2']);
  assert.equal(actions.cards.parent.style.display, 'none');
  assert.equal(actions.cards.a1.style.display, '');
  assert.equal(actions.cards.a2.style.display, '');

  const savedSubset = actions.getCurrentSubscriptionsPreference();
  assert.deepEqual(Array.from(savedSubset.includeGroups[0].includedPlaylistIds), ['a1', 'a2']);
  const restoredSubset = actions.normalizeSubscriptionsFilterPreference(savedSubset);
  actions.applySubscriptionsFilterPreference(restoredSubset);
  assert.deepEqual(Array.from(actions.state.subscriptionsIncludeGroups.get('a')), ['a1', 'a2']);

  actions.setWholeGroupInclude('a');
  assert.equal(actions.state.subscriptionsIncludeGroups.get('a'), null);
  actions.applyFilter();
  assert.equal(actions.cards.parent.style.display, '');
  assert.equal(actions.cards.a1.style.display, '');
  assert.equal(actions.cards.a2.style.display, '');
});

test('Uncategorized composes with groups and modifier clicks make it exclusive', () => {
  const actions = loadFilterActions();

  actions.renderFilterBar();
  actions.uncategorizedButton.dispatch('click');
  assert.equal(actions.state.subscriptionsFilterMode, 'exclude');
  assert.deepEqual(Array.from(actions.state.subduedPlaylistIds), ['__uncategorized']);
  assert.equal(actions.cards.parent.style.display, '');
  assert.equal(actions.cards.loose.style.display, 'none');

  actions.uncategorizedButton.dispatch('click');
  assert.equal(actions.state.subscriptionsFilterMode, 'all');
  assert.equal(actions.cards.loose.style.display, '');

  actions.applySubscriptionsFilterPreference({
    mode: 'include',
    includeGroups: [{ activePlaylistId: 'b' }]
  });
  actions.renderFilterBar();
  actions.uncategorizedButton.dispatch('click');
  assert.deepEqual(Array.from(actions.state.subscriptionsIncludeGroups.keys()), ['b', '__uncategorized']);
  assert.equal(actions.cards.parent.style.display, 'none');
  assert.equal(actions.cards.loose.style.display, '');

  const savedMixed = actions.normalizeSubscriptionsFilterPreference(actions.getCurrentSubscriptionsPreference());
  actions.applySubscriptionsFilterPreference(savedMixed);
  assert.deepEqual(Array.from(actions.state.subscriptionsIncludeGroups.keys()), ['b', '__uncategorized']);

  actions.uncategorizedButton.dispatch('click', { ctrlKey: true });
  assert.deepEqual(Array.from(actions.state.subscriptionsIncludeGroups.keys()), ['__uncategorized']);
  assert.equal(actions.cards.parent.style.display, 'none');
  assert.equal(actions.cards.loose.style.display, '');

  actions.applySubscriptionsFilterPreference({
    mode: 'include',
    includeGroups: [{ activePlaylistId: 'b' }]
  });
  actions.renderFilterBar();
  actions.uncategorizedButton.dispatch('click', { metaKey: true });
  assert.deepEqual(Array.from(actions.state.subscriptionsIncludeGroups.keys()), ['__uncategorized']);

  const legacy = actions.normalizeSubscriptionsFilterPreference({ mode: 'uncategorized' });
  assert.equal(legacy.mode, 'include');
  assert.deepEqual(Array.from(legacy.includeGroups, ({ activePlaylistId }) => activePlaylistId), ['__uncategorized']);
  actions.applySubscriptionsFilterPreference(legacy);
  assert.deepEqual(Array.from(actions.state.subscriptionsIncludeGroups.keys()), ['__uncategorized']);
});

test('direct parent assignments are independently filterable and persist', () => {
  const actions = loadFilterActions();

  actions.applySubscriptionsFilterPreference({
    mode: 'include',
    includeGroups: [{ activePlaylistId: 'a', includedPlaylistIds: ['a', 'a1'] }]
  });
  actions.applyFilter();
  assert.deepEqual(Array.from(actions.state.subscriptionsIncludeGroups.get('a')), ['a', 'a1']);
  assert.equal(actions.cards.parent.style.display, '');
  assert.equal(actions.cards.a1.style.display, '');
  assert.equal(actions.cards.a2.style.display, 'none');

  const savedInclude = actions.getCurrentSubscriptionsPreference();
  const restoredInclude = actions.normalizeSubscriptionsFilterPreference(savedInclude);
  actions.applySubscriptionsFilterPreference(restoredInclude);
  assert.deepEqual(Array.from(actions.state.subscriptionsIncludeGroups.get('a')), ['a', 'a1']);

  actions.applySubscriptionsFilterPreference(actions.normalizeSubscriptionsFilterPreference({
    mode: 'exclude',
    excludedPlaylistIds: ['a2'],
    excludedDirectPlaylistIds: ['a']
  }));
  actions.applyFilter();
  assert.equal(actions.cards.parent.style.display, 'none');
  assert.equal(actions.cards.a1.style.display, '');
  assert.equal(actions.cards.a2.style.display, 'none');
  assert.deepEqual(Array.from(actions.getCurrentSubscriptionsPreference().excludedDirectPlaylistIds), ['a']);

  actions.applySubscriptionsFilterPreference(null);
  actions.toggleSubscriptionsGroup('a');
  actions.toggleIncludedSubgroup('a', 'a1');
  assert.deepEqual(Array.from(actions.state.subduedPlaylistIds), ['a2']);
  assert.deepEqual(Array.from(actions.state.subduedDirectPlaylistIds), ['a']);
  actions.applyFilter();
  assert.equal(actions.cards.parent.style.display, 'none');
  assert.equal(actions.cards.a1.style.display, '');
  assert.equal(actions.cards.a2.style.display, 'none');

  actions.applySubscriptionsFilterPreference(null);
  actions.state.filterPopupPlaylistId = 'a';
  actions.renderFilterBar();
  assert.match(actions.state.filterShadow.innerHTML, /data-pop-playlist="a"\s+data-pop-parent="a"/);
  actions.directButton.dispatch('click');
  assert.deepEqual(Array.from(actions.state.subduedDirectPlaylistIds), ['a']);
  assert.equal(actions.cards.parent.style.display, 'none');
  assert.equal(actions.cards.a1.style.display, '');
  assert.equal(actions.cards.a2.style.display, '');

  actions.applySubscriptionsFilterPreference(null);
  actions.state.filterPopupPlaylistId = 'a';
  actions.renderFilterBar();
  actions.directButton.dispatch('click', { metaKey: true });
  assert.equal(actions.state.subscriptionsFilterMode, 'include');
  assert.deepEqual(Array.from(actions.state.subscriptionsIncludeGroups.get('a')), ['a']);
  assert.equal(actions.cards.parent.style.display, '');
  assert.equal(actions.cards.a1.style.display, 'none');
  assert.equal(actions.cards.a2.style.display, 'none');
});
