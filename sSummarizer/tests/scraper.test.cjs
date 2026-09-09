const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

const source = fs.readFileSync(path.resolve(__dirname, '../scripts/content-scraper.js'), 'utf8');
const tick = () => new Promise(resolve => setImmediate(resolve));
const bodies = ['"INNERTUBE_API_KEY":"test"', JSON.stringify({ captions: { playerCaptionsTracklistRenderer: { captionTracks: [{ baseUrl: 'https://example.invalid/captions', languageCode: 'en' }] } } }), '<transcript/>'];
function scraper({ heldRequest = 0, holdBody = false, reddit = false, status = 200 } = {}) {
  const timers = new Map(), requests = [];
  let timerId = 0;
  const document = { querySelector: selector => /h1/.test(selector) ? { textContent: 'Local title' } : null, querySelectorAll: () => [], body: { innerText: 'Local page text' } };
  const context = vm.createContext({ URL, AbortController, console: { log() {}, warn() {}, error() {} }, document,
    window: { location: { href: reddit ? 'https://www.reddit.com/r/test/comments/123/title/' : 'https://www.youtube.com/watch?v=abcdefghijk' } },
    chrome: { storage: { local: { get(defaults, callback) { callback({ ...defaults, redditSort: 'top' }); } } } },
    setTimeout(fn, ms) { const id = ++timerId; timers.set(id, { fn, ms }); return id; }, clearTimeout(id) { timers.delete(id); },
    fetch: async (url, init = {}) => {
      init.signal?.throwIfAborted();
      const index = requests.push({ url, ...init }) - 1;
      if (index !== heldRequest) return new Response(bodies[index]);
      if (holdBody) return new Response(new ReadableStream({ start(controller) { init.signal?.addEventListener('abort', () => controller.error(init.signal.reason)); } }), { status });
      return new Promise((resolve, reject) => init.signal?.addEventListener('abort', () => reject(init.signal.reason)));
    }
  });
  vm.runInContext(source, context);
  return { context, timers, requests, start: id => reddit ? context.extractRedditThread(id) : context.extractYouTubeCaptions(id),
    fire() { for (const [id, timer] of [...timers]) { timers.delete(id); timer.fn(); } }
  };
}

for (const reddit of [false, true]) for (const heldRequest of reddit ? [0] : [0, 1, 2]) for (const holdBody of [false, true]) {
  test(`${reddit ? 'Reddit' : 'YouTube'} request ${heldRequest + 1} ${holdBody ? 'body' : 'headers'} deadline aborts and returns local fallback`, async () => {
    const app = scraper({ heldRequest, holdBody, reddit });
    const pending = app.start('operation-1');
    for (let i = 0; i < 5; i++) await tick();
    assert.equal(app.requests.length, heldRequest + 1);
    assert.ok(app.requests.at(-1).signal, 'source request has cancellation signal');
    assert.equal(app.timers.size, 1, 'one deadline covers the complete source operation');
    app.fire();
    assert.match(await pending, /Local title/);
    assert.equal(app.requests.at(-1).signal.aborted, true);
    assert.equal(app.timers.size, 0);
  });
}

test('Stop cancels only the matching extraction and reinjection preserves active controllers', async () => {
  const app = scraper();
  const pending = app.start('operation-1');
  await tick();
  assert.equal(typeof app.context.cancelContentExtraction, 'function');
  vm.runInContext(source, app.context);
  app.context.cancelContentExtraction('unrelated-operation');
  assert.equal(app.requests[0].signal.aborted, false);
  app.context.cancelContentExtraction('operation-1');
  assert.equal(app.requests[0].signal.aborted, true);
  assert.match(await pending, /Local title/);
  app.fire(); // An early Stop for an unknown operation expires on the source deadline.
  assert.equal(app.timers.size, 0);
});

test('Stop arriving before extractor registration prevents source transmission', async () => {
  const app = scraper();
  app.context.cancelContentExtraction('operation-1');
  assert.match(await app.start('operation-1'), /Local title/);
  assert.equal(app.requests.length, 0);
  assert.equal(app.timers.size, 0);
});

test('HTTP source failures abort unread bodies before returning the local fallback', async () => {
  for (const reddit of [false, true]) {
    const app = scraper({ reddit, holdBody: true, status: 503 });
    assert.match(await app.start('operation-1'), /Local title/);
    assert.equal(app.requests[0].signal.aborted, true);
    assert.equal(app.timers.size, 0);
  }
});
