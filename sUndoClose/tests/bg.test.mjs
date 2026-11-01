// Run: node --test sUndoClose/tests/bg.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';

function area() {
    let db = {};
    const pick = (keys) => {
        if (keys === null || keys === undefined) return { ...db };
        const out = {};
        for (const k of [].concat(keys)) if (k in db) out[k] = structuredClone(db[k]);
        return out;
    };
    return {
        get db() { return db; },
        set db(v) { db = v; },
        get: async (keys) => pick(keys),
        set: async (items) => { Object.assign(db, structuredClone(items)); },
        remove: async (keys) => { for (const k of [].concat(keys)) delete db[k]; },
        clear: async () => { db = {}; }
    };
}

const listeners = {};
const on = (name) => ({ addListener: (fn) => { listeners[name] = fn; } });
const state = { tabs: [], windowsCreated: [], focused: [] };
const local = area(), sync = area(), session = area();

globalThis.chrome = {
    storage: { local, sync, session },
    runtime: { onStartup: on('startup'), onInstalled: on('installed') },
    tabs: {
        query: async () => state.tabs,
        create: async () => ({}),
        onUpdated: on('updated'), onRemoved: on('removed'), onReplaced: on('replaced')
    },
    windows: {
        create: async (opts) => { state.windowsCreated.push({ opts, closedKeys: Object.keys(local.db).filter(k => k.startsWith('ClosedTab-')) }); return { id: 99 }; },
        update: async (id, info) => { state.focused.push([id, info]); return {}; }
    },
    commands: { onCommand: on('command') },
    action: { setBadgeText() {}, setBadgeBackgroundColor() {}, setIcon() {} },
    history: { deleteUrl: async () => {} }
};

// Minimal exclusive Web Locks stand-in (Node has no navigator.locks).
const chains = {};
Object.defineProperty(globalThis.navigator, 'locks', {
    value: { request: (name, fn) => (chains[name] = (chains[name] || Promise.resolve()).then(() => fn({}))) }
});

const settings = { saveHistory: true, numLimit: 60, showBadge: false };
const { addNewTab, createTabsWindow } = await import('../common.js');
await import('../bg.js');

test('startup skips tabs that session restore reopened', async () => {
    sync.db = { settings };
    local.db = {
        TabListIndex: [1, 2, 3],
        'TabList-1': { url: 'https://reopened/', title: 'A' },
        'TabList-2': { url: 'https://closed/', title: 'B' },
        'TabList-3': { url: 'https://live/', title: 'C' },
        ClosedTabIndex: []
    };
    state.tabs = [{ id: 11, url: 'https://reopened/', title: 'A' }, { id: 3, url: 'https://live/', title: 'C' }];

    await listeners.startup();

    const closed = local.db.ClosedTabIndex.map(id => local.db['ClosedTab-' + id].url);
    assert.deepEqual(closed, ['https://closed/']);
    assert.equal(local.db['TabList-1'], undefined);
    assert.deepEqual(local.db['TabList-3'], { url: 'https://live/', title: 'C' });
    assert.ok(local.db.TabListIndex.includes(3) && local.db.TabListIndex.includes(11));
});

test('incognito tabs are never stored', async () => {
    local.db = { TabListIndex: [] };
    await addNewTab({ id: 50, url: 'https://secret/', title: 'S', incognito: true });
    assert.equal(local.db['TabList-50'], undefined);
    await addNewTab({ id: 51, url: 'https://public/', title: 'P', incognito: false });
    assert.deepEqual(local.db['TabList-51'], { url: 'https://public/', title: 'P' });
});

test('new window opens all selected tabs before removing their entries', async () => {
    sync.db = { settings };
    local.db = {
        ClosedTabIndex: ['a', 'b', 'c'],
        'ClosedTab-a': { url: 'https://a/', title: 'a', time: 1 },
        'ClosedTab-b': { url: 'https://b/', title: 'b', time: 2 },
        'ClosedTab-c': { url: 'https://c/', title: 'c', time: 3 }
    };
    state.windowsCreated = [];
    state.focused = [];

    await createTabsWindow(['c', 'a', 'missing']);

    assert.equal(state.windowsCreated.length, 1);
    const { opts, closedKeys } = state.windowsCreated[0];
    assert.deepEqual(opts, { url: ['https://c/', 'https://a/'], focused: false });
    assert.deepEqual(closedKeys.sort(), ['ClosedTab-a', 'ClosedTab-b', 'ClosedTab-c']);
    assert.deepEqual(local.db.ClosedTabIndex, ['b']);
    assert.equal(local.db['ClosedTab-a'], undefined);
    assert.deepEqual(state.focused, [[99, { focused: true }]]);
});
