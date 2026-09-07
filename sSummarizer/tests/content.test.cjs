const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

const source = fs.readFileSync(path.join(__dirname, '../content.js'), 'utf8');
const plain = value => JSON.parse(JSON.stringify(value));
const tick = () => new Promise(resolve => setImmediate(resolve));

function harness({ storage, sendError, sendResponse = { success: true } } = {}) {
  const nodes = new Map();
  class Element {
    constructor() {
      this.style = { display: 'none' };
      this.dataset = {};
      this.listeners = {};
      this.children = [];
      this.value = '';
      this.disabled = true;
      this.classList = { add() {}, remove() {} };
    }
    set innerHTML(html) {
      this.html = html;
      this.children = [];
      for (const [, id] of html.matchAll(/id="([^"]+)"/g)) nodes.set(id, new Element());
    }
    get innerHTML() { return this.html || ''; }
    querySelector(selector) { return nodes.get(selector.slice(1)) || null; }
    querySelectorAll(selector) { return this.children.filter(child => selector === `.${child.className}`); }
    appendChild(child) { this.children.push(child); child.parentNode = this; }
    attachShadow() { const shadow = new Element(); shadow.host = this; return shadow; }
    remove() { this.parentNode = null; }
    addEventListener(type, listener) { (this.listeners[type] ||= []).push(listener); }
    fire(type, event = {}) {
      const e = { target: this, isTrusted: true, preventDefault() {}, stopPropagation() {}, ...event };
      for (const listener of this.listeners[type] || []) listener(e);
    }
    focus() {}
    scrollIntoView() {}
  }
  const sent = [];
  const ports = [];
  let listener;
  const runtime = {
    onMessage: { addListener(fn) { listener = fn; } },
    sendMessage(message, callback) {
      sent.push(plain(message));
      queueMicrotask(() => {
        runtime.lastError = sendError ? { message: sendError } : null;
        callback?.(sendResponse);
        runtime.lastError = null;
      });
    },
    connect() {
      const disconnectListeners = [];
      const port = {
        messages: [],
        onMessage: { addListener() {} },
        onDisconnect: { addListener(fn) { disconnectListeners.push(fn); } },
        postMessage(message) { this.messages.push(plain(message)); },
        disconnect() { for (const fn of disconnectListeners) fn(); }
      };
      ports.push(port);
      return port;
    }
  };
  const context = vm.createContext({
    window: { innerWidth: 1200, innerHeight: 800 },
    document: { body: new Element(), createElement: () => new Element() },
    chrome: { runtime, i18n: { getMessage: () => '' }, storage: { local: {
      get(keys, callback) {
        if (callback) callback({ slashCommands: [{ command: 'outline', prompt: 'Make an outline' }] });
        else return storage || Promise.resolve({});
      }, set() {}
    } } },
    crypto: require('node:crypto').webcrypto,
    console: { log() {}, warn() {} },
    setTimeout: () => 1, clearTimeout() {}, setInterval: () => 1, clearInterval() {},
    requestAnimationFrame: callback => callback()
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../shared/reasoning-utils.js'), 'utf8'), context);
  // Observe the real closure without adding test exports to production.
  vm.runInContext(source.replace(/\}\)\(\);\s*$/, `globalThis.state = {
    chatHistories, contentBuffers, activeStreams, floatingWindows
  }; })();`), context);
  const message = request => {
    const responses = [];
    const keepAlive = listener({ uniqueId: 'window', operationId: 'initial', ...request }, {}, response => responses.push(response));
    return { responses, keepAlive };
  };
  const node = prefix => nodes.get(`${prefix}-window`);
  const mount = async () => {
    const result = message({ action: 'createFloatingWindow', showLoading: true });
    await tick();
    assert.equal(context.state.floatingWindows.size, 1, 'window mounts');
    return result;
  };
  const start = (operationId = 'initial') => message({ action: 'streamStart', operationId, originalContext: 'Summarize this source: ARTICLE' });
  const finish = () => message({ action: 'streamEnd', fullResponse: 'Summary', originalContext: 'Summarize this source: ARTICLE' });
  return { context, sent, ports, message, node, mount, start, finish };
}

test('creation acknowledges only after mounting and loading, and reports storage failure', async () => {
  let release;
  const h = harness({ storage: new Promise(resolve => { release = resolve; }) });
  const pending = h.message({ action: 'createFloatingWindow', showLoading: true });
  assert.equal(pending.keepAlive, true);
  assert.equal(pending.responses.length, 0);
  assert.equal(h.context.state.floatingWindows.size, 0);
  release({});
  await tick();
  assert.equal(pending.responses[0].success, true);
  assert.equal(h.node('loading-overlay').style.display, 'flex');
  h.start();
  h.message({ action: 'appendToFloatingWindow', content: 'Fast answer', isDelta: true });
  h.message({ action: 'streamEnd', fullResponse: 'Fast answer' });
  assert.equal(h.node('chat-input').disabled, false);
  assert.match(h.node('content').innerHTML, /Fast answer/);

  const failed = harness({ storage: Promise.reject(new Error('storage unavailable')) });
  const response = failed.message({ action: 'createFloatingWindow', showLoading: true });
  await tick();
  assert.equal(response.responses[0].success, false);
  assert.match(response.responses[0].error, /storage unavailable/);
  assert.equal(failed.context.state.activeStreams.size, 0);
});

