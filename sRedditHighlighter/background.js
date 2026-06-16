/**
 * Reddit New Comments Highlighter - Service Worker
 * MV3 Background Script
 */

const DEFAULT_SETTINGS = {
  maxHistory: 10000,
  highlightColor: '#FFFDCC',
  darkModeColor: '#3d3d00',
  useSystemTheme: false,
  useDarkTheme: false,
  autoChangeTheme: false,
  themeStartTime: '18:00',
  themeEndTime: '08:00',
};

// Initialize default settings on install
chrome.runtime.onInstalled.addListener(async (details) => {
  if (details.reason === 'install') {
    await chrome.storage.local.set({ settings: DEFAULT_SETTINGS, threads: {} });
    console.log('[RNCH] Extension installed, defaults set');
  }
});

// Handle messages from content scripts
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'UPDATE_BADGE') {
    updateBadge(sender.tab?.id, message.count);
    sendResponse({ success: true });
  } else if (message.type === 'GET_SETTINGS') {
    getSettings().then(sendResponse);
    return true; // Keep channel open for async response
  } else if (message.type === 'GET_THREAD_DATA') {
    getThreadData(message.threadId).then(sendResponse);
    return true;
  } else if (message.type === 'SAVE_THREAD_DATA') {
    saveThreadData(message.threadId, message.data).then(sendResponse);
    return true;
  }
});

// Update badge with new comment count
function updateBadge(tabId, count) {
  if (!tabId) return;
  
  const text = count > 0 ? (count > 999 ? '999+' : String(count)) : '';
  const color = count > 0 ? '#4CAF50' : '#666666';
  
  chrome.action.setBadgeText({ text, tabId }).catch(() => {});
  chrome.action.setBadgeBackgroundColor({ color, tabId }).catch(() => {});
}

// Get settings with defaults
async function getSettings() {
  const { settings = DEFAULT_SETTINGS } = await chrome.storage.local.get('settings');
  return { ...DEFAULT_SETTINGS, ...settings };
}

// Get thread-specific data
async function getThreadData(threadId) {
  const { threads = {} } = await chrome.storage.local.get('threads');
  return threads[threadId] ?? null;
}

// Save thread data with automatic pruning
async function saveThreadData(threadId, data) {
  const { threads = {}, settings = DEFAULT_SETTINGS } = await chrome.storage.local.get(['threads', 'settings']);
  
  // Add/update the thread
  threads[threadId] = {
    ...data,
    lastVisit: Date.now(),
  };
  
  // Prune old entries if over limit
  const threadIds = Object.keys(threads);
  if (threadIds.length > settings.maxHistory) {
    // Sort by lastVisit and remove oldest
    const sorted = threadIds
      .map(id => ({ id, lastVisit: threads[id].lastVisit }))
      .sort((a, b) => b.lastVisit - a.lastVisit);
    
    const toKeep = new Set(sorted.slice(0, settings.maxHistory).map(t => t.id));
    
    for (const id of threadIds) {
      if (!toKeep.has(id)) {
        delete threads[id];
      }
    }
  }
  
  await chrome.storage.local.set({ threads });
  return { success: true };
}

// Clear badge when tab is closed or navigated away
chrome.tabs.onRemoved.addListener((tabId) => {
  chrome.action.setBadgeText({ text: '', tabId }).catch(() => {});
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status === 'loading') {
    chrome.action.setBadgeText({ text: '', tabId }).catch(() => {});
  }
});
