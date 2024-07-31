chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  console.log('Received message:', request.msg); // Debug log
  (async () => {
    try {
      if (request.msg === "newtab") {
        await chrome.tabs.create({});
        sendResponse({ resp: "tab open" });
      } else if (request.msg === "closetab") {
        const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
        if (tabs.length > 0) {
          await chrome.tabs.remove(tabs[0].id);
          sendResponse({ resp: "tab closed" });
        }
      } else if (request.msg === "colorCode") {
        const result = await chrome.storage.local.get("colorCode");
        sendResponse({ resp: result.colorCode });
      } else if (request.msg === "width") {
        const result = await chrome.storage.local.get("width");
        sendResponse({ resp: result.width });
      } else if (request.msg === "gests") {
        const items = await chrome.storage.local.get(null);
        const gests = {};
        for (const key in items) {
          if (key === "colorCode" || key === "width") continue;
          gests[key] = items[key];
        }
        sendResponse({ resp: gests });
      } else if (request.msg === "rocker") {
        const result = await chrome.storage.local.get("rocker");
        sendResponse({ resp: result.rocker });
      } else if (request.msg === "trail") {
        const result = await chrome.storage.local.get("trail");
        sendResponse({ resp: result.trail });
      } else if (request.msg === "lasttab") {
        const result = await chrome.storage.local.get('lasturl');
        await chrome.tabs.create({ url: result.lasturl });
        sendResponse({ resp: "tab opened" });
      } else if (request.msg === "reloadall") {
        const tabs = await chrome.tabs.query({});
        await Promise.all(tabs.map(async (tab) => {
          await chrome.tabs.reload(tab.id);
        }));
        sendResponse({ resp: "tabs reloaded" });
      } else if (request.msg === "nexttab") {
        const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
        if (tabs.length > 0) {
          const currentTab = tabs[0];
          const allTabs = await chrome.tabs.query({ currentWindow: true });
          const currentIndex = allTabs.findIndex(tab => tab.id === currentTab.id);
          const nextIndex = (currentIndex + 1) % allTabs.length;
          await chrome.tabs.update(allTabs[nextIndex].id, { active: true });
          sendResponse({ resp: "tab switched" });
        }
      } else if (request.msg === "prevtab") {
        const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
        if (tabs.length > 0) {
          const currentTab = tabs[0];
          const allTabs = await chrome.tabs.query({ currentWindow: true });
          const currentIndex = allTabs.findIndex(tab => tab.id === currentTab.id);
          const prevIndex = (currentIndex - 1 + allTabs.length) % allTabs.length;
          await chrome.tabs.update(allTabs[prevIndex].id, { active: true });
          sendResponse({ resp: "tab switched" });
        }
      } else if (request.msg === "closeback") {
        const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
        if (tabs.length > 0) {
          const activeTab = tabs[0];
          const allTabs = await chrome.tabs.query({ currentWindow: true });
          await Promise.all(allTabs.map(async (tab) => {
            if (tab.id !== activeTab.id) {
              await chrome.tabs.remove(tab.id);
            }
          }));
          sendResponse({ resp: "background closed" });
        }
      } else if (request.msg === "closeall") {
        const tabs = await chrome.tabs.query({ currentWindow: true });
        await Promise.all(tabs.map(async (tab) => {
          await chrome.tabs.remove(tab.id);
        }));
        sendResponse({ resp: "tabs closed" });
      } else {
        sendResponse({ resp: "unknown message" });
      }
    } catch (error) {
      console.error('Error in onMessage listener:', error);
      sendResponse({ resp: "error" });
    }
  })();
  return true; // This keeps the message channel open for asynchronous responses
});
