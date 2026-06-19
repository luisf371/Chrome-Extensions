const commands = {
  newtab: async () => {
    await chrome.tabs.create({});
    return "tab open";
  },
  openurl: async (request) => {
    const url = request && request.url;
    // Only allow http(s) links; block javascript:/data:/chrome: schemes.
    if (typeof url !== "string" || !/^https?:\/\//i.test(url.trim())) {
      return "blocked invalid url";
    }
    await chrome.tabs.create({ url: url });
    return "tab opened";
  },
  closetab: async () => {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tabs.length > 0) {
      await chrome.tabs.remove(tabs[0].id);
      return "tab closed";
    }
    return "no active tab to close";
  },
  colorCode: async () => {
    const result = await chrome.storage.local.get("colorCode");
    return result.colorCode;
  },
  width: async () => {
    const result = await chrome.storage.local.get("width");
    return result.width;
  },
  gests: async () => {
    const items = await chrome.storage.local.get(null);
    const gests = {};
    for (const key in items) {
      if (key === "colorCode" || key === "width") continue;
      gests[key] = items[key];
    }
    return gests;
  },
  rocker: async () => {
    const result = await chrome.storage.local.get("rocker");
    return result.rocker;
  },
  trail: async () => {
    const result = await chrome.storage.local.get("trail");
    return result.trail;
  },
  lasttab: async () => {
    const sessions = await chrome.sessions.getRecentlyClosed({ maxResults: 1 });
    if (sessions.length > 0 && sessions[0].tab) {
      const url = sessions[0].tab.url;
      // Basic validation: prevent reopening chrome:// or javascript: URLs directly if problematic, 
      // though chrome.tabs.create usually handles them safely or errors out.
      // We'll proceed but this is the place to add logic if needed.
      await chrome.tabs.create({ url: url });
      return "tab opened";
    }
    return "no recently closed tab found";
  },
  reloadall: async () => {
    const tabs = await chrome.tabs.query({});
    if (tabs.length > 0) {
      await Promise.all(tabs.map(tab => chrome.tabs.reload(tab.id)));
      return "tabs reloaded";
    }
    return "no tabs to reload";
  },
  nexttab: async () => {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tabs.length > 0) {
      const currentTab = tabs[0];
      const allTabs = await chrome.tabs.query({ currentWindow: true });
      if (allTabs.length > 1) {
        const currentIndex = allTabs.findIndex(tab => tab.id === currentTab.id);
        const nextIndex = (currentIndex + 1) % allTabs.length;
        await chrome.tabs.update(allTabs[nextIndex].id, { active: true });
        return "tab switched";
      }
      return "only one tab open";
    }
    return "no active tab";
  },
  prevtab: async () => {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tabs.length > 0) {
      const currentTab = tabs[0];
      const allTabs = await chrome.tabs.query({ currentWindow: true });
      if (allTabs.length > 1) {
        const currentIndex = allTabs.findIndex(tab => tab.id === currentTab.id);
        const prevIndex = (currentIndex - 1 + allTabs.length) % allTabs.length;
        await chrome.tabs.update(allTabs[prevIndex].id, { active: true });
        return "tab switched";
      }
      return "only one tab open";
    }
    return "no active tab";
  },
  closeback: async () => {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tabs.length > 0) {
      const activeTab = tabs[0];
      const allTabs = await chrome.tabs.query({ currentWindow: true });
      const idsToRemove = allTabs
        .filter(tab => tab.id !== activeTab.id)
        .map(tab => tab.id);
      
      if (idsToRemove.length > 0) {
        await chrome.tabs.remove(idsToRemove);
        return "background closed";
      }
      return "no background tabs";
    }
    return "no active tab";
  },
  closeall: async () => {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tabs.length > 0) {
      await chrome.windows.remove(tabs[0].windowId);
      return "window closed";
    }
    return "no window to close";
  },
  ping: async () => {
    return "pong";
  }
};

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  console.log('Received message:', request.msg);
  
  const handler = commands[request.msg];
  if (handler) {
    handler(request)
      .then(resp => sendResponse({ resp }))
      .catch(error => {
        console.error('Error in command handler:', error);
        sendResponse({ resp: "error", error: error.message });
      });
  } else {
    sendResponse({ resp: "unknown message" });
  }

  return true; // Keep channel open for async response
});

// Seed default settings on install. restoreOptions() in the options page only
// assigns defaults to the DOM and never persists them, and saveOptions() runs
// solely on the 'change' event, so without this gestures would do nothing on a
// fresh install until the user manually changed an option.
chrome.runtime.onInstalled.addListener(() => {
  const defaults = {
    U: "newtab",
    R: "forward",
    L: "back",
    D: "closetab",
    rockerRL: "back",
    rockerLR: "forward",
    colorCode: "FF3300",
    width: "3",
    rocker: false,
    trail: false
  };
  chrome.storage.local.get(Object.keys(defaults), (current) => {
    if (chrome.runtime.lastError) {
      console.error("sGesture: Error seeding defaults:", chrome.runtime.lastError.message);
      return;
    }
    const toSet = {};
    for (const key in defaults) {
      if (current[key] === undefined) toSet[key] = defaults[key];
    }
    if (Object.keys(toSet).length > 0) {
      chrome.storage.local.set(toSet);
    }
  });
});