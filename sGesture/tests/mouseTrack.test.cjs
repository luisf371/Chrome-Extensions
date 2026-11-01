// Self-check for the mouse button logic in mouseTrack.js. Run: node --test sGesture/tests/mouseTrack.test.cjs
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const src = fs.readFileSync(path.join(__dirname, '..', 'mouseTrack.js'), 'utf8');

function load(options) {
  const listeners = {};
  const actions = [];
  const ctx2d = { clearRect() {}, beginPath() {}, moveTo() {}, lineTo() {}, stroke() {} };
  const store = Object.assign({ rocker: true, rockerRL: 'back', rockerLR: 'forward', D: 'closetab' }, options);
  const window = {
    innerWidth: 800,
    innerHeight: 600,
    addEventListener: (type, fn, capture) => {
      if (type !== 'resize') assert.strictEqual(capture, true, type + ' must use capture');
      listeners[type] = fn;
    },
    history: { back: () => actions.push('back'), forward: () => actions.push('forward') },
  };
  const document = {
    body: { appendChild() {} },
    createElement: () => ({ style: {}, getContext: () => ctx2d }),
  };
  const chrome = {
    runtime: { id: 'x', lastError: undefined, sendMessage: (m) => actions.push(m.msg) },
    storage: { local: { get: (keys, cb) => cb(Object.fromEntries([].concat(keys).map(k => [k, store[k]]))) } },
  };
  vm.runInNewContext(src, { window, document, chrome, console: { log() {}, warn() {}, error() {} } });
  const fire = (type, props) => {
    const ev = Object.assign({ isTrusted: true, button: 0, buttons: 0, clientX: 0, clientY: 0,
      target: { closest: () => null }, defaultPrevented: false,
      preventDefault() { this.defaultPrevented = true; }, stopPropagation() {} }, props);
    listeners[type](ev);
    return ev;
  };
  return { fire, actions };
}

test('link drag (no mouseup) does not turn the next right-click into a rocker', () => {
  const { fire, actions } = load();
  fire('mousedown', { button: 0, buttons: 1 }); // drag starts, mouseup is suppressed
  fire('mousedown', { button: 2, buttons: 2 });
  fire('mouseup', { button: 2, buttons: 0 });
  fire('contextmenu', { button: 2 });
  assert.deepStrictEqual(actions, []);
});

test('Mac/Linux context menu (no mouseup) does not turn the next left click into a rocker', () => {
  const { fire, actions } = load();
  fire('mousedown', { button: 2, buttons: 2 });
  const menu = fire('contextmenu', { button: 2 });
  assert.strictEqual(menu.defaultPrevented, false, 'native menu must still open');
  fire('mousedown', { button: 0, buttons: 1 });
  fire('mouseup', { button: 0, buttons: 0 });
  assert.deepStrictEqual(actions, []);
});

test('stale right state is cleared by a mousemove without the right button', () => {
  const { fire, actions } = load();
  fire('mousedown', { button: 2, buttons: 2, clientX: 100, clientY: 100 });
  fire('mousemove', { buttons: 0, clientX: 100, clientY: 200 }); // mouseup was swallowed
  fire('mouseup', { button: 2, buttons: 0, clientX: 100, clientY: 200 });
  assert.deepStrictEqual(actions, []);
});

test('real rockers still fire', () => {
  const rl = load();
  rl.fire('mousedown', { button: 2, buttons: 2 });
  assert.strictEqual(rl.fire('mousedown', { button: 0, buttons: 3 }).defaultPrevented, true);
  rl.fire('mouseup', { button: 2, buttons: 1 });
  assert.strictEqual(rl.fire('contextmenu', { button: 2 }).defaultPrevented, true);
  assert.deepStrictEqual(rl.actions, ['back']);

  const lr = load();
  lr.fire('mousedown', { button: 0, buttons: 1 });
  lr.fire('mousedown', { button: 2, buttons: 3 });
  assert.deepStrictEqual(lr.actions, ['forward']);
});

test('rockers are off unless enabled', () => {
  const { fire, actions } = load({ rocker: false });
  fire('mousedown', { button: 2, buttons: 2 });
  fire('mousedown', { button: 0, buttons: 3 });
  assert.deepStrictEqual(actions, []);
});

test('a right-drag gesture runs its action and suppresses the menu', () => {
  const { fire, actions } = load();
  fire('mousedown', { button: 2, buttons: 2, clientX: 100, clientY: 100 });
  fire('mousemove', { buttons: 2, clientX: 100, clientY: 200 });
  fire('mouseup', { button: 2, buttons: 0, clientX: 100, clientY: 200 });
  assert.strictEqual(fire('contextmenu', { button: 2 }).defaultPrevented, true);
  assert.deepStrictEqual(actions, ['closetab']);
});

test('synthetic events are ignored', () => {
  const { fire, actions } = load();
  fire('mousedown', { isTrusted: false, button: 2, buttons: 2, clientX: 100, clientY: 100 });
  fire('mousemove', { isTrusted: false, buttons: 2, clientX: 100, clientY: 200 });
  fire('mouseup', { isTrusted: false, button: 2, buttons: 0 });
  assert.deepStrictEqual(actions, []);
});
