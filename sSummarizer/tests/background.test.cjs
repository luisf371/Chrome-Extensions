const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { randomUUID } = require('node:crypto');

const sourceRoot = path.resolve(__dirname, '..');
const tick = () => new Promise(resolve => setImmediate(resolve));
const drain = async () => { for (let i = 0; i < 10; i++) await tick(); };
const event = () => ({ listeners: [], addListener(fn) { this.listeners.push(fn); } });
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
const sse = data => `data: ${typeof data === 'string' ? data : JSON.stringify(data)}\n\n`;
const delta = content => ({ choices: [{ delta: { content }, finish_reason: null }] });
const ended = content => sse(delta(content)) + sse('[DONE]');

function worker(overrides = {}) {
  const messages = [], fetches = [], timers = new Map(), sessionData = {}, badges = [];
  let timerId = 0, now = 0;
  const settings = { apiUrl: 'https://example.invalid/chat/completions', apiKey: 'synthetic-key', apiProvider: 'openai', model: 'test', ...overrides.settings };
  const area = data => ({ get: async () => ({ ...data }), set: async values => Object.assign(data, values), remove: async keys => { for (const key of [keys].flat()) delete data[key]; } });
  const chrome = {
    runtime: { id: 'test-extension', onConnect: event(), onInstalled: event(), onStartup: event(), onMessage: event(), lastError: null },
    storage: { local: { ...area(settings), get: overrides.getSettings || (async () => settings) }, session: area(sessionData), onChanged: event() },
    tabs: { onRemoved: event(), onUpdated: event(), sendMessage(tab, message, options, callback) { messages.push(JSON.parse(JSON.stringify({ tab, ...message }))); (callback || options)(overrides.uiReply?.(message) || { success: true }); } },
    scripting: { executeScript: overrides.executeScript || (async () => [{ result: 'source text', documentId: 'doc-7' }]) },
    contextMenus: { onClicked: event(), removeAll: async () => {}, create() {} },
    action: { onClicked: event(), setBadgeText: details => badges.push(details), setBadgeBackgroundColor() {} }, i18n: { getMessage: () => '' }
  };
  const context = vm.createContext({ chrome, self: { addEventListener() {} }, console: { log() {}, warn() {}, error() {} }, URL, AbortController, DOMException, TextDecoder, TextEncoder, crypto: { randomUUID },
    setTimeout(fn, ms) { const id = ++timerId; timers.set(id, { fn, ms, due: now + ms }); return id; }, clearTimeout(id) { timers.delete(id); },
    fetch: async (url, init) => { fetches.push({ url, ...init }); return overrides.fetch ? overrides.fetch(url, init, fetches.length) : new Response(ended('answer')); }
  });
  context.importScripts = (...files) => files.forEach(file => vm.runInContext(fs.readFileSync(path.join(sourceRoot, file), 'utf8'), context));
  vm.runInContext(fs.readFileSync(path.join(sourceRoot, 'background.js'), 'utf8'), context);
  const run = code => vm.runInContext(code, context);
  run('tabIdMap.set(1, 7)');
  return { context, chrome, messages, fetches, timers, sessionData, badges, run,
    call: (text = 'source text', opts = {}) => context.makeApiCall(text, 1, opts.prompt || null, null, { operationId: opts.operationId || 'operation-1' }),
    fire(ms) { for (const [id, timer] of [...timers]) if (ms === undefined || timer.ms === ms) { timers.delete(id); timer.fn(); } },
    advance(ms) { now += ms; for (const [id, timer] of [...timers]) if (timer.due <= now) { timers.delete(id); timer.fn(); } }
  };
}

function streamResponse(text, { open = false, status = 200, signal } = {}) {
  let control, cancelCalls = 0;
  const body = new ReadableStream({ start(controller) { control = controller; if (text) controller.enqueue(new TextEncoder().encode(text)); if (!open) controller.close(); }, cancel() { cancelCalls++; } });
  signal?.addEventListener('abort', () => { try { control.error(new DOMException('Aborted', 'AbortError')); } catch {} });
  return { response: new Response(body, { status }), get cancelCalls() { return cancelCalls; }, control };
}

async function settles(promise) {
  let settled = false;
  promise.then(() => { settled = true; }, () => { settled = true; });
  for (let i = 0; i < 15; i++) await tick();
  assert.equal(settled, true, 'operation must settle without waiting for transport EOF');
  await promise;
}

const tests = [];
function test(name, fn) { tests.push([name, fn]); }

test('Stop during settings prevents late provider transmission', async () => {
  const held = deferred();
  const w = worker({ getSettings: () => held.promise });
  const pending = w.call();
  await tick();
  await w.context.stopApiRequest(1, 7, 'operation-1');
  held.resolve({ apiUrl: 'https://example.invalid', apiKey: 'synthetic', apiProvider: 'openai' });
  await settles(pending);
  assert.equal(w.fetches.length, 0);
});

test('definitive completion cancels an open body and cleans the idle timer', async () => {
  const fixture = streamResponse(ended('answer'), { open: true });
  const w = worker({ fetch: async () => fixture.response });
  await settles(w.call());
  assert.equal(w.messages.filter(m => m.action === 'streamEnd').length, 1);
  assert.equal(fixture.cancelCalls, 1);
  assert.equal(w.timers.size, 0);
  assert.equal(w.run('abortControllers.size'), 0);
});

test('stalled success and HTTP error bodies remain under a deadline', async () => {
  for (const status of [200, 503]) {
    const w = worker({ fetch: async (url, init) => streamResponse('', { open: true, status, signal: init.signal }).response });
    const pending = w.call();
    await tick();
    assert.ok(w.timers.size > 0, 'body read needs a live timeout');
    w.fire();
    await settles(pending);
    const notice = w.messages.find(m => m.action === 'appendToFloatingWindow' && !m.isDelta)?.content || '';
    assert.match(notice, status === 503 ? /503|overload|unavailable/i : /timed out/i);
    assert.equal(w.messages.filter(m => m.action === 'chatUnlock').length, 1);
    assert.equal(w.timers.size, 0);
  }
});