test('untrusted click and every Enter route cannot submit; trusted click, keyboard and slash work', async () => {
  for (const route of ['click', 'enter', 'dropdown-enter', 'selected-slash']) {
    const h = harness();
    await h.mount();
    h.finish();
    const input = h.node('chat-input');
    input.value = 'Injected prompt';
    if (route === 'dropdown-enter') h.node('slash-dropdown').style.display = 'block';
    if (route === 'selected-slash') {
      input.value = '/outline';
      input.fire('input');
    }
    if (route === 'click') h.node('chat-send').fire('click', { isTrusted: false });
    else input.fire('keydown', { key: 'Enter', isTrusted: false });
    assert.equal(h.sent.length, 0, `${route} rejects synthetic events`);
    if (route === 'click') h.node('chat-send').fire('click');
    else input.fire('keydown', { key: 'Enter' });
    assert.equal(h.sent.length, 1, `${route} accepts trusted interaction`);
    assert.equal(h.sent[0].action, 'submitFollowUp');
    assert.ok(h.sent[0].operationId);
    assert.notEqual(h.sent[0].operationId, 'initial');
    assert.equal(h.sent[0].messages.at(-1).content, route === 'selected-slash' ? 'Make an outline' : 'Injected prompt');
  }
});

test('initial and follow-up interruptions retain source, partial text and reasoning without diagnostics', async () => {
  const h = harness();
  await h.mount();
  h.start();
  h.message({ action: 'appendToFloatingWindow', content: 'Partial summary', isDelta: true });
  h.message({ action: 'appendToFloatingWindow', content: '\n[Error] stream failed' });
  h.message({ action: 'chatUnlock', incomplete: true, assistantMessage: {
    role: 'assistant', content: 'Partial summary', reasoning: 'thinking', reasoning_details: [{ type: 'reasoning.summary', summary: 'trace' }]
  } });
  h.node('chat-input').value = 'Continue';
  h.node('chat-send').fire('click');
  assert.deepEqual(h.sent[0].messages.map(({ role, content }) => ({ role, content })), [
    { role: 'user', content: 'Summarize this source: ARTICLE' },
    { role: 'assistant', content: 'Partial summary' },
    { role: 'user', content: 'Continue' }
  ]);
  assert.equal(h.sent[0].messages[1].reasoning, 'thinking');
  const operationId = h.sent[0].operationId;
  h.start(operationId);
  h.message({ action: 'appendToFloatingWindow', operationId, content: 'More partial', isDelta: true });
  h.ports.at(-1).disconnect();
  h.node('chat-input').value = 'Continue again';
  h.node('chat-input').fire('keydown', { key: 'Enter' });
  assert.deepEqual(h.sent[1].messages.map(item => item.content), [
    'Summarize this source: ARTICLE', 'Partial summary', 'Continue', 'More partial', 'Continue again'
  ]);
});

test('terminal messages finalize once and stale operation messages cannot modify a replacement', async () => {
  const h = harness();
  await h.mount();
  h.start();
  h.message({ action: 'appendToFloatingWindow', content: 'Draft', isDelta: true });
  const terminal = { action: 'streamEnd', fullResponse: 'Final', assistantMessage: { content: 'Final', reasoning: 'preserved' } };
  h.message(terminal);
  h.message(terminal);
  assert.equal(h.context.state.chatHistories.get('window').length, 2);
  assert.equal(h.context.state.chatHistories.get('window')[0].content, 'Summarize this source: ARTICLE');
  assert.equal(h.context.state.chatHistories.get('window')[1].content, 'Final');
  assert.equal(h.context.state.chatHistories.get('window')[1].reasoning, 'preserved');
  h.node('chat-input').value = 'Follow-up';
  h.node('chat-send').fire('click');
  const buffer = h.context.state.contentBuffers.get('window');
  for (const action of ['streamStart', 'appendToFloatingWindow', 'showLoading', 'hideLoading', 'streamEnd', 'chatUnlock']) {
    h.message({ action, content: 'STALE', isDelta: true, fullResponse: 'STALE' });
  }
  assert.equal(h.context.state.contentBuffers.get('window'), buffer);
  assert.equal(h.node('chat-input').disabled, true);
  assert.equal(h.context.state.activeStreams.has('window'), true);
  assert.equal(h.context.state.chatHistories.get('window').length, 3);
  assert.equal(h.ports.at(-1).messages[0].operationId, h.sent[0].operationId);
  h.ports[0].disconnect();
  assert.equal(h.context.state.activeStreams.has('window'), true, 'old port cannot recover new stream');
  h.node('close-btn').fire('click');
  assert.equal(h.sent.at(-1).operationId, h.sent[0].operationId);
  assert.equal(h.sent.at(-1).closeWindow, true);
});

