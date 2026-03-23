(function () {
  'use strict';

  const app = globalThis.__SYP_CONTENT__;
  const { constants, state, api, pages } = app;

  if (window.__syoLoaded) return;
  window.__syoLoaded = true;

  function scheduleNavigation(url) {
    if (url === state.lastUrl && (state.initSucceeded || state.initInProgress)) return;
    clearTimeout(state.navDebounceTimer);
    state.navDebounceTimer = setTimeout(() => {
      state.lastUrl = url;
      handleNavigation(url);
    }, 80);
  }

  function isTrustedNavigationMessage(event) {
    if (event.source !== window) return false;
    const data = event.data;
    if (!data || data.type !== 'SYP_NAV_EVENT' || data.source !== constants.NAV_EVENT_SOURCE) return false;
    if (typeof data.url !== 'string' || data.url !== window.location.href) return false;

    try {
      const url = new URL(data.url);
      return url.origin === window.location.origin;
    } catch {
      return false;
    }
  }

  function startUrlPoll() {
    if (state.pollInterval) return;
    state.lastUrl = window.location.href;
    state.pollInterval = setInterval(() => {
      const url = window.location.href;
      if (url !== state.lastUrl) {
        scheduleNavigation(url);
      } else if (!state.initSucceeded && !state.initInProgress && state.currentPage) {
        scheduleNavigation(url);
      }
    }, 500);
  }

  function getCurrentPage(url) {
    if (url.includes('/feed/subscriptions')) return 'subscriptions';
    if (url.includes('/feed/channels')) return 'channelsList';
    if (url.match(/\/@[^/]+/) || url.includes('/channel/')) return 'channel';
    if (url.includes('/watch')) return 'video';
    return null;
  }

  function cleanup() {
    if (state.feedObserver) {
      state.feedObserver.disconnect();
      state.feedObserver = null;
    }
    if (state.channelsListObserver) {
      state.channelsListObserver.disconnect();
      state.channelsListObserver = null;
    }
    if (state.quickAddObserver) {
      state.quickAddObserver.disconnect();
      state.quickAddObserver = null;
    }

    clearTimeout(state.feedObserverDebounceTimer);
    state.feedObserverDebounceTimer = null;
    clearTimeout(state.channelsListDebounceTimer);
    state.channelsListDebounceTimer = null;
    clearTimeout(state.quickAddObserverDebounceTimer);
    state.quickAddObserverDebounceTimer = null;

    api.clearDocumentCloseListener(state.quickAddCloseState);
    api.clearDocumentCloseListener(state.channelListCloseState);
    api.clearDocumentCloseListener(state.filterMenuCloseState);

    state.activeChannelListDropdown = null;
    document.querySelectorAll('.syp-host').forEach((el) => el.remove());
    state.filterHost = null;
    state.filterShadow = null;
    state.filterMenuOpen = false;
    pages.subscriptions?.resetState?.();
    state.quickAddOpen = false;
    state.quickAddHost = null;
    state.quickAddShadow = null;
    state.quickAddHandle = null;
    if (state.quickAddRefreshTimer) {
      clearTimeout(state.quickAddRefreshTimer);
      state.quickAddRefreshTimer = null;
    }
  }

  function handleNavigation(url) {
    cleanup();
    state.initSucceeded = false;
    state.initInProgress = true;
    const gen = ++state.initGeneration;

    const done = () => {
      if (gen === state.initGeneration) state.initInProgress = false;
    };

    const currentPage = getCurrentPage(url);
    if (!currentPage || !pages[currentPage]) {
      state.currentPage = null;
      state.initSucceeded = true;
      state.initInProgress = false;
      return;
    }

    state.currentPage = currentPage;
    Promise.resolve(pages[currentPage].init({ url, gen })).then(done, done);
  }

  window.addEventListener('message', (event) => {
    if (!isTrustedNavigationMessage(event)) return;
    scheduleNavigation(event.data.url);
  });

  chrome.runtime.onMessage.addListener((message) => {
    if (message.type !== 'DATA_CHANGED') return;

    if (message.key === 'all') {
      state.data = message.data;
    } else if (state.data) {
      state.data[message.key] = message.data;
    }
    api.buildLookupMaps();

    if (state.currentPage === 'subscriptions') {
      pages.subscriptions?.onDataChanged?.();
    }
    if (state.currentPage === 'channel' || state.currentPage === 'video') {
      api.scheduleQuickAddRefresh();
    }
    if (state.currentPage === 'channelsList') {
      pages.channelsList?.refreshChannelListButtons?.();
    }
  });

  startUrlPoll();
  handleNavigation(window.location.href);
})();