test('SSE multiline data and every newline/chunk boundary preserve text', async () => {
  for (const newline of ['\n', '\r\n', '\r']) {
    const text = ['data: {"choices":[', 'data: {"delta":{"content":"LOST"}}]}', '', 'data: [DONE]', '', ''].join(newline);
    for (let split = 1; split < text.length; split++) {
      const w = worker({ fetch: async () => new Response(new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode(text.slice(0, split))); c.enqueue(new TextEncoder().encode(text.slice(split))); c.close(); } })) });
      await w.call();
      assert.equal(w.messages.find(m => m.action === 'streamEnd')?.fullResponse, 'LOST', `${JSON.stringify(newline)} split ${split}`);
    }
  }
});

test('malformed recognized SSE cannot become success after DONE', async () => {
  const w = worker({ fetch: async () => new Response(sse(delta('A')) + sse('{invalid') + sse('[DONE]')) });
  await w.call();
  assert.equal(w.messages.filter(m => m.action === 'streamEnd').length, 0);
  const recovery = w.messages.find(m => m.action === 'chatUnlock');
  assert.equal(recovery?.assistantMessage?.content, 'A');
  assert.match(w.messages.find(m => !m.isDelta && m.content?.startsWith('[Error]'))?.content || '', /invalid|malformed|protocol/i);
});

test('interrupted source and partial reasoning survive authoritative recovery', async () => {
  const data = { choices: [{ delta: { content: 'partial', reasoning: 'thinking' } }] };
  // A protocol error is final; a bare EOF would now be retried.
  const w = worker({ fetch: async () => new Response(sse(data) + sse('{invalid')) });
  await w.call('original source', { prompt: 'Summarize task' });
  const start = w.messages.find(m => m.action === 'streamStart');
  const recovery = w.messages.find(m => m.action === 'chatUnlock');
  assert.match(start?.originalContext || '', /Summarize task[\s\S]*original source/);
  assert.equal(recovery?.assistantMessage?.content, 'partial');
  assert.equal(recovery?.assistantMessage?.reasoning, 'thinking');
  assert.equal(recovery?.incomplete, true);
});

test('provider stop reasons distinguish truncation and policy blocks', async () => {
  const fixtures = [
    ['openai', sse({ choices: [{ delta: { content: 'partial' }, finish_reason: 'length' }] }), 'length'],
    ['openai', sse({ choices: [{ delta: {}, finish_reason: 'content_filter' }] }), 'content_filter'],
    ['anthropic', sse({ type: 'message_delta', delta: { stop_reason: 'max_tokens' } }) + sse({ type: 'message_stop' }), 'max_tokens'],
    ['gemini', sse({ candidates: [{ finishReason: 'SAFETY' }] }), 'SAFETY'],
    ['gemini', sse({ promptFeedback: { blockReason: 'BLOCKLIST' } }), 'BLOCKLIST']
  ];
  for (const [provider, text, reason] of fixtures) {
    const w = worker({ settings: { apiProvider: provider }, fetch: async () => new Response(text) });
    await w.call();
    assert.equal(w.messages.filter(m => m.action === 'streamEnd').length, 0, reason);
    assert.equal(w.messages.find(m => m.action === 'chatUnlock')?.finishReason, reason);
    assert.equal(w.fetches.length, 1);
  }
});

test('reasoning details merge only compatible consecutive text blocks', async () => {
  const details = [
    { type: 'reasoning.summary', summary: 'First ', index: 0, id: 'a', format: 'test' },
    { type: 'reasoning.summary', summary: 'thought.', index: 0, id: 'a', format: 'test' },
    { type: 'reasoning.encrypted', data: 'opaque', id: 'secret', index: 0 },
    { type: 'reasoning.summary', summary: 'Next', index: 0, id: 'b' }
  ];
  const text = details.map(detail => sse({ choices: [{ delta: { reasoning_details: [detail] } }] })).join('') + ended('answer');
  const w = worker({ fetch: async () => new Response(text) });
  await w.call();
  const replay = w.messages.find(m => m.action === 'streamEnd').assistantMessage.reasoning_details;
  assert.deepEqual(JSON.parse(JSON.stringify(replay)), [{ ...details[0], summary: 'First thought.' }, details[2], details[3]]);
});

test('Gemini keeps all selected-candidate text parts and omits thoughts', async () => {
  const w = worker({ settings: { apiProvider: 'gemini' }, fetch: async () => new Response(sse({ candidates: [{ content: { parts: [{ text: 'hidden', thought: true }, { text: 'FIRST ' }, { inlineData: {} }, { text: 'SECOND' }] }, finishReason: 'STOP' }, { content: { parts: [{ text: 'other' }] } }] })) });
  await w.call();
  assert.equal(w.messages.find(m => m.action === 'streamEnd')?.fullResponse, 'FIRST SECOND');
});

test('overlap removal is independent of delta boundaries and flushes uncertainty', async () => {
  for (const chunks of [['brown fox jumps'], ['b', 'rown ', 'fox ', 'jumps']]) {
    const w = worker();
    w.run("streamStates.set(1, createStreamState({ resumeDeduper: { active: true, existingText: 'The quick brown fox', pending: '' } }))");
    assert.equal(chunks.map(chunk => w.context.applyResumeOverlapDedupe(1, chunk)).join(''), ' jumps');
  }
});

