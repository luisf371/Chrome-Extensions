const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'options.js'), 'utf8').replace(/\r\n/g, '\n');
function actualFunction(name) {
  const start = source.indexOf(`  function ${name}(`);
  assert.ok(start >= 0, `Missing production function ${name}`);
  return source.slice(start, source.indexOf('\n  }', start) + 4);
}
function options(fetch, values = {}) {
  const timers = new Map();
  let timerId = 0, click;
  const statusDiv = { dataset: {}, style: {}, textContent: '' };
  const button = { disabled: false, addEventListener(name, fn) { click = fn; } };
  const settings = { apiProvider: 'openai', apiUrl: 'https://api.openai.com/v1/chat/completions', apiKey: 'synthetic-key', model: 'gpt-test', ...values };
  const context = vm.createContext({ URL, AbortController, console, fetch, statusDiv, statusTimeout: null, chrome: { i18n: { getMessage: () => '' } },
    showToast() {}, window: { confirm: () => true }, document: { getElementById: () => button },
    getFormValues: () => ({ ...settings }), getResolvedApiUrl: values => values.apiUrl,
    validateApiUrl: () => true, validateApiKey: () => true, validateModel: () => true, validateAzureConfig: () => true,
    setTimeout(fn, ms) { const id = ++timerId; timers.set(id, { fn, ms }); return id; }, clearTimeout(id) { timers.delete(id); }
  });
  vm.runInContext(fs.readFileSync(path.join(root, 'shared/error-utils.js'), 'utf8'), context);
  for (const name of ['buildTestConnectionRequest', 'showStatus', 'setupTestConnection']) vm.runInContext(actualFunction(name), context);
  // Include the response validator if this revision defines one.
  if (source.includes('  function validateTestConnectionResponse(')) vm.runInContext(actualFunction('validateTestConnectionResponse'), context);
  context.setupTestConnection();
  return { context, timers, button, statusDiv, click: () => click(),
    fire(ms) { for (const [id, timer] of [...timers]) if (timer.ms === ms) { timers.delete(id); timer.fn(); } }
  };
}
const tick = () => new Promise(resolve => setImmediate(resolve));
const good = { choices: [{ message: { role: 'assistant', content: '1' }, finish_reason: 'stop' }] };
function stalledBody(signal, status) {
  return new Response(new ReadableStream({ start(controller) { signal.addEventListener('abort', () => controller.error(signal.reason)); } }), { status });
}

test('probe validates actual provider results and describes only the non-streaming check', async () => {
  for (const [apiProvider, body] of [
    ['openai', good], ['openrouter', good], ['azure', good], ['groq', good], ['perplexity', good], ['glm', good],
    ['anthropic', { type: 'message', role: 'assistant', content: [{ type: 'text', text: '1' }], stop_reason: 'end_turn' }],
    ['gemini', { candidates: [{ content: { parts: [{ text: '1' }] }, finishReason: 'STOP' }] }]
  ]) {
    const response = Response.json(body);
    const app = options(async () => response, { apiProvider });
    await app.click();
    assert.equal(response.bodyUsed, true);
    assert.equal(app.statusDiv.dataset.type, 'success', apiProvider);
    assert.match(app.statusDiv.textContent, /non.streaming/i);
    assert.equal(app.button.disabled, false);
    assert.equal([...app.timers.values()].filter(t => t.ms === 30000).length, 0);
  }
});

test('probe rejects malformed, empty, failed, truncated and provider-error success bodies', async () => {
  for (const [apiProvider, response] of [
    ['openrouter', Response.json({ error: { code: 503, message: 'provider unavailable' } })],
    ['openai', new Response('<html>proxy</html>')], ['openai', new Response(null, { status: 204 })],
    ['openai', Response.json({})], ['openai', Response.json({ choices: [{ message: { content: '' }, finish_reason: 'stop' }] })],
    ['openai', Response.json({ choices: { 0: good.choices[0] } })],
    ['openai', Response.json({ choices: [{ message: { content: 'partial' }, finish_reason: 'length' }] })],
    ['openai', new Response(new ReadableStream({ start(controller) { controller.error(new Error('body reset')); } }))],
    ['anthropic', Response.json({ content: [{ type: 'text', text: '1' }], stop_reason: 'max_tokens' })],
    ['anthropic', Response.json({ type: 'message', role: 'assistant', content: [{ type: 'text', text: 'Declined' }], stop_reason: 'end_turn', stop_details: { type: 'refusal' } })],
    ['gemini', Response.json({ promptFeedback: { blockReason: 'SAFETY' } })],
    ['gemini', Response.json({ candidates: [{ content: { parts: [{ text: 'blocked' }] }, finishReason: 'SAFETY' }] })]
  ]) {
    const app = options(async () => response, { apiProvider });
    await app.click();
    assert.equal(app.statusDiv.dataset.type, 'error', `${apiProvider}: ${app.statusDiv.textContent}`);
    assert.equal(app.button.disabled, false);
  }
});

