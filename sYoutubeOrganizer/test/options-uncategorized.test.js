'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function loadOptions(document) {
  const context = {
    document: {
      addEventListener() {},
      createElement() {
        return {
          set textContent(value) { this.value = value; },
          get innerHTML() { return this.value; }
        };
      },
      ...document
    },
    chrome: { storage: { local: {}, onChanged: { addListener() {} } } }
  };
  context.globalThis = context;

  const filename = path.join(__dirname, '..', 'options.js');
  const source = fs.readFileSync(filename, 'utf8').replace(
    '// --- Init ---',
    `globalThis.__uncategorizedTest = {
      attachPlaylistListEvents,
      attachReorderListeners,
      getChannelsForPlaylist,
      getSelected: () => selectedPlaylistId,
      renderPlaylistList,
      setData: value => { data = value; },
      setOpenSubmenu: value => { openSubmenuHandle = value; },
      setRender: value => { render = value; },
      setSelected: value => { selectedPlaylistId = value; },
      uncategorizedAssignmentMenuHTML,
      UNCATEGORIZED_ID
    };\n\n// --- Init ---`
  );
  vm.runInNewContext(source, context, { filename });
  return context.__uncategorizedTest;
}

function makeList() {
  return {
    innerHTML: '',
    querySelector() { return null; },
    querySelectorAll() { return []; }
  };
}

test('Uncategorized is derived, selectable, actionless, and always last', () => {
  const list = makeList();
  const options = loadOptions({ getElementById: () => list });
  const fixture = {
    playlists: {
      parent: { id: 'parent', name: 'Parent', color: '#123456', order: 0 },
      child: { id: 'child', name: 'Child', color: '#654321', order: 1, parentId: 'parent' }
    },
    channels: {
      '@assigned': { handle: '@assigned', name: 'Assigned', subscribed: false },
      '@empty': { handle: '@empty', name: 'Alpha', subscribed: true },
      '@missing': { handle: '@missing', name: 'Zulu', subscribed: true },
      '@unsubscribed': { handle: '@unsubscribed', name: 'Not subscribed', subscribed: false },
      '@unknown': { handle: '@unknown', name: 'Unknown status' }
    },
    channelPlaylists: {
      '@assigned': ['parent'],
      '@empty': []
    }
  };
  options.setData(fixture);

  assert.deepEqual(
    Array.from(options.getChannelsForPlaylist(options.UNCATEGORIZED_ID), channel => channel.handle),
    ['@empty', '@missing']
  );

  options.renderPlaylistList();
  const virtualStart = list.innerHTML.indexOf('data-virtual="uncategorized"');
  const virtualRow = list.innerHTML.slice(virtualStart, list.innerHTML.indexOf('</div>', virtualStart));
  assert.ok(virtualStart > list.innerHTML.lastIndexOf('data-id='));
  assert.match(virtualRow, /Uncategorized/);
  assert.match(virtualRow, /Built in/);
  assert.match(virtualRow, /item-count">2</);
  assert.doesNotMatch(virtualRow, /item-actions|<button|draggable/);

  options.setSelected(options.UNCATEGORIZED_ID);
  options.renderPlaylistList();
  assert.match(list.innerHTML, /uncategorized-item active/);

  options.setData({ playlists: {}, channels: fixture.channels, channelPlaylists: fixture.channelPlaylists });
  options.renderPlaylistList();
  assert.match(list.innerHTML, /data-virtual="uncategorized"/);
  assert.doesNotMatch(list.innerHTML, /data-id=/);

  options.setData(fixture);
  options.setOpenSubmenu('@empty');
  const picker = options.uncategorizedAssignmentMenuHTML(fixture.channels['@empty']);
  assert.match(picker, /sub-assign-menu syp-dropdown/);
  assert.match(picker, /syp-dd-header/);
  assert.match(picker, /data-playlist="parent"/);
  assert.match(picker, /data-group-toggle="parent"/);
  assert.match(picker, /syp-dd-item syp-dd-item--sub[^>]*data-group-child="parent" hidden/);
  assert.match(picker, /data-playlist="child"/);
  assert.match(picker, /data-assignment-add/);
  assert.match(picker, /data-assignment-manage/);
});

test('Uncategorized receives selection but no drag listeners', () => {
  const listeners = {};
  const virtualRow = {
    dataset: { virtual: 'uncategorized' },
    addEventListener(type, listener) { listeners[type] = listener; }
  };
  const list = {
    querySelector() { return null; },
    querySelectorAll(selector) {
      return selector === '.list-item[data-id], .list-item[data-virtual]' ? [virtualRow] : [];
    }
  };
  const options = loadOptions({});
  options.setRender(() => {});
  options.attachPlaylistListEvents(list);
  options.attachReorderListeners(list);

  listeners.click({ target: { closest: () => null } });
  assert.equal(options.getSelected(), options.UNCATEGORIZED_ID);
  assert.deepEqual(Object.keys(listeners), ['click']);
});
