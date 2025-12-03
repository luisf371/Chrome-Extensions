'use strict';

const DEFAULT_SETTINGS = Object.freeze({
   tabsBehaviour: 'default',
   tabsActivate: 'last_used',
   tabsOpenMethod: 'default'
});

const windowState = new Map();
let settingsCache = { ...DEFAULT_SETTINGS };
const sessionStorageAvailable = Boolean(chrome.storage && chrome.storage.session);
let readyPromise = bootstrap().catch(handleStartupError);

chrome.storage.onChanged.addListener((changes, areaName) => {
   if (areaName !== 'sync') return;
   for (const [key, change] of Object.entries(changes)) {
      const newValue = change.newValue !== undefined ? change.newValue : DEFAULT_SETTINGS[key];
      settingsCache[key] = newValue;
   }
});

chrome.tabs.onCreated.addListener(tab => {
   handleTabCreated(tab).catch(handleRuntimeError);
});
chrome.tabs.onActivated.addListener(activeInfo => {
   handleTabActivated(activeInfo).catch(handleRuntimeError);
});
chrome.tabs.onRemoved.addListener((tabId, removeInfo) => {
   handleTabRemoved(tabId, removeInfo).catch(handleRuntimeError);
});
chrome.tabs.onMoved.addListener((tabId, moveInfo) => {
   handleTabMoved(tabId, moveInfo).catch(handleRuntimeError);
});
chrome.tabs.onDetached.addListener((tabId, detachInfo) => {
   handleTabDetached(tabId, detachInfo).catch(handleRuntimeError);
});
chrome.tabs.onAttached.addListener((tabId, attachInfo) => {
   handleTabAttached(tabId, attachInfo).catch(handleRuntimeError);
});

async function bootstrap() {
   console.log('[sTabControl] Bootstrap sequence started.');
   try {
      await ensureDefaults();
      console.log('[sTabControl] Defaults ensured.');
      await loadSettings();
      console.log('[sTabControl] Settings loaded.');
      await restoreSessionState();
      console.log('[sTabControl] Session state restored.');
      await rebuildStateFromWindows();
      console.log('[sTabControl] State rebuilt from windows. Bootstrap complete.');
   } catch (error) {
      console.error('Bootstrap failed:', error);
      throw error;
   }
}

async function ensureDefaults() {
   const stored = await chrome.storage.sync.get(Object.keys(DEFAULT_SETTINGS));
   const updates = {};
   for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
      if (!Object.prototype.hasOwnProperty.call(stored, key)) {
         updates[key] = value;
      }
   }
   if (Object.keys(updates).length > 0) {
      await chrome.storage.sync.set(updates);
   }
}

async function loadSettings() {
   const stored = await chrome.storage.sync.get(DEFAULT_SETTINGS);
   settingsCache = { ...DEFAULT_SETTINGS, ...stored };
}

async function restoreSessionState() {
   if (!sessionStorageAvailable) return;
   try {
      const stored = await chrome.storage.session.get('windowState');
      const rawState = stored.windowState || {};
      for (const [windowIdString, entry] of Object.entries(rawState)) {
         const windowId = Number(windowIdString);
         windowState.set(windowId, {
            order: Array.isArray(entry.order) ? [...entry.order] : [],
            activeTabId: Number.isInteger(entry.activeTabId) ? entry.activeTabId : null,
            activeTabIndex: Number.isInteger(entry.activeTabIndex) ? entry.activeTabIndex : 0,
            fromRemoval: false
         });
      }
   } catch (error) {
      console.error('Failed to restore session state', error);
   }
}

async function persistSessionState() {
   if (!sessionStorageAvailable) return;
   const serialised = {};
   for (const [windowId, state] of windowState.entries()) {
      serialised[windowId] = {
         order: [...state.order],
         activeTabId: state.activeTabId,
         activeTabIndex: state.activeTabIndex
      };
   }
   try {
      await chrome.storage.session.set({ windowState: serialised });
   } catch (error) {
      console.error('Failed to persist session state', error);
   }
}

