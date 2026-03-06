const commands = {
  newtab: async () => {
    await chrome.tabs.create({});
    return "tab open";
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
    const tabs = await chrome.tabs.query({ currentWindow: true });
    if (tabs.length > 0) {
      const ids = tabs.map(tab => tab.id);
      await chrome.tabs.remove(ids);
      return "tabs closed";
    }
    return "no tabs to close";
  },
  ping: async () => {
    return "pong";
  }
};

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  console.log('Received message:', request.msg);
  
  const handler = commands[request.msg];
  if (handler) {
    handler()
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