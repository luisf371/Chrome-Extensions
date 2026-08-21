'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function loadOptions(storedIds) {
  let saved = null;
  const context = {
    document: { addEventListener() {} },
    chrome: {
      storage: {
        local: {
          get: async () => ({ optionsCollapsedGroups: storedIds }),
          set: async (value) => { saved = value; }
        },
        onChanged: { addListener() {} }
      }
    }
  };
  context.globalThis = context;

  const filename = path.join(__dirname, '..', 'options.js');
  const source = fs.readFileSync(filename, 'utf8').replace(
    '// --- Init ---',
    'globalThis.__collapseTest = { collapsedGroups, loadCollapsedGroups, saveCollapsedGroups };\n\n// --- Init ---'
  );
  vm.runInNewContext(source, context, { filename });
  return { ...context.__collapseTest, getSaved: () => saved };
}

test('options page restores and saves collapsed playlist groups', async () => {
  const actions = loadOptions(['profile', '', 42, 'profile', 'work']);

  await actions.loadCollapsedGroups();
  assert.deepEqual(Array.from(actions.collapsedGroups), ['profile', 'work']);

  actions.collapsedGroups.delete('profile');
  actions.collapsedGroups.add('music');
  await actions.saveCollapsedGroups();
  assert.deepEqual(Array.from(actions.getSaved().optionsCollapsedGroups), ['work', 'music']);
});