test('unknown session, foreign tab and malformed follow-ups never dispatch', async () => {
  for (const request of [
    { action: 'submitFollowUp', uniqueId: 999, operationId: 'new', messages: [{ role: 'user', content: 'question' }] },
    { action: 'submitFollowUp', uniqueId: 1, operationId: 'new', messages: [{ role: 'user', content: 'question' }] },
    { action: 'submitFollowUp', uniqueId: 1, operationId: 'new', messages: [{ role: 'tool', content: {} }] }
  ]) {
    const w = worker();
    const reply = deferred();
    w.chrome.runtime.onMessage.listeners[0](request, { id: 'test-extension', tab: { id: 99 }, frameId: 0, documentId: 'foreign' }, reply.resolve);
    await tick();
    assert.equal((await reply.promise).success, false);
    assert.equal(w.fetches.length, 0);
  }
});

test('tab removal aborts only its active stream', async () => {
  const w = worker({ fetch: async (url, init) => streamResponse('', { open: true, signal: init.signal }).response });
  const pending = w.call();
  await tick();
  for (const listener of w.chrome.tabs.onRemoved.listeners) listener(7);
  await settles(pending);
  assert.equal(w.fetches[0].signal.aborted, true);
  assert.equal(w.run('abortControllers.size'), 0);
});

test('CR-only terminal events settle while transport remains open', async () => {
  const fixture = streamResponse(ended('answer').replaceAll('\n', '\r'), { open: true });
  const w = worker({ fetch: async () => fixture.response });
  await settles(w.call());
  assert.equal(w.messages.find(m => m.action === 'streamEnd')?.fullResponse, 'answer');
});

test('Stop preserves partial reasoning and cannot clean a newer operation', async () => {
  const w = worker({ fetch: async (url, init, count) => count === 1
    ? streamResponse(sse({ choices: [{ delta: { content: 'partial', reasoning: 'why' } }] }), { open: true, signal: init.signal }).response
    : new Response(ended('new answer')) });
  const first = w.call();
  await tick();
  await w.context.stopApiRequest(1, 7, 'operation-1');
  const second = w.call([{ role: 'user', content: 'continue' }], { operationId: 'operation-2' });
  await Promise.all([first, second]);
  const recovery = w.messages.find(m => m.action === 'chatUnlock' && m.operationId === 'operation-1');
  assert.equal(recovery?.assistantMessage?.content, 'partial');
  assert.equal(recovery?.assistantMessage?.reasoning, 'why');
  assert.equal(w.messages.find(m => m.action === 'streamEnd' && m.operationId === 'operation-2')?.fullResponse, 'new answer');
  assert.equal(w.timers.size, 0);
});

test('one overload continuation keeps slash/system context and sends no reasoning metadata', async () => {
  const overloaded = sse({ error: { code: 503, message: 'busy', metadata: { error_type: 'provider_overloaded' } } });
  const firstText = sse({ choices: [{ delta: { content: 'The quick brown fox', reasoning_details: [{ type: 'reasoning.summary', summary: 'First ', index: 0 }] } }] }) +
    sse({ choices: [{ delta: { reasoning_details: [{ type: 'reasoning.summary', summary: 'thought.', index: 0 }] } }] }) + overloaded;
  const secondText = ['b', 'rown ', 'fox ', 'jumps'].map(chunk => sse(delta(chunk))).join('') + sse('[DONE]');
  const w = worker({ settings: { apiProvider: 'openrouter', systemPrompt: 'Base rules' }, fetch: async (url, init, count) => new Response(count === 1 ? firstText : secondText) });
  const pending = w.call('source', { prompt: 'Slash task' });
  await tick();
  w.fire(1000);
  await settles(pending);
  assert.equal(w.fetches.length, 2);
  const retry = JSON.parse(w.fetches[1].body);
  assert.equal(retry.messages[0].content, 'Base rules\n\nSlash task');
  assert.equal(retry.messages[1].content, 'source');
  assert.deepEqual(Object.keys(retry.messages[2]), ['role', 'content']);
  assert.equal(w.messages.find(m => m.action === 'streamEnd')?.fullResponse, 'The quick brown fox jumps');
  assert.equal(w.messages.filter(m => m.action === 'streamStart').length, 1);
  assert.equal(w.timers.size, 0);
});

test('Stop during overload backoff prevents the continuation POST', async () => {
  const w = worker({ settings: { apiProvider: 'openrouter' }, fetch: async () => new Response(sse(delta('partial')) + sse({ error: { code: 503, message: 'busy', metadata: { error_type: 'provider_overloaded' } } })) });
  const pending = w.call();
  await tick();
  await w.context.stopApiRequest(1, 7, 'operation-1');
  w.fire();
  await settles(pending);
  assert.equal(w.fetches.length, 1);
  assert.equal(w.messages.find(m => m.action === 'chatUnlock')?.assistantMessage?.content, 'partial');
  assert.equal(w.timers.size, 0);
});

test('cancelled extraction cannot dispatch and releases the source request', async () => {
  const source = deferred();
  const scripts = [];
  const w = worker({ executeScript: async params => { scripts.push(params); return params.func && params.args ? source.promise : [{ documentId: 'doc-7' }]; } });
  const pending = w.context.handleIconClick({ id: 7, url: 'https://youtube.com/watch?v=test' });
  for (let i = 0; i < 5; i++) await tick();
  const created = w.messages.find(m => m.action === 'createFloatingWindow');
  await w.context.stopApiRequest(created.uniqueId, 7, created.operationId);
  source.resolve([{ result: 'late source' }]);
  await settles(pending);
  assert.equal(w.fetches.length, 0);
  assert.ok(scripts.some(params => params.func?.toString().includes('cancelContentExtraction')), 'Stop must abort the source operation too');
});

