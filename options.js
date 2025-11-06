'use strict';

const DEFAULT_SETTINGS = Object.freeze({
   tabsBehaviour: 'default',
   tabsActivate: 'last_used',
   tabsOpenMethod: 'default'
});

const SETTING_SELECTORS = [
   { key: 'tabsBehaviour', selector: '#tabsBehaviour' },
   { key: 'tabsActivate', selector: '#tabsActivate' },
   { key: 'tabsOpenMethod', selector: '#tabsOpenMethod' }
];

$(document).ready(() => {
   init().catch(console.error);
});

async function init() {
   await migrateLegacyPreferences();
   const settings = await loadSettings();
   applySettings(settings);
   registerHandlers();
}

async function migrateLegacyPreferences() {
   const legacyValues = {};
   let hasLegacyData = false;
   for (const key of Object.keys(DEFAULT_SETTINGS)) {
      const value = window.localStorage.getItem(key);
      if (value !== null) {
         legacyValues[key] = value;
         hasLegacyData = true;
      }
   }
   if (!hasLegacyData) return;
   const current = await chrome.storage.sync.get(Object.keys(DEFAULT_SETTINGS));
   const updates = {};
   for (const [key, value] of Object.entries(legacyValues)) {
      if (!Object.prototype.hasOwnProperty.call(current, key)) {
         updates[key] = value;
      }
      window.localStorage.removeItem(key);
   }
   if (Object.keys(updates).length > 0) {
      await chrome.storage.sync.set(updates);
   }
}

async function loadSettings() {
   const stored = await chrome.storage.sync.get(DEFAULT_SETTINGS);
   return { ...DEFAULT_SETTINGS, ...stored };
}

function applySettings(settings) {
   for (const { key, selector } of SETTING_SELECTORS) {
      const value = settings[key] || DEFAULT_SETTINGS[key];
      $(selector).val(value);
   }
}

function registerHandlers() {
   for (const { key, selector } of SETTING_SELECTORS) {
      $(selector).on('change', async function handleChange() {
         const value = $(this).val();
         await chrome.storage.sync.set({ [key]: value });
      });
   }
}