test('rejected follow-up messages release the stream and show an error without contaminating history', async () => {
  for (const options of [{ sendError: 'worker unavailable' }, { sendResponse: { success: false, error: 'Invalid session' } }]) {
    const h = harness(options);
    await h.mount();
    h.finish();
    h.node('chat-input').value = 'Continue';
    h.node('chat-send').fire('click');
    await tick();
    assert.equal(h.context.state.activeStreams.size, 0);
    assert.equal(h.node('chat-input').disabled, false);
    assert.match(h.context.state.contentBuffers.get('window'), /worker unavailable|Invalid session/);
    assert.equal(h.context.state.chatHistories.get('window').at(-1).content, 'Continue');
  }
});

test('debug labels and errors without generated text preserve only the source in conversation history', async () => {
  const h = harness();
  await h.mount();
  h.start();
  h.message({ action: 'appendToFloatingWindow', content: '**[DEBUG MODE]**\n\n**Action:** Custom task' });
  h.message({ action: 'chatUnlock' });
  assert.match(h.node('content').innerHTML, /DEBUG MODE/);
  assert.equal(h.node('chat-input').disabled, false);
  h.node('chat-input').value = 'Continue';
  h.node('chat-send').fire('click');
  assert.deepEqual(h.sent[0].messages, [
    { role: 'user', content: 'Summarize this source: ARTICLE' },
    { role: 'user', content: 'Continue' }
  ]);
});

test('missing acknowledgement releases the stream instead of leaving a disabled input', async () => {
  const h = harness({ sendResponse: null });
  await h.mount();
  h.finish();
  h.node('chat-input').value = 'Continue';
  h.node('chat-send').fire('click');
  await tick();
  assert.equal(h.context.state.activeStreams.size, 0);
  assert.equal(h.node('chat-input').disabled, false);
  assert.match(h.context.state.contentBuffers.get('window'), /Request was not acknowledged/);
});

test('trusted follow-ups work on HTTP pages without crypto.randomUUID', async () => {
  const h = harness();
  h.context.crypto = { getRandomValues: array => require('node:crypto').webcrypto.getRandomValues(array) };
  await h.mount();
  h.finish();
  h.node('chat-input').value = 'Continue on HTTP';
  assert.doesNotThrow(() => h.node('chat-send').fire('click'));
  assert.equal(h.sent.length, 1);
  assert.equal(h.sent[0].messages.at(-1).content, 'Continue on HTTP');
  assert.ok(h.sent[0].operationId);
  h.message({ action: 'streamEnd', operationId: h.sent[0].operationId, fullResponse: 'Answer' });
  h.node('chat-input').value = 'Another question';
  h.node('chat-input').fire('keydown', { key: 'Enter' });
  assert.equal(h.sent.length, 2);
  assert.notEqual(h.sent[1].operationId, h.sent[0].operationId);
});

test('reasoning deltas retain signed attempt boundaries on disconnect and authoritative completion', async () => {
  for (const ending of ['disconnect', 'streamEnd', 'chatUnlock']) {
    const h = harness();
    await h.mount();
    h.start();
    const common = { type: 'reasoning.text', id: null, index: 0 };
    const send = (reasoningDetailsStart, reasoning, ...details) => h.message({
      action: 'appendToFloatingWindow', content: '', isDelta: true, reasoningDetailsStart,
      reasoningDelta: { reasoning, reasoning_details: details }
    });
    send(0, 'First ', { ...common, text: 'First ' });
    send(0, 'thought.', { ...common, text: 'thought.' });
    send(0, '', { ...common, signature: 'first-', format: 'claude' });
    send(0, '', { ...common, signature: 'signature' });
    send(1, 'Second ', { ...common, text: 'Second ', format: 'claude' });
    send(1, 'thought.', { ...common, text: 'thought.' });
    send(1, '', { ...common, signature: 'second-' }, { ...common, signature: 'signature' });
    const encrypted = [
      { type: 'reasoning.encrypted', data: 'opaque-a', index: 0 },
      { type: 'reasoning.encrypted', data: 'opaque-b', index: 0 }
    ];
    send(1, '', ...encrypted);
    h.message({ action: 'appendToFloatingWindow', content: 'Partial answer', isDelta: true });
    const expected = {
      role: 'assistant', content: 'Partial answer', reasoning: 'First thought.Second thought.',
      reasoning_details: [
        { ...common, format: 'claude', text: 'First thought.', signature: 'first-signature' },
        { ...common, format: 'claude', text: 'Second thought.', signature: 'second-signature' }, ...encrypted
      ]
    };
    assert.deepEqual(plain(h.context.state.chatHistories.get('window')[1]), expected, 'metadata is complete before terminal');
    if (ending === 'disconnect') h.ports.at(-1).disconnect();
    else h.message({ action: ending, assistantMessage: expected });
    h.node('chat-input').value = 'Continue';
    h.node('chat-send').fire('click');
    assert.deepEqual(h.sent[0].messages[1], expected, `${ending} keeps exact reasoning without duplication`);
    assert.equal(h.sent[0].messages.filter(message => message.role === 'assistant').length, 1);
  }
});