test('follow-up ownership survives worker restart and rejects a replayed operation', async () => {
  const w = worker();
  await w.context.handleIconClick({ id: 7, url: 'https://example.invalid/page' }, 'source');
  const created = w.messages.find(m => m.action === 'createFloatingWindow');
  w.run('tabIdMap.clear(); sessionOwners.clear()');
  const sender = { id: 'test-extension', tab: { id: 7 }, frameId: 0, documentId: 'doc-7' };
  const request = { action: 'submitFollowUp', uniqueId: created.uniqueId, operationId: 'followup-2', messages: [{ role: 'user', content: 'source' }, { role: 'assistant', content: 'answer' }, { role: 'user', content: 'continue' }] };
  const response = deferred();
  assert.equal(w.chrome.runtime.onMessage.listeners[0](request, sender, response.resolve), true);
  assert.equal((await response.promise).success, true);
  for (let i = 0; i < 5; i++) await tick();
  assert.equal(w.fetches.length, 2);
  const replay = deferred();
  w.chrome.runtime.onMessage.listeners[0](request, sender, replay.resolve);
  assert.equal((await replay.promise).success, false);
  assert.equal(w.fetches.length, 2);
});

test('early heartbeat disconnect cancels only its matching generation', async () => {
  const held = deferred();
  const w = worker({ getSettings: () => held.promise });
  const port = { name: 'sSummarizer-stream-heartbeat', sender: { tab: { id: 7 }, documentId: 'doc-7' }, onMessage: event(), onDisconnect: event(), postMessage() {} };
  w.chrome.runtime.onConnect.listeners[0](port);
  port.onMessage.listeners[0]({ type: 'heartbeat', uniqueId: 1, operationId: 'operation-1' });
  const pending = w.call();
  await tick();
  port.onDisconnect.listeners[0]();
  held.resolve({ apiUrl: 'https://example.invalid', apiKey: 'synthetic' });
  await settles(pending);
  assert.equal(w.fetches.length, 0);
});

test('tab loading notifications preserve an active document stream and its owner', async () => {
  let fixture;
  const w = worker({ fetch: async (url, init) => {
    fixture = streamResponse(sse(delta('partial')), { open: true, signal: init.signal });
    return fixture.response;
  } });
  const pending = w.context.handleIconClick({ id: 7, url: 'https://example.invalid/page' }, 'source');
  for (let i = 0; i < 5; i++) await tick();
  const created = w.messages.find(m => m.action === 'createFloatingWindow');
  for (const change of [
    { status: 'loading', url: 'https://example.invalid/page#section' },
    { status: 'loading', url: 'https://example.invalid/route' },
    { status: 'loading' }
  ]) {
    for (const listener of w.chrome.tabs.onUpdated.listeners) listener(7, change);
    await tick();
    assert.equal(w.fetches[0].signal.aborted, false, 'tab loading alone does not prove the recipient departed');
    assert.equal(w.run(`sessionOwners.has(${created.uniqueId})`), true);
    assert.ok(w.sessionData[`summarySession:${created.uniqueId}`]);
  }
  fixture.control.enqueue(new TextEncoder().encode(sse('[DONE]')));
  await settles(pending);
  assert.equal(w.messages.find(m => m.action === 'streamEnd')?.fullResponse, 'partial');
});

test('completed document sessions accept follow-ups after tab loading notifications', async () => {
  const w = worker();
  await w.context.handleIconClick({ id: 7, url: 'https://example.invalid/page' }, 'source');
  const created = w.messages.find(m => m.action === 'createFloatingWindow');
  for (const listener of w.chrome.tabs.onUpdated.listeners) listener(7, { status: 'loading' });
  await tick();
  assert.equal(w.run(`sessionOwners.has(${created.uniqueId})`), true);
  assert.ok(w.sessionData[`summarySession:${created.uniqueId}`]);
  const reply = deferred();
  w.chrome.runtime.onMessage.listeners[0]({
    action: 'submitFollowUp', uniqueId: created.uniqueId, operationId: 'follow-up-after-loading',
    messages: [{ role: 'user', content: 'source' }, { role: 'assistant', content: 'answer' }, { role: 'user', content: 'Continue' }]
  }, { id: 'test-extension', tab: { id: 7 }, frameId: 0, documentId: 'doc-7' }, reply.resolve);
  assert.equal((await reply.promise).success, true);
  for (let i = 0; i < 5; i++) await tick();
  assert.equal(w.fetches.length, 2);
});

test('only the matching document and generation heartbeat disconnect cancels a stream', async () => {
  const w = worker({ fetch: async (url, init) => streamResponse('', { open: true, signal: init.signal }).response });
  const pending = w.context.handleIconClick({ id: 7, url: 'https://example.invalid/page' }, 'source');
  for (let i = 0; i < 5; i++) await tick();
  const created = w.messages.find(m => m.action === 'createFloatingWindow');
  const disconnect = (tabId, documentId, operationId) => {
    const port = { name: 'sSummarizer-stream-heartbeat', sender: { tab: { id: tabId }, documentId }, onMessage: event(), onDisconnect: event(), postMessage() {} };
    w.chrome.runtime.onConnect.listeners[0](port);
    port.onMessage.listeners[0]({ type: 'heartbeat', uniqueId: created.uniqueId, operationId });
    port.onDisconnect.listeners[0]();
  };
  for (const identity of [[99, 'doc-7', created.operationId], [7, 'old-document', created.operationId], [7, 'doc-7', 'old-operation']]) {
    disconnect(...identity);
    assert.equal(w.fetches[0].signal.aborted, false);
    assert.equal(w.run(`sessionOwners.has(${created.uniqueId})`), true);
  }
  disconnect(7, 'doc-7', created.operationId);
  await settles(pending);
  assert.equal(w.fetches[0].signal.aborted, true);
  assert.equal(w.run(`sessionOwners.has(${created.uniqueId})`), false);
  assert.equal(w.sessionData[`summarySession:${created.uniqueId}`], undefined);
  assert.equal(w.timers.size, 0);
});