test('probe deadline covers success and error bodies while preserving HTTP status', async () => {
  for (const status of [200, 503]) {
    let signal;
    const app = options(async (url, init) => { signal = init.signal; return stalledBody(signal, status); });
    const pending = app.click();
    await tick();
    assert.equal(app.button.disabled, true, 'headers alone cannot complete the probe');
    assert.equal([...app.timers.values()].some(t => t.ms === 30000), true, 'body read retains deadline');
    app.fire(30000);
    await pending;
    assert.equal(signal.aborted, true);
    assert.equal(app.button.disabled, false);
    assert.equal(app.statusDiv.dataset.type, 'error');
    assert.match(app.statusDiv.textContent, status === 503 ? /503|unavailable/i : /timed out/i);
  }
});

test('network failures clear the probe timer', async () => {
  const app = options(async () => { throw new TypeError('Failed to fetch'); });
  await app.click();
  assert.equal([...app.timers.values()].some(t => t.ms === 30000), false);
  assert.equal(app.button.disabled, false);
});

test('direct OpenAI reasoning probes use a supported budget without changing other providers', () => {
  const app = options(async () => Response.json(good));
  for (const model of ['o1', 'o3', 'o3-mini', 'o4-mini', 'o3-2025-04-16', 'gpt-5.2']) {
    const body = JSON.parse(app.context.buildTestConnectionRequest({ apiProvider: 'openai', apiUrl: 'https://api.openai.com/v1/chat/completions', model }).fetchOptions.body);
    assert.equal(Object.hasOwn(body, 'max_tokens'), false, model);
    assert.ok(body.max_completion_tokens >= 1024, 'budget must leave room for reasoning');
  }
  for (const apiProvider of ['azure', 'groq', 'perplexity', 'glm', 'anthropic']) {
    const body = JSON.parse(app.context.buildTestConnectionRequest({ apiProvider, apiUrl: 'https://example.invalid', model: 'o3' }).fetchOptions.body);
    assert.equal(body.max_tokens, 20, apiProvider);
    assert.equal(Object.hasOwn(body, 'max_completion_tokens'), false);
  }
  const openrouter = disable => JSON.parse(app.context.buildTestConnectionRequest({ apiProvider: 'openrouter', apiUrl: 'https://example.invalid', model: 'o3', openrouterDisableReasoning: disable }).fetchOptions.body);
  assert.equal(openrouter(false).max_tokens, 1024, 'reasoning needs room before visible text');
  assert.equal(openrouter(true).max_tokens, 20);
  assert.deepEqual(openrouter(true).reasoning, { effort: 'none' });
  const anthropic = app.context.buildTestConnectionRequest({ apiProvider: 'anthropic', apiUrl: 'https://api.anthropic.com/v1/messages', apiKey: 'k', model: 'claude' });
  assert.equal(anthropic.fetchOptions.headers['anthropic-dangerous-direct-browser-access'], 'true');
});

test('replaced info and success timers cannot hide a persistent error', () => {
  const app = options(async () => Response.json(good));
  for (const type of ['info', 'success']) {
    app.context.showStatus('Previous status', type);
    app.context.showStatus('Authentication failed', 'error');
    app.fire(3000);
    assert.equal(app.statusDiv.style.display, 'block');
    assert.equal(app.statusDiv.dataset.type, 'error');
  }
});

test('probe requests match real requests for Anthropic, Gemini and GLM', () => {
  const app = options(async () => Response.json(good));
  const build = values => app.context.buildTestConnectionRequest(values);
  const anthropic = build({ apiProvider: 'anthropic', apiUrl: 'https://api.anthropic.com/v1/messages', apiKey: 'k', model: 'claude-sonnet-4-6' });
  assert.equal(anthropic.fetchOptions.headers['anthropic-dangerous-direct-browser-access'], 'true');
  for (const [model, expected] of [['models/gemini-2.5-flash', 'gemini-2.5-flash'], ['gemini-x?y', 'gemini-x%3Fy']]) {
    assert.equal(build({ apiProvider: 'gemini', apiKey: 'k', model }).fetchUrl,
      `https://generativelanguage.googleapis.com/v1beta/models/${expected}:generateContent`);
  }
  const glm = JSON.parse(build({ apiProvider: 'glm', apiUrl: 'https://api.z.ai/api/coding/paas/v4/chat/completions', apiKey: 'k', model: 'glm-5' }).fetchOptions.body);
  assert.deepEqual({ ...glm.thinking }, { type: 'disabled' });
  assert.equal(glm.max_tokens, 20);
  assert.equal(Object.hasOwn(JSON.parse(build({ apiProvider: 'groq', apiUrl: 'https://x', apiKey: 'k', model: 'm' }).fetchOptions.body), 'thinking'), false);
});