async function rebuildStateFromWindows() {
   const windows = await chrome.windows.getAll({ populate: true });
   const openWindowIds = new Set();
   for (const win of windows) {
      const tabs = Array.isArray(win.tabs) ? win.tabs : [];
      openWindowIds.add(win.id);
      const state = getOrCreateWindowState(win.id);
      const openTabIds = new Set(tabs.map(tab => tab.id));
      state.order = state.order.filter(tabId => openTabIds.has(tabId));
      for (const tab of tabs) {
         if (!state.order.includes(tab.id)) {
            state.order.push(tab.id);
         }
         if (tab.active) {
            state.activeTabId = tab.id;
            state.activeTabIndex = tab.index;
         }
      }
   }
   for (const windowId of [...windowState.keys()]) {
      if (!openWindowIds.has(windowId)) {
         windowState.delete(windowId);
      }
   }
   await persistSessionState();
}

async function handleTabCreated(tab) {
   await waitForReady();
   const state = getOrCreateWindowState(tab.windowId);
   removeTabFromState(state, tab.id);
   state.order.push(tab.id);

   if (!state.fromRemoval) {
      await repositionTab(tab);
   }

   if (state.fromRemoval || settingsCache.tabsOpenMethod === 'foreground') {
      await activateTab(tab.id);
   } else if (settingsCache.tabsOpenMethod === 'background') {
      const url = typeof tab.url === 'string' ? tab.url : '';
      if (!url.startsWith('chrome') && state.activeTabId && state.activeTabId !== tab.id) {
         await activateTab(state.activeTabId);
      }
   }

   state.fromRemoval = false;
   await persistSessionState();
}

async function repositionTab(tab) {
   if (tab.pinned) return;
   switch (settingsCache.tabsBehaviour) {
      case 'first': {
         const index = await countPinnedTabs(tab.windowId);
         await moveTab(tab.id, index);
         break;
      }
      case 'last':
         await moveTab(tab.id, -1);
         break;
      case 'left':
      case 'right': {
         const activeTab = await getActiveTab(tab.windowId);
         if (!activeTab) return;
         let targetIndex = activeTab.index;
         if (settingsCache.tabsBehaviour === 'right') targetIndex += 1;
         const pinnedCount = await countPinnedTabs(tab.windowId);
         if (targetIndex < pinnedCount) targetIndex = pinnedCount;
         await moveTab(tab.id, targetIndex);
         break;
      }
      default:
         break;
   }
}

async function handleTabActivated(activeInfo) {
   await waitForReady();
   const tab = await chrome.tabs.get(activeInfo.tabId);
   const state = getOrCreateWindowState(activeInfo.windowId);
   const trackedIndex = state.order.indexOf(activeInfo.tabId);
   if (!state.fromRemoval) {
      if (trackedIndex !== -1) {
         state.order.splice(trackedIndex, 1);
      }
      state.order.unshift(activeInfo.tabId);
   } else if (trackedIndex === -1) {
      state.order.unshift(activeInfo.tabId);
   }

   state.activeTabId = activeInfo.tabId;
   state.activeTabIndex = tab.index;
   state.fromRemoval = false;
   await persistSessionState();
}

async function handleTabRemoved(tabId, removeInfo) {
   await waitForReady();
   const windowId = removeInfo.windowId;
   const state = getOrCreateWindowState(windowId);
   const wasActive = state.activeTabId === tabId;
   removeTabFromState(state, tabId);

   if (removeInfo.isWindowClosing) {
      windowState.delete(windowId);
      await persistSessionState();
      return;
   }

   if (wasActive) {
      state.fromRemoval = true;
      await handlePostRemovalActivation(windowId, state);
   } else {
      state.fromRemoval = false;
   }

   await persistSessionState();
}