test('healthy long streams renew the idle deadline on actual body progress', async () => {
  let fixture;
  const w = worker({ fetch: async (url, init) => { fixture = streamResponse('', { open: true, signal: init.signal }); return fixture.response; } });
  const pending = w.call();
  await tick();
  for (let i = 0; i < 4; i++) {
    w.advance(20000);
    assert.equal(w.fetches[0].signal.aborted, false);
    fixture.control.enqueue(new TextEncoder().encode(sse(delta('A'))));
    await tick();
  }
  fixture.control.enqueue(new TextEncoder().encode(sse('[DONE]')));
  await settles(pending);
  assert.equal(w.messages.find(m => m.action === 'streamEnd')?.fullResponse, 'AAAA');
  assert.equal(w.timers.size, 0);
});

test('normal provider outcomes complete and retries stop after two', async () => {
  for (const [provider, text] of [
    ['openai', sse({ choices: [{ delta: { content: 'answer' }, finish_reason: 'stop' }] })],
    ['glm', sse({ choices: [{ delta: { content: 'answer' }, finish_reason: 'stop' }] })],
    ['azure', sse({ choices: [{ delta: { content: 'answer' }, finish_reason: 'stop' }] })],
    ['anthropic', sse({ type: 'content_block_delta', delta: { text: 'answer' } }) + sse({ type: 'message_delta', delta: { stop_reason: 'end_turn' } }) + sse({ type: 'message_stop' })]
  ]) {
    const w = worker({ settings: { apiProvider: provider }, fetch: async () => new Response(text) });
    await w.call();
    assert.equal(w.messages.find(m => m.action === 'streamEnd')?.fullResponse, 'answer', provider);
  }
  const w = worker({ settings: { apiProvider: 'openrouter' }, fetch: async () => new Response(sse(delta('partial')) + sse({ error: { code: 503, message: 'busy', metadata: { error_type: 'provider_overloaded' } } })) });
  const pending = w.call();
  await drain();
  w.fire(1000);
  await drain();
  w.fire(2000);
  await settles(pending);
  assert.equal(w.fetches.length, 3);
  assert.equal(w.messages.filter(m => m.action === 'chatUnlock').length, 1);
});

test('retry terminal flush keeps an uncertain nonduplicate prefix', async () => {
  const w = worker({ settings: { apiProvider: 'openrouter' }, fetch: async (url, init, count) => new Response(count === 1
    ? sse(delta('The quick brown fox')) + sse({ error: { code: 503, message: 'busy', metadata: { error_type: 'provider_overloaded' } } })
    : ended('brown')) });
  const pending = w.call();
  await tick();
  w.fire(1000);
  await settles(pending);
  assert.equal(w.messages.find(m => m.action === 'streamEnd')?.fullResponse, 'The quick brown foxbrown');
});

test('reasoning signature fragments merge without crossing ids or formats', async () => {
  const details = [
    { type: 'reasoning.text', text: 'Thought', id: 'a', format: 'claude', index: 0 },
    { type: 'reasoning.text', signature: 'sig-', id: 'a', format: 'claude', index: 0 },
    { type: 'reasoning.text', signature: 'tail', id: 'a', format: 'claude', index: 0 },
    { type: 'reasoning.text', text: 'Separate', id: 'b', format: 'claude', index: 0 },
    { type: 'reasoning.text', text: 'Other format', id: 'b', format: 'other', index: 0 }
  ];
  const w = worker({ fetch: async () => new Response(details.map(detail => sse({ choices: [{ delta: { reasoning_details: [detail] } }] })).join('') + ended('answer')) });
  await w.call();
  const reasoning = w.messages.find(m => m.action === 'streamEnd')?.assistantMessage?.reasoning_details;
  assert.deepEqual(JSON.parse(JSON.stringify(reasoning)), [{ ...details[0], signature: 'sig-tail' }, details[3], details[4]]);
  assert.ok(w.messages.some(m => m.isDelta && m.content === '' && m.reasoningDelta?.reasoning_details), 'metadata must reach UI before terminal');
});

test('retries keep signed reasoning blocks locally but never replay them to providers', async () => {
  for (const id of [null, 'reused-id']) {
    const common = { type: 'reasoning.text', id, format: 'claude', index: 0 };
    const first = [
      { ...common, text: 'First ' }, { ...common, text: 'thought.' },
      { ...common, signature: 'first-' }, { ...common, signature: 'signature' }
    ];
    const second = [
      { ...common, text: 'Second ' }, { ...common, text: 'thought.' },
      { ...common, signature: 'second-' }, { ...common, signature: 'signature' },
      { type: 'reasoning.encrypted', data: 'opaque-a', index: 0 },
      { type: 'reasoning.encrypted', data: 'opaque-b', index: 0 }
    ];
    const encode = details => details.map(detail => sse({ choices: [{ delta: { reasoning_details: [detail] } }] })).join('');
    const w = worker({ settings: { apiProvider: 'openrouter' }, fetch: async (url, init, count) => new Response(count === 1
      ? encode(first) + sse(delta('Partial answer.')) + sse({ error: { code: 503, message: 'busy', metadata: { error_type: 'provider_overloaded' } } })
      : count === 2 ? encode(second) + ended(' More answer.') : ended('Follow-up answer.')) });
    const pending = w.call();
    await tick();
    w.fire(1000);
    await settles(pending);
    const assistant = w.messages.find(m => m.action === 'streamEnd').assistantMessage;
    const expected = [
      { ...common, text: 'First thought.', signature: 'first-signature' },
      { ...common, text: 'Second thought.', signature: 'second-signature' }, ...second.slice(-2)
    ];
    assert.deepEqual(assistant.reasoning_details, expected, 'different attempts are different signed blocks');
    assert.deepEqual(Object.keys(JSON.parse(w.fetches[1].body).messages[2]), ['role', 'content'], 'retry sends no partial reasoning');
    await w.call([{ role: 'user', content: 'source text' }, assistant, { role: 'user', content: 'Continue' }], { operationId: 'follow-up' });
    assert.deepEqual(Object.keys(JSON.parse(w.fetches[2].body).messages[2]), ['role', 'content'], 'follow-ups send no reasoning');
  }
});

