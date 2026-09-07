const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { randomUUID } = require('node:crypto');

const sourceRoot = path.resolve(__dirname, '..');
const tick = () => new Promise(resolve => setImmediate(resolve));
const event = () => ({ listeners: [], addListener(fn) { this.listeners.push(fn); } });
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
const sse = data => `data: ${typeof data === 'string' ? data : JSON.stringify(data)}\n\n`;
const delta = content => ({ choices: [{ delta: { content }, finish_reason: null }] });
const ended = content => sse(delta(content)) + sse('[DONE]');

function worker(overrides = {}) {
  const messages = [], fetches = [], timers = new Map(), sessionData = {};
  let timerId = 0, now = 0;
  const settings = { apiUrl: 'https://example.invalid/chat/completions', apiKey: 'synthetic-key', apiProvider: 'openai', model: 'test', ...overrides.settings };
  const area = data => ({ get: async () => ({ ...data }), set: async values => Object.assign(data, values), remove: async keys => { for (const key of [keys].flat()) delete data[key]; } });
  const chrome = {
    runtime: { id: 'test-extension', onConnect: event(), onInstalled: event(), onStartup: event(), onMessage: event(), lastError: null },
    storage: { local: { ...area(settings), get: overrides.getSettings || (async () => settings) }, session: area(sessionData), onChanged: event() },
    tabs: { onRemoved: event(), onUpdated: event(), sendMessage(tab, message, options, callback) { messages.push(JSON.parse(JSON.stringify({ tab, ...message }))); (callback || options)(overrides.uiReply?.(message) || { success: true }); } },
    scripting: { executeScript: overrides.executeScript || (async () => [{ result: 'source text', documentId: 'doc-7' }]) },
    contextMenus: { onClicked: event(), removeAll: async () => {}, create() {} },
    action: { onClicked: event() }, i18n: { getMessage: () => '' }
  };
  const context = vm.createContext({ chrome, self: { addEventListener() {} }, console: { log() {}, warn() {}, error() {} }, URL, AbortController, DOMException, TextDecoder, TextEncoder, crypto: { randomUUID },
    setTimeout(fn, ms) { const id = ++timerId; timers.set(id, { fn, ms, due: now + ms }); return id; }, clearTimeout(id) { timers.delete(id); },
    fetch: async (url, init) => { fetches.push({ url, ...init }); return overrides.fetch ? overrides.fetch(url, init, fetches.length) : new Response(ended('answer')); }
  });
  context.importScripts = (...files) => files.forEach(file => vm.runInContext(fs.readFileSync(path.join(sourceRoot, file), 'utf8'), context));
  vm.runInContext(fs.readFileSync(path.join(sourceRoot, 'background.js'), 'utf8'), context);
  const run = code => vm.runInContext(code, context);
  run('tabIdMap.set(1, 7)');
  return { context, chrome, messages, fetches, timers, sessionData, run,
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
  const w = worker({ fetch: async () => new Response(sse(data)) });
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

test('one overload continuation keeps slash/system context and merged reasoning', async () => {
  const overloaded = sse({ error: { code: 503, message: 'busy', metadata: { error_type: 'provider_overloaded' } } });
  const firstText = sse({ choices: [{ delta: { content: 'The quick brown fox', reasoning_details: [{ type: 'reasoning.summary', summary: 'First ', index: 0 }] } }] }) +
    sse({ choices: [{ delta: { reasoning_details: [{ type: 'reasoning.summary', summary: 'thought.', index: 0 }] } }] }) + overloaded;
  const secondText = ['b', 'rown ', 'fox ', 'jumps'].map(chunk => sse(delta(chunk))).join('') + sse('[DONE]');
  const w = worker({ settings: { apiProvider: 'openrouter', systemPrompt: 'Base rules' }, fetch: async (url, init, count) => new Response(count === 1 ? firstText : secondText) });
  const pending = w.call('source', { prompt: 'Slash task' });
  await tick();
  w.fire(1500);
  await settles(pending);
  assert.equal(w.fetches.length, 2);
  const retry = JSON.parse(w.fetches[1].body);
  assert.equal(retry.messages[0].content, 'Base rules\n\nSlash task');
  assert.equal(retry.messages[1].content, 'source');
  assert.equal(retry.messages[2].reasoning_details[0].summary, 'First thought.');
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

test('normal provider outcomes complete and overload retry remains limited to one', async () => {
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
  await tick();
  w.fire(1500);
  await settles(pending);
  assert.equal(w.fetches.length, 2);
  assert.equal(w.messages.filter(m => m.action === 'chatUnlock').length, 1);
});

test('retry terminal flush keeps an uncertain nonduplicate prefix', async () => {
  const w = worker({ settings: { apiProvider: 'openrouter' }, fetch: async (url, init, count) => new Response(count === 1
    ? sse(delta('The quick brown fox')) + sse({ error: { code: 503, message: 'busy', metadata: { error_type: 'provider_overloaded' } } })
    : ended('brown')) });
  const pending = w.call();
  await tick();
  w.fire(1500);
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

test('retries preserve signed reasoning block boundaries in subsequent follow-ups', async () => {
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
    w.fire(1500);
    await settles(pending);
    const assistant = w.messages.find(m => m.action === 'streamEnd').assistantMessage;
    const expected = [
      { ...common, text: 'First thought.', signature: 'first-signature' },
      { ...common, text: 'Second thought.', signature: 'second-signature' }, ...second.slice(-2)
    ];
    assert.deepEqual(assistant.reasoning_details, expected, 'different attempts are different signed blocks');
    assert.deepEqual(JSON.parse(w.fetches[1].body).messages[2].reasoning_details, expected.slice(0, 1), 'retry replays the first block unchanged');
    await w.call([{ role: 'user', content: 'source text' }, assistant, { role: 'user', content: 'Continue' }], { operationId: 'follow-up' });
    assert.deepEqual(JSON.parse(w.fetches[2].body).messages[2].reasoning_details, expected, 'later follow-ups replay each block unchanged');
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
  w.fire(1500);
  await settles(pending);
  assert.equal(w.messages.find(m => m.action === 'streamEnd')?.fullResponse, original + ' jumps');
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
