'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function loadQuickAdd(pageWindow = { location: { href: 'https://www.youtube.com/@creator' } }) {
  const state = {
    data: {
      playlists: {
        profile: { id: 'profile', name: 'Profile', color: '#123456', order: 0 },
        subgroup: { id: 'subgroup', name: 'Subgroup', color: '#654321', order: 1, parentId: 'profile' }
      },
      channelPlaylists: { '@creator': ['profile'] }
    },
    quickAddExpandedGroups: new Set()
  };
  const app = { state, api: { escapeHtml: String } };
  const context = { __SYP_CONTENT__: app, window: pageWindow };
  context.globalThis = context;

  const filename = path.join(__dirname, '..', 'content', 'features', 'quick-add.js');
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), context, { filename });
  return app;
}

function loadSubscriptionHelpers() {
  const app = { state: {}, api: {} };
  const context = { __SYP_CONTENT__: app };
  context.globalThis = context;

  const filename = path.join(__dirname, '..', 'content', 'core', 'helpers.js');
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), context, { filename });
  return app.api;
}

test('grouped parents stay assignable and show their checked state while collapsed', () => {
  const { state, api } = loadQuickAdd();

  const collapsed = api.renderDropdownHTML('@creator');
  assert.match(collapsed, /data-playlist="profile" checked/);
  assert.equal((collapsed.match(/data-playlist="profile"/g) || []).length, 1);
  assert.match(collapsed, /<button type="button"[^>]*data-group-toggle="profile"[^>]*aria-expanded="false"/);
  assert.match(collapsed, /data-group-child="profile" hidden>[\s\S]*data-playlist="subgroup"/);
  assert.doesNotMatch(collapsed, /General Profile/);

  const styles = api.getDropdownStyles(false);
  assert.match(styles, /\.syp-dropdown\s*\{[\s\S]*?left: 0;[\s\S]*?transform-origin: top left;/);
  assert.doesNotMatch(styles, /\.syp-dropdown\s*\{[\s\S]*?right: 0;/);
  assert.match(styles, /\.syp-dd-group-row > \.syp-dd-item\s*\{[\s\S]*?flex: 0 1 auto;/);
  assert.match(styles, /\.syp-dd-item\[hidden\]\s*\{\s*display: none;\s*\}/);

  state.quickAddExpandedGroups.add('profile');
  const expanded = api.renderDropdownHTML('@creator');
  assert.equal((expanded.match(/data-playlist="profile"/g) || []).length, 1);
  assert.match(expanded, /data-group-child="profile">[\s\S]*data-playlist="subgroup"/);
  assert.match(expanded, /data-group-toggle="profile"[^>]*aria-expanded="true"/);
});

test('playlist badge counts top-level families, not subgroup assignments', () => {
  const { state, api } = loadQuickAdd();
  state.data.playlists.second = { id: 'second', name: 'Second', color: '#abcdef', order: 2 };

  state.data.channelPlaylists['@creator'] = ['profile', 'subgroup'];
  assert.equal(api.getTopLevelAssignmentCount('@creator'), 1);

  state.data.channelPlaylists['@creator'] = ['subgroup', 'second', 'missing'];
  assert.equal(api.getTopLevelAssignmentCount('@creator'), 2);
});

test('group disclosure updates the current popup in place', () => {
  const { state, api } = loadQuickAdd();
  const caretClasses = new Set();
  const caret = { classList: { toggle: (name, enabled) => enabled ? caretClasses.add(name) : caretClasses.delete(name) } };
  const attributes = new Map([['aria-label', 'Show subgroups for Profile']]);
  const child = { dataset: { groupChild: 'profile' }, hidden: true };
  let click;
  const toggle = {
    dataset: { groupToggle: 'profile' },
    addEventListener: (type, listener) => { if (type === 'click') click = listener; },
    getAttribute: (name) => attributes.get(name),
    setAttribute: (name, value) => attributes.set(name, value),
    querySelector: () => caret
  };
  const shadow = {
    querySelectorAll: (selector) => selector === '[data-group-toggle]' ? [toggle] : [child]
  };

  api.attachDropdownGroupToggles(shadow);
  const event = { preventDefault() {}, stopPropagation() {} };
  click(event);
  assert.equal(state.quickAddExpandedGroups.has('profile'), true);
  assert.equal(child.hidden, false);
  assert.equal(attributes.get('aria-expanded'), 'true');
  assert.equal(attributes.get('aria-label'), 'Hide subgroups for Profile');
  assert.equal(caretClasses.has('open'), true);

  click(event);
  assert.equal(state.quickAddExpandedGroups.has('profile'), false);
  assert.equal(child.hidden, true);
  assert.equal(attributes.get('aria-expanded'), 'false');
  assert.equal(attributes.get('aria-label'), 'Show subgroups for Profile');
  assert.equal(caretClasses.has('open'), false);
});

test('modern channel profile subscribed controls are not treated as unsubscribed', () => {
  const api = loadSubscriptionHelpers();
  const visible = {
    isConnected: true,
    hasAttribute: () => false,
    getClientRects: () => [{}],
    click: () => { clicks += 1; }
  };
  let clicks = 0;
  const scopeWith = (subscribedSelector, unsubscribedSelector = '#subscribe-button') => ({
    isConnected: true,
    matches: () => false,
    querySelectorAll: (selector) => {
      if (subscribedSelector && selector.includes(subscribedSelector)) return [visible];
      if (selector.includes(unsubscribedSelector)) return [visible];
      return [];
    }
  });

  const subscribedProfile = scopeWith('IconLeadingTrailing');
  const unsubscribedProfile = scopeWith(
    null,
    'yt-flexible-actions-view-model button[class*="Filled"]'
  );
  assert.equal(api.getSubscriptionState(subscribedProfile), 'subscribed');
  assert.equal(api.getSubscriptionState(scopeWith('icon-leading-trailing')), 'subscribed');
  assert.equal(api.getSubscriptionState(scopeWith('yt-notification-request-button-renderer')), 'subscribed');
  assert.equal(api.getSubscriptionState(scopeWith('yt-notification-request-button-view-model')), 'subscribed');
  assert.equal(api.getSubscriptionState(scopeWith('yt-subscription-notification-toggle-button-view-model')), 'subscribed');
  assert.equal(api.getSubscriptionState(unsubscribedProfile), 'unsubscribed');
  assert.equal(api.triggerSubscribeControl(unsubscribedProfile), true);
  assert.equal(api.triggerSubscribeControl(subscribedProfile), false);
  assert.equal(api.getSubscriptionState(scopeWith(null, 'yt-subscribe-button-view-model')), 'unknown');
  assert.equal(clicks, 1);
});

test('channel playlist button mounts while subscription state is unknown', async () => {
  const rendered = [];
  const children = [];
  const header = {
    querySelectorAll: () => [{ getAttribute: () => '/@deephack' }],
    querySelector: () => ({ textContent: 'deephack' })
  };
  const actions = {
    isConnected: true,
    children: [{}],
    hasAttribute: () => false,
    closest: () => header,
    contains: (node) => children.includes(node),
    appendChild: (node) => { node.isConnected = true; children.push(node); },
    querySelector: (selector) => {
      if (selector === ':scope > .syp-channel-qa-host') {
        return children.find(({ className }) => className.includes('syp-channel-qa-host')) || null;
      }
      return selector.includes('button')
        ? { getBoundingClientRect: () => ({ height: 36 }) }
        : null;
    }
  };
  const document = {
    documentElement: {},
    querySelectorAll: () => [actions],
    querySelector: () => null,
    createElement: () => ({
      className: '',
      style: {},
      attachShadow() { this.shadowRoot = {}; return this.shadowRoot; }
    })
  };
  class MutationObserver {
    observe() {}
    disconnect() {}
  }
  const state = {
    data: {},
    currentPage: 'channel',
    initGeneration: 1,
    quickAddObserver: null
  };
  const app = {
    state,
    api: {
      extractHandleFromUrl: () => '@deephack',
      isVisibleElement: () => true,
      loadData: async () => {},
      waitForElement: async (getElement) => getElement(),
      waitForSubscriptionState: async () => { throw new Error('mount must not wait for subscription state'); },
      sendMsg: async () => ({}),
      renderQuickAddButton: (...args) => rendered.push(args)
    },
    pages: {}
  };
  const context = { __SYP_CONTENT__: app, document, MutationObserver, clearTimeout, setTimeout, console };
  context.globalThis = context;
  const filename = path.join(__dirname, '..', 'content', 'pages', 'channel.js');
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), context, { filename });

  await app.pages.channel.init({ url: 'https://www.youtube.com/@deephack', gen: 1 });

  assert.match(state.quickAddHost.className, /syp-channel-qa-host/);
  assert.deepEqual(rendered[0], ['@deephack', 'deephack']);
});

function stageSubscribeFlow(onNativeClick) {
  const pageWindow = { location: { href: 'https://www.youtube.com/@creator' } };
  const { state, api } = loadQuickAdd(pageWindow);
  const messages = [];
  const oldHost = { isConnected: true };
  const scope = {};
  const item = { isConnected: true };
  let change;
  let confirm;
  let nativeClicks = 0;
  const checkbox = {
    checked: true,
    dataset: { playlist: 'subgroup' },
    closest: () => item,
    addEventListener: (type, listener) => { if (type === 'change') change = listener; }
  };
  const oldShadow = {
    querySelectorAll: (selector) => selector === 'input[data-playlist]' ? [checkbox] : []
  };

  Object.assign(state, {
    initGeneration: 1,
    quickAddHandle: '@creator',
    quickAddHost: oldHost,
    quickAddShadow: oldShadow
  });
  Object.assign(api, {
    setPlaylistItemCheckedState() {},
    getSubscriptionState: () => 'unsubscribed',
    getQuickAddSubscriptionScope: () => scope,
    showSubscribeConfirmRow: (_item, actions) => { confirm = actions.onConfirm; },
    triggerSubscribeControl: () => {
      nativeClicks += 1;
      onNativeClick({ state, pageWindow, oldHost });
      return true;
    },
    awaitSubscriptionState: (getScope, _target, { isStale }) =>
      Promise.resolve(!isStale() && getScope() === scope),
    sendMsg: async (message) => {
      messages.push(message);
      return message.type === 'GET_ALL_DATA' ? state.data : { success: true };
    },
    buildLookupMaps() {},
    showPageToast() {},
    handleActionError(error) { throw error; },
    renderQuickAddButton() {},
    attachDropdownGroupToggles() {},
    attachInlineCreateListener() {}
  });
  api.attachDropdownListeners('@creator', 'Creator');

  return {
    messages,
    get nativeClicks() { return nativeClicks; },
    run: async () => {
      await change();
      await confirm({ disabled: false, textContent: '' });
    }
  };
}

test('subscribe survives a same-profile header replacement and assigns the initiating subgroup', async () => {
  const flow = stageSubscribeFlow(({ state, oldHost }) => {
    oldHost.isConnected = false;
    state.quickAddHost = { isConnected: true };
    state.quickAddShadow = {};
  });

  await flow.run();
  const assignments = flow.messages.filter(({ type }) => type === 'ASSIGN_CHANNEL_PLAYLIST');
  assert.equal(flow.nativeClicks, 1);
  assert.deepEqual({ ...assignments[0] }, {
    type: 'ASSIGN_CHANNEL_PLAYLIST',
    handle: '@creator',
    name: 'Creator',
    playlistId: 'subgroup',
    assign: true
  });
});

test('subscribe flow still aborts after real SPA navigation', async () => {
  const flow = stageSubscribeFlow(({ pageWindow }) => {
    pageWindow.location.href = 'https://www.youtube.com/@other';
  });

  await flow.run();
  assert.equal(flow.nativeClicks, 1);
  assert.equal(flow.messages.some(({ type }) => type === 'ASSIGN_CHANNEL_PLAYLIST'), false);
});