test('reasoning and reasoning-details message traffic grows linearly with provider output', async () => {
  for (const field of ['reasoning', 'reasoning_details']) {
    const volumes = [];
    for (const count of [512, 1024]) {
      const piece = 'abcdefghijklmnop';
      const fragment = field === 'reasoning' ? piece : [{ type: 'reasoning.text', text: piece, index: 0 }];
      const text = sse({ choices: [{ delta: { [field]: fragment } }] }).repeat(count) + ended('answer');
      const w = worker({ fetch: async () => new Response(text) });
      await w.call();
      const total = w.messages.reduce((bytes, message) => bytes + Buffer.byteLength(JSON.stringify(message)), 0);
      const assistant = w.messages.find(m => m.action === 'streamEnd').assistantMessage;
      assert.equal(field === 'reasoning' ? assistant.reasoning : assistant.reasoning_details[0].text, piece.repeat(count));
      assert.ok(total < count * piece.length * 32, `${field}: ${total} bytes must not contain cumulative snapshots`);
      volumes.push(total);
    }
    assert.ok(volumes[1] < volumes[0] * 2.2, `${field}: doubling output must approximately double serialized traffic`);
  }
});

test('a stale delayed receiver failure cannot abort a newer operation', async () => {
  const callbacks = [];
  const held = deferred();
  const w = worker({ getSettings: () => held.promise });
  const old = w.run("beginOperation(1, 7, 'old')");
  w.chrome.tabs.sendMessage = (tab, message, callback) => callbacks.push(callback);
  const sending = w.context.sendOperationMessage(old, { action: 'appendToFloatingWindow', content: 'old', isDelta: true }).catch(() => {});
  w.context.cancelOperation(old);
  const current = w.run("beginOperation(1, 7, 'new')");
  w.chrome.runtime.lastError = { message: 'Receiving end does not exist.' };
  callbacks[0]();
  w.chrome.runtime.lastError = null;
  await sending;
  w.context.finishOperation(old);
  assert.equal(current.controller.signal.aborted, false);
  assert.equal(w.run("abortControllers.get(1).operationId"), 'new');
});

test('stale close after completion cannot remove the newer session', async () => {
  const w = worker();
  await w.context.handleIconClick({ id: 7, url: 'https://example.invalid' }, 'source');
  const created = w.messages.find(m => m.action === 'createFloatingWindow');
  w.run(`sessionOwners.get(${created.uniqueId}).lastOperationId = 'newer'`);
  const reply = deferred();
  w.chrome.runtime.onMessage.listeners[0]({ action: 'stopApiRequest', uniqueId: created.uniqueId, operationId: created.operationId, closeWindow: true },
    { id: 'test-extension', tab: { id: 7 }, frameId: 0, documentId: 'doc-7' }, reply.resolve);
  assert.equal((await reply.promise).success, false);
  assert.equal(w.run(`sessionOwners.has(${created.uniqueId})`), true);
});

test('a confirmed missing UI generation prevents provider traffic', async () => {
  const w = worker({ uiReply: message => message.action === 'streamStart' ? { success: false, stale: true } : { success: true } });
  await w.call();
  assert.equal(w.fetches.length, 0);
});

test('long retries bound overlap work while preserving the full conversation', async () => {
  const original = 'Long source answer '.repeat(500) + 'brown fox';
  const w = worker({ settings: { apiProvider: 'openrouter' }, fetch: async (url, init, count) => {
    if (count === 2) {
      assert.ok(w.run('streamStates.get(1).resumeDeduper.existingText.length') <= 4096, 'only the dedupe suffix is bounded');
      assert.equal(JSON.parse(init.body).messages[2].content, original);
    }
    return new Response(count === 1
      ? sse(delta(original)) + sse({ error: { code: 503, message: 'busy', metadata: { error_type: 'provider_overloaded' } } })
      : ended('brown fox jumps'));
  } });
  const pending = w.call();
  await tick();
  w.fire(1000);
  await settles(pending);
  assert.equal(w.messages.find(m => m.action === 'streamEnd')?.fullResponse, original + ' jumps');
});

test('headers and body bytes renew the progress deadline; a timeout is final', async () => {
  const headers = deferred();
  const w = worker({ fetch: async (url, init) => { await headers.promise; return streamResponse('', { open: true, signal: init.signal }).response; } });
  const pending = w.call();
  await tick();
  w.advance(110000);
  headers.resolve();
  await drain();
  w.advance(110000);
  assert.equal(w.fetches[0].signal.aborted, false, 'headers renew the deadline');
  w.advance(10000);
  await settles(pending);
  assert.match(w.messages.find(m => m.content?.startsWith('[Error]'))?.content || '', /timed out after 120 seconds/);
  assert.equal(w.fetches.length, 1, 'timeouts are not retried');
});

test('transient HTTP statuses retry and honor a short Retry-After', async () => {
  for (const [status, retries, retryAfter, wait = 1000] of [
    [409, true], [429, true, '2', 2000], [500, true], [529, true], [503, true, 'Wed, 21 Oct 2026 07:28:00 GMT'],
    [400, false], [401, false], [429, false, '30']
  ]) {
    const w = worker({ fetch: async (url, init, count) => count === 1
      ? new Response('{"error":{"message":"busy"}}', { status, headers: retryAfter ? { 'retry-after': retryAfter } : {} })
      : new Response(ended('ok')) });
    const pending = w.call();
    await drain();
    w.fire(wait);
    await settles(pending);
    assert.equal(w.fetches.length, retries ? 2 : 1, `${status} ${retryAfter || ''}`);
    assert.equal(w.messages.filter(m => m.action === 'streamEnd').length, retries ? 1 : 0);
  }
});