async function handlePostRemovalActivation(windowId, state) {
   switch (settingsCache.tabsActivate) {
      case 'last_used': {
         const tabs = await chrome.tabs.query({ windowId });
         const openIds = new Set(tabs.map(tab => tab.id));
         const targetId = state.order.find(id => openIds.has(id));
         if (targetId !== undefined) {
            await activateTab(targetId);
         }
         break;
      }
      case 'left':
      case 'right': {
         const tabs = await chrome.tabs.query({ windowId });
         if (!tabs.length) return;
         let targetIndex = settingsCache.tabsActivate === 'left'
            ? Math.max(state.activeTabIndex - 1, 0)
            : Math.min(state.activeTabIndex, tabs.length - 1);
         const targetTab = tabs[targetIndex] || tabs[tabs.length - 1];
         if (targetTab) {
            await activateTab(targetTab.id);
         }
         break;
      }
      default:
         break;
   }
}

async function handleTabMoved(tabId, moveInfo) {
   await waitForReady();
   const state = getOrCreateWindowState(moveInfo.windowId);
   if (state.activeTabId === tabId) {
      state.activeTabIndex = moveInfo.toIndex;
      await persistSessionState();
   }
}

async function handleTabDetached(tabId, detachInfo) {
   await waitForReady();
   const state = windowState.get(detachInfo.oldWindowId);
   if (!state) return;
   removeTabFromState(state, tabId);
   state.activeTabId = state.activeTabId === tabId ? null : state.activeTabId;
   await persistSessionState();
}

async function handleTabAttached(tabId, attachInfo) {
   await waitForReady();
   const state = getOrCreateWindowState(attachInfo.newWindowId);
   if (!state.order.includes(tabId)) {
      const insertionIndex = Math.min(Math.max(attachInfo.newPosition, 0), state.order.length);
      state.order.splice(insertionIndex, 0, tabId);
   }
   await persistSessionState();
}

async function countPinnedTabs(windowId) {
   const tabs = await chrome.tabs.query({ windowId, pinned: true });
   return tabs.length;
}

async function getActiveTab(windowId) {
   const tabs = await chrome.tabs.query({ windowId, active: true });
   return tabs[0];
}

async function moveTab(tabId, index) {
   try {
      await chrome.tabs.move(tabId, { index });
   } catch (error) {
      logIgnorableError(error);
   }
}

async function activateTab(tabId) {
   try {
      await chrome.tabs.update(tabId, { active: true });
   } catch (error) {
      logIgnorableError(error);
   }
}

function getOrCreateWindowState(windowId) {
   if (!windowState.has(windowId)) {
      windowState.set(windowId, {
         order: [],
         activeTabId: null,
         activeTabIndex: 0,
         fromRemoval: false
      });
   }
   return windowState.get(windowId);
}

async function waitForReady() {
   if (readyPromise) {
      try {
         await readyPromise;
      } catch (error) {
         console.error('waitForReady failed:', error);
         // Re-throw to prevent operations during failed state
         throw error;
      }
   }
}

function removeTabFromState(state, tabId) {
   const index = state.order.indexOf(tabId);
   if (index !== -1) {
      state.order.splice(index, 1);
   }
}

function handleRuntimeError(error) {
   if (isIgnorableError(error)) {
      console.warn('[sTabControl] Ignorable runtime error:', error.message);
      return;
   }
   console.error('[sTabControl] Unhandled runtime error:', error);
}

function handleStartupError(error) {
   console.error('[sTabControl] Critical startup error:', error);
   // Don't re-throw startup errors to prevent extension crash
}

function isIgnorableError(error) {
   if (!error) return false;
   const message = error.message || String(error);
   return message.includes('No tab with id') ||
      message.includes('Tabs cannot be edited right now') ||
      message.includes('Invalid tab ID') ||
      message.includes('The tab was closed');
}


chrome.action.onClicked.addListener(() => {
   chrome.runtime.openOptionsPage();
});
