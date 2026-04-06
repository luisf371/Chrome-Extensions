(function () {
  'use strict';

  const app = globalThis.__SYP_CONTENT__;
  const { constants, state, api, pages } = app;

  if (window.__syoLoaded) return;
  window.__syoLoaded = true;

  function getTrustedBridgeData(event) {
    if (event.source !== window) return null;
    const data = event.data;
    if (!data || data.source !== constants.NAV_EVENT_SOURCE) return null;
    if (typeof data.type !== 'string' || typeof data.url !== 'string') return null;

    try {
      const url = new URL(data.url);
      return url.origin === window.location.origin ? data : null;
    } catch {
      return null;
    }
  }

  function scheduleNavigation(url) {
    if (url === state.lastUrl && (state.initSucceeded || state.initInProgress)) return;
    clearTimeout(state.navDebounceTimer);
    state.navDebounceTimer = setTimeout(() => {
      state.lastUrl = url;
      handleNavigation(url);
    }, 80);
  }

  function isBaseYouTubeUrl(url) {
    try {
      const parsed = new URL(url);
      return parsed.origin === window.location.origin && parsed.pathname === '/';
    } catch {
      return false;
    }
  }

  function consumeManualHomeNavigationOverride() {
    const now = Date.now();
    if (state.manualHomeNavigationUntil > now) {
      state.manualHomeNavigationUntil = 0;
      try {
        window.sessionStorage.removeItem(constants.HOME_REDIRECT_BYPASS_SESSION_KEY);
      } catch {}
      return true;
    }

    state.manualHomeNavigationUntil = 0;

    try {
      const storedAt = Number(window.sessionStorage.getItem(constants.HOME_REDIRECT_BYPASS_SESSION_KEY) || '0');
      window.sessionStorage.removeItem(constants.HOME_REDIRECT_BYPASS_SESSION_KEY);
      return storedAt > 0 && (now - storedAt) <= constants.HOME_REDIRECT_BYPASS_TTL_MS;
    } catch {
      return false;
    }
  }

  async function maybeRedirectRootToSubscriptions(url, gen) {
    if (!isBaseYouTubeUrl(url)) return false;

    if (!state.data?.settings) {
      try {
        await api.loadData();
      } catch (error) {
        console.warn('SYO failed to load settings for root redirect', error);
        return false;
      }
    }

    if (gen !== state.initGeneration) {
      return false;
    }

    if (!state.data?.settings?.redirectRootToSubscriptions) {
      return false;
    }

    if (consumeManualHomeNavigationOverride()) {
      return false;
    }

    window.location.replace(new URL(constants.SUBSCRIPTIONS_FEED_PATH, window.location.origin).href);
    return true;
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
    clearTimeout(state.subscriptionsFilterRetryTimer);
    state.subscriptionsFilterRetryTimer = null;
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

  async function handleNavigation(url) {
    cleanup();
    state.initSucceeded = false;
    state.initInProgress = true;
    const gen = ++state.initGeneration;

    try {
      const redirected = await maybeRedirectRootToSubscriptions(url, gen);
      if (gen !== state.initGeneration) return;
      if (redirected) {
        state.currentPage = null;
        state.initSucceeded = true;
        return;
      }

      const currentPage = getCurrentPage(url);
      if (!currentPage || !pages[currentPage]) {
        state.currentPage = null;
        state.initSucceeded = true;
        return;
      }

      state.currentPage = currentPage;
      await Promise.resolve(pages[currentPage].init({ url, gen }));
    } catch (error) {
      console.warn('SYO navigation init failed', error);
    } finally {
      if (gen === state.initGeneration) state.initInProgress = false;
    }
  }

  window.addEventListener('message', (event) => {
    const data = getTrustedBridgeData(event);
    if (!data) return;

    if (data.type === constants.HOME_NAV_INTENT_EVENT && data.url === window.location.href) {
      state.manualHomeNavigationUntil = Date.now() + constants.HOME_REDIRECT_BYPASS_TTL_MS;
      return;
    }

    if (data.type === 'SYP_NAV_EVENT' && data.url === window.location.href) {
      scheduleNavigation(data.url);
    }
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