test('mid-stream errors retry unless a deterministic 4xx or a non-error finish', async () => {
  for (const [text, retries] of [
    [sse({ error: { code: 'server_error', message: 'Provider disconnected' }, choices: [{ delta: { content: '' }, finish_reason: 'error' }] }), true],
    [sse({ error: { code: '429', message: 'slow down' } }), true],
    [sse({ error: { message: 'no code' } }), true],
    [sse({ type: 'error', error: { type: 'overloaded_error', message: 'Overloaded' } }), true],
    [sse({ error: { code: 400, message: 'bad request' } }), false],
    [sse({ error: { code: 'context_length_exceeded', type: 'invalid_request_error', message: 'too long' }, choices: [{ delta: {}, finish_reason: 'error' }] }), false],
    [sse({ type: 'error', error: { type: 'authentication_error', message: 'bad key' } }), false],
    [sse({ error: { status: 'INVALID_ARGUMENT', message: 'bad arg' } }), false],
    [sse({ choices: [{ delta: {}, finish_reason: 'error' }] }), true],
    [sse({ choices: [{ delta: {}, finish_reason: 'tool_calls' }] }), false]
  ]) {
    const w = worker({ settings: { apiProvider: 'openrouter' }, fetch: async (url, init, count) => new Response(count === 1 ? text : ended('ok')) });
    const pending = w.call();
    await drain();
    w.fire(1000);
    await settles(pending);
    assert.equal(w.fetches.length, retries ? 2 : 1, text);
    if (retries) assert.equal(w.fetches[1].body, w.fetches[0].body, 'nothing streamed yet: identical resend');
  }
});

test('three attempts rebuild the continuation from base history without duplication', async () => {
  const fail = sse({ error: { code: 'server_error' } });
  const w = worker({ fetch: async (url, init, count) => new Response(count === 1 ? sse(delta('Alpha ')) + fail : count === 2 ? sse(delta('Beta ')) + fail : ended('Gamma')) });
  const pending = w.call();
  await drain();
  w.fire(1000);
  await drain();
  w.fire(2000);
  await settles(pending);
  const third = JSON.parse(w.fetches[2].body).messages;
  assert.deepEqual(third.map(m => m.role), ['system', 'user', 'assistant', 'user']);
  assert.equal(third[2].content, 'Alpha Beta ');
  assert.equal(w.messages.find(m => m.action === 'streamEnd')?.fullResponse, 'Alpha Beta Gamma');
  assert.equal(w.timers.size, 0);
});

test('network failures before or during the body resend the identical request', async () => {
  for (const fail of [
    () => { throw new TypeError('Failed to fetch'); },
    () => new Response(new ReadableStream({ start(c) { c.error(new TypeError('network error')); } }))
  ]) {
    const w = worker({ fetch: async (url, init, count) => count === 1 ? fail() : new Response(ended('ok')) });
    const pending = w.call();
    await drain();
    w.fire(1000);
    await settles(pending);
    assert.equal(w.fetches.length, 2);
    assert.equal(w.fetches[1].body, w.fetches[0].body);
    assert.equal(w.messages.find(m => m.action === 'streamEnd')?.fullResponse, 'ok');
    assert.equal(w.context.isNetworkError(new Error('network error')), false, 'only fetch TypeErrors count');
  }
});

test('provider boundary merges same-role turns; Anthropic sends its browser opt-in', async () => {
  const w = worker();
  await w.call([{ role: 'user', content: 'page' }, { role: 'user', content: 'question' }], { operationId: 'follow-up' });
  assert.deepEqual(JSON.parse(w.fetches[0].body).messages.slice(1), [{ role: 'user', content: 'page\n\nquestion' }]);
  const a = worker({ settings: { apiProvider: 'anthropic' }, fetch: async () => new Response(sse({ type: 'message_stop' })) });
  await a.call();
  assert.equal(a.fetches[0].headers['anthropic-dangerous-direct-browser-access'], 'true');
});

test('JSON bodies on stream requests surface provider text; invalid UTF-8 is replaced', async () => {
  const w = worker({ fetch: async () => Response.json({ error: { message: 'model is warming up', code: 503 } }) });
  await w.call();
  assert.equal(w.fetches.length, 1);
  assert.match(w.messages.find(m => m.content?.startsWith('[Error]'))?.content || '', /non-streaming[\s\S]*warming up/);
  const bytes = Buffer.concat([Buffer.from('data: {"choices":[{"delta":{"content":"a'), Buffer.from([0xff]), Buffer.from('b"}}]}\n\ndata: [DONE]\n\n')]);
  const u = worker({ fetch: async () => new Response(bytes) });
  await u.call();
  assert.equal(u.messages.find(m => m.action === 'streamEnd')?.fullResponse, 'a�b');
});

test('Azure hosts normalize to the permitted endpoint and diagnostics omit URL secrets', () => {
  const w = worker();
  for (const resource of ['myres', 'https://myres.openai.azure.com/', 'myres.cognitiveservices.azure.com', 'https://myres.services.ai.azure.com/models?x=1']) {
    assert.equal(w.context.buildAzureApiUrl({ azureResource: resource, azureDeployment: 'gpt 5' }),
      'https://myres.openai.azure.com/openai/deployments/gpt%205/chat/completions?api-version=2025-04-01-preview', resource);
  }
  assert.match(w.context.buildAzureApiUrl({ azureResource: 'myres', azureDeployment: 'd', azureApiVersion: '2024-10-21' }), /api-version=2024-10-21$/);
  assert.equal(w.context.buildRequestDiagnostics({ fetchUrl: 'https://user:pw@example.invalid/v1/chat?key=secret#frag' }).fetchUrl, 'https://example.invalid/v1/chat');
  w.run("beginOperation(1, 7, 'diag'); handleJsonLine(JSON.stringify({ error: { code: 'server_error' } }), 1, OpenAIAdapter)");
  assert.equal(w.run('streamStates.get(1).recentEvents.at(-1).code'), 'server_error');
});

test('Anthropic requests carry the browser-access header and a larger output limit', async () => {
  const w = worker({ settings: { apiProvider: 'anthropic', apiUrl: 'https://api.anthropic.com/v1/messages', model: 'claude-sonnet-4-6' } });
  await settles(w.call());
  assert.equal(w.fetches[0].headers['anthropic-dangerous-direct-browser-access'], 'true');
  assert.equal(JSON.parse(w.fetches[0].body).max_tokens, 16000);
});

test('Gemini model ids are normalised and encoded in the request URL', async () => {
  for (const [model, expected] of [['models/gemini-2.5-flash', 'gemini-2.5-flash'], [' gemini-x?y/z ', 'gemini-x%3Fy%2Fz']]) {
    const w = worker({ settings: { apiProvider: 'gemini', apiUrl: 'https://generativelanguage.googleapis.com', model } });
    await settles(w.call());
    assert.equal(w.fetches[0].url, `https://generativelanguage.googleapis.com/v1beta/models/${expected}:streamGenerateContent?alt=sse`);
  }
});

test('YouTube Shorts use the transcript extractor and look-alike URLs do not', async () => {
  const picked = async url => {
    const scripts = [];
    const w = worker({ executeScript: async params => { scripts.push(params); return [{ result: 'text', documentId: 'doc-7' }]; } });
    await w.context.handleIconClick({ id: 7, url });
    return scripts.find(params => params.func && params.args)?.func.toString() || '';
  };
  assert.match(await picked('https://www.youtube.com/shorts/abcdefghijk'), /extractYouTubeCaptions/);
  assert.match(await picked('https://www.youtube.com/watch?v=abcdefghijk'), /extractYouTubeCaptions/);
  assert.match(await picked('https://example.com/page?next=youtube.com/watch'), /getPageContent/);
  assert.match(await picked('https://notyoutube.com/watch?v=abcdefghijk'), /getPageContent/);
});

test('clicking the icon on a restricted page shows a badge instead of doing nothing', async () => {
  const w = worker();
  for (const url of ['https://chromewebstore.google.com/detail/x', 'about:blank', 'view-source:https://example.com', 'chrome://settings']) {
    await w.context.handleIconClick({ id: 7, url });
  }
  assert.equal(w.badges.filter(b => b.text === '!').length, 4);
  assert.equal(w.messages.length, 0);
  // A page the extension cannot inject into also flashes the badge.
  const blocked = worker({ executeScript: async () => { throw new Error('Cannot access contents of the page'); } });
  await blocked.context.handleIconClick({ id: 7, url: 'https://example.com/file.pdf' });
  assert.equal(blocked.badges.filter(b => b.text === '!').length, 1);
});

test('a second click on the same tab while a summary is running does not start another', async () => {
  const gate = deferred();
  const w = worker({ fetch: async () => { await gate.promise; return new Response(ended('answer')); } });
  const first = w.context.handleIconClick({ id: 7, url: 'https://example.com/a' }, 'source');
  for (let i = 0; i < 5; i++) await tick();
  await w.context.handleIconClick({ id: 7, url: 'https://example.com/a' }, 'source');
  assert.equal(w.messages.filter(m => m.action === 'createFloatingWindow').length, 1);
  gate.resolve();
  await settles(first);
  await w.context.handleIconClick({ id: 7, url: 'https://example.com/a' }, 'source');
  assert.equal(w.messages.filter(m => m.action === 'createFloatingWindow').length, 2);
});

test('a stream that ends without any text is reported instead of looking complete', async () => {
  const w = worker({ fetch: async () => new Response(sse('[DONE]')) });
  await settles(w.call());
  assert.equal(w.messages.filter(m => m.action === 'streamEnd').length, 0);
  assert.match(w.messages.find(m => m.action === 'appendToFloatingWindow' && !m.isDelta)?.content || '', /^\[Error\].*without returning any text/);
  assert.equal(w.messages.filter(m => m.action === 'chatUnlock').length, 1);
});

test('mid-stream "network error" is treated as a connectivity failure but request-construction errors are not', () => {
  const w = worker();
  const isNetwork = message => w.context.isNetworkError(Object.assign(new TypeError(message), {}));
  assert.equal(isNetwork('network error'), true);
  assert.equal(isNetwork('Failed to fetch'), true);
  assert.equal(isNetwork('NetworkError when attempting to fetch resource.'), true);
  assert.equal(isNetwork("Failed to execute 'fetch' on 'Window': Failed to read the 'headers' property: String contains non ISO-8859-1 code point."), false);
});

(async () => {
  let failed = 0;
  for (const [name, fn] of tests) {
    let watchdog;
    try {
      await Promise.race([fn(), new Promise((resolve, reject) => { watchdog = setTimeout(() => reject(new Error('Regression did not settle within 2 seconds')), 2000); })]);
      console.log(`PASS ${name}`);
    }
    catch (error) { failed++; console.error(`FAIL ${name}: ${error.message}`); }
    finally { clearTimeout(watchdog); }
  }
  console.log(`${tests.length - failed}/${tests.length} background regressions passed`);
  process.exitCode = failed ? 1 : 0;
})();
