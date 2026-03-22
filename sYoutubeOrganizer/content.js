(function () {
  'use strict';

  if (window.__syoLoaded) return;
  window.__syoLoaded = true;

  // --- State ---
  let currentPage = null;
  let lastUrl = '';
  let pollInterval = null;
  let feedObserver = null;
  let quickAddObserver = null;
  let data = null;
  let initSucceeded = false;
  let initInProgress = false;
  let initGeneration = 0; // increments on each navigation to cancel stale async inits
  let navDebounceTimer = null;
  let quickAddRefreshTimer = null;
  let pageToastHost = null;
  let pageToastShadow = null;
  let pageToastTimer = null;
  const quickAddCloseState = { handler: null, timer: null };
  const channelListCloseState = { handler: null, timer: null };
  const filterMenuCloseState = { handler: null, timer: null };

  const UNCATEGORIZED_ID = '__uncategorized';
  const FILTER_MODE_ALL = 'all';
  const FILTER_MODE_INCLUDE = 'include';
  const FILTER_MODE_EXCLUDE = 'exclude';
  const FILTER_MODE_UNCATEGORIZED = 'uncategorized';
  const SUBSCRIPTIONS_FILTER_PREFERENCE_KEY = 'subscriptionsFilterPreference';
  const NAV_EVENT_SOURCE = 'syp-page-bridge';
  const MAX_MESSAGE_RETRIES = 2;
  const MESSAGE_RETRY_DELAY_MS = 200;
  const RETRYABLE_MESSAGE_TYPES = new Set([
    'GET_ALL_DATA',
    'REGISTER_CHANNEL',
    'ASSIGN_CHANNEL_PLAYLIST',
    'UPDATE_SETTINGS',
    'OPEN_OPTIONS',
    'DELETE_PLAYLIST',
    'UPDATE_PLAYLIST',
    'REORDER_PLAYLISTS'
  ]);

  // Runtime lookup: playlistId -> Set<handle>
  let playlistChannels = new Map();
  let allAssignedHandles = new Set();
  let subscriptionsFilterMode = FILTER_MODE_ALL;
  let subscriptionsIncludePlaylistId = null;
  let subduedPlaylistIds = new Set();
  let filterMenuOpen = false;

  // --- SPA Navigation ---

  function scheduleNavigation(url) {
    // Skip if same URL and init already succeeded or is still in progress
    if (url === lastUrl && (initSucceeded || initInProgress)) return;
    // Debounce rapid duplicate events (load + yt-navigate-finish + yt-page-data-updated)
    clearTimeout(navDebounceTimer);
    navDebounceTimer = setTimeout(() => {
      lastUrl = url;
      handleNavigation(url);
    }, 80);
  }

  function isTrustedNavigationMessage(event) {
    if (event.source !== window) return false;
    const data = event.data;
    if (!data || data.type !== 'SYP_NAV_EVENT' || data.source !== NAV_EVENT_SOURCE) return false;
    if (typeof data.url !== 'string' || data.url !== window.location.href) return false;

    try {
      const url = new URL(data.url);
      return url.origin === window.location.origin;
    } catch {
      return false;
    }
  }

  window.addEventListener('message', (event) => {
    if (!isTrustedNavigationMessage(event)) return;
    scheduleNavigation(event.data.url);
  });

  function startUrlPoll() {
    if (pollInterval) return;
    lastUrl = window.location.href;
    pollInterval = setInterval(() => {
      const url = window.location.href;
      if (url !== lastUrl) {
        scheduleNavigation(url);
      } else if (!initSucceeded && !initInProgress && currentPage) {
        // Retry failed initialization (e.g. DOM wasn't ready or service worker was asleep)
        scheduleNavigation(url);
      }
    }, 500);
  }

  // Listen for data changes from background
  chrome.runtime.onMessage.addListener((message) => {
    if (message.type === 'DATA_CHANGED') {
      if (message.key === 'all') {
        data = message.data;
      } else if (data) {
        data[message.key] = message.data;
      }
      buildLookupMaps();
      if (currentPage === 'subscriptions') {
        syncSubscriptionsFilterState();
        renderFilterBar();
        applySectionVisibility();
        applyFilter();
      }
      if (currentPage === 'channel' || currentPage === 'video') {
        scheduleQuickAddRefresh();
      }
      if (currentPage === 'channelsList') {
        refreshChannelListButtons();
      }
    }
  });

  // --- Page Router ---

  function handleNavigation(url) {
    cleanup();
    initSucceeded = false;
    initInProgress = true;
    const gen = ++initGeneration; // cancel any in-flight async inits

    const done = () => { if (gen === initGeneration) initInProgress = false; };

    if (url.includes('/feed/subscriptions')) {
      currentPage = 'subscriptions';
      initSubscriptionsPage(gen).then(done, done);
    } else if (url.includes('/feed/channels')) {
      currentPage = 'channelsList';
      initChannelsListPage(gen).then(done, done);
    } else if (url.match(/\/@[^/]+/) || url.includes('/channel/')) {
      currentPage = 'channel';
      initChannelPage(url, gen).then(done, done);
    } else if (url.includes('/watch')) {
      currentPage = 'video';
      initVideoPage(gen).then(done, done);
    } else {
      currentPage = null;
      initSucceeded = true;
      initInProgress = false;
    }
  }

  function cleanup() {
    if (feedObserver) { feedObserver.disconnect(); feedObserver = null; }
    if (channelsListObserver) { channelsListObserver.disconnect(); channelsListObserver = null; }
    if (quickAddObserver) { quickAddObserver.disconnect(); quickAddObserver = null; }
    clearDocumentCloseListener(quickAddCloseState);
    clearDocumentCloseListener(channelListCloseState);
    clearDocumentCloseListener(filterMenuCloseState);
    activeChannelListDropdown = null;
    document.querySelectorAll('.syp-host').forEach(el => el.remove());
    filterHost = null;
    filterShadow = null;
    filterMenuOpen = false;
    resetSubscriptionsFilterState();
    quickAddOpen = false;
    quickAddHost = null;
    quickAddShadow = null;
    quickAddHandle = null;
    if (quickAddRefreshTimer) {
      clearTimeout(quickAddRefreshTimer);
      quickAddRefreshTimer = null;
    }
  }

  // --- Data Loading ---

  function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  function normalizeRuntimeError(error) {
    if (error instanceof Error) return error;
    if (typeof error === 'string' && error) return new Error(error);
    return new Error('Extension request failed');
  }

  function isRetryableRuntimeError(type, error) {
    if (!RETRYABLE_MESSAGE_TYPES.has(type) || !chrome.runtime?.id) return false;
    const message = error?.message || '';
    return (
      /receiving end does not exist/i.test(message) ||
      /message port closed/i.test(message) ||
      /could not establish connection/i.test(message)
    );
  }

  async function sendMsg(msg) {
    if (!msg?.type) {
      throw new Error('Invalid extension request');
    }

    const maxRetries = RETRYABLE_MESSAGE_TYPES.has(msg.type) ? MAX_MESSAGE_RETRIES : 0;
    let attempt = 0;

    while (true) {
      if (!chrome.runtime?.id) {
        throw new Error('Extension unavailable. Reload the extension and try again.');
      }

      try {
        const response = await chrome.runtime.sendMessage(msg);
        if (response?.error) {
          throw new Error(response.error);
        }
        return response;
      } catch (error) {
        const normalizedError = normalizeRuntimeError(error);
        if (attempt >= maxRetries || !isRetryableRuntimeError(msg.type, normalizedError)) {
          throw normalizedError;
        }
        await sleep(MESSAGE_RETRY_DELAY_MS * (2 ** attempt));
        attempt += 1;
      }
    }
  }

  async function loadData() {
    data = await sendMsg({ type: 'GET_ALL_DATA' });
    buildLookupMaps();
  }

  function ensurePageToast() {
    if (pageToastHost?.isConnected && pageToastShadow) {
      return pageToastShadow;
    }

    pageToastHost = document.createElement('div');
    pageToastHost.className = 'syp-toast-host';
    pageToastHost.style.cssText = 'all: initial; position: fixed; left: 50%; bottom: 24px; transform: translateX(-50%); z-index: 2147483647;';
    document.documentElement.appendChild(pageToastHost);
    pageToastShadow = pageToastHost.attachShadow({ mode: 'open' });
    return pageToastShadow;
  }

  function showPageToast(message, type = 'error') {
    const shadow = ensurePageToast();
    const isError = type === 'error';
    shadow.innerHTML = `
      <style>
        .toast {
          min-width: 220px;
          max-width: min(420px, calc(100vw - 32px));
          padding: 10px 14px;
          border-radius: 10px;
          border: 1px solid ${isError ? 'rgba(217,83,79,0.4)' : 'rgba(92,184,92,0.4)'};
          background: rgba(15, 15, 15, 0.96);
          color: #f5f5f5;
          box-shadow: 0 10px 28px rgba(0, 0, 0, 0.34);
          font-family: Roboto, Arial, sans-serif;
          font-size: 13px;
          line-height: 1.45;
        }
      </style>
      <div class="toast">${escapeHtml(message)}</div>
    `;

    if (pageToastTimer) clearTimeout(pageToastTimer);
    pageToastTimer = setTimeout(() => {
      if (pageToastHost?.isConnected) {
        pageToastHost.remove();
      }
      pageToastHost = null;
      pageToastShadow = null;
      pageToastTimer = null;
    }, 2800);
  }

  function handleActionError(error, fallbackMessage = 'Action failed. Reload the extension and try again.') {
    const message = error?.message || fallbackMessage;
    console.warn('SYO action failed', error);
    showPageToast(message, 'error');
  }

  function buildLookupMaps() {
    if (!data) return;
    playlistChannels = new Map();
    allAssignedHandles = new Set();

    for (const [handle, plIds] of Object.entries(data.channelPlaylists || {})) {
      if (plIds.length > 0) allAssignedHandles.add(handle);
      for (const plId of plIds) {
        if (!playlistChannels.has(plId)) playlistChannels.set(plId, new Set());
        playlistChannels.get(plId).add(handle);
      }
    }
  }

  // --- Subscriptions Page ---

  let filterHost = null;
  let filterShadow = null;

  function isVisibleElement(el) {
    return Boolean(
      el &&
      el.isConnected &&
      !el.hasAttribute('hidden') &&
      el.getClientRects().length > 0
    );
  }

  function getActiveSubscriptionsBrowse() {
    return Array.from(document.querySelectorAll('ytd-browse[page-subtype="subscriptions"]'))
      .find(isVisibleElement) || null;
  }

  /**
   * Read the title text from a ytd-rich-section-renderer's shelf header.
   * Scoped to #title-container inside the section's direct content renderer
   * (ytd-shelf-renderer or ytd-rich-shelf-renderer) so we only read the
   * actual shelf heading, not arbitrary text from cards or body content.
   */
  function getSectionHeadingText(section) {
    const renderer = section.querySelector(':scope > #content > ytd-shelf-renderer, :scope > #content > ytd-rich-shelf-renderer');
    if (!renderer) return null;
    const titleContainer = renderer.querySelector('#title-container');
    if (!titleContainer) return null;
    return (titleContainer.textContent || '').trim().replace(/\s+/g, ' ').toLowerCase();
  }

  function getSubscriptionsGrid() {
    const browse = getActiveSubscriptionsBrowse();
    return browse?.querySelector('ytd-rich-grid-renderer') || null;
  }

  function getSubscriptionsContents() {
    return getSubscriptionsGrid()?.querySelector('#contents') || null;
  }

  function getSubscriptionsMountParent() {
    return getSubscriptionsGrid()?.parentElement || null;
  }

  function placeFilterHost(host, mountParent, grid) {
    if (!host || !mountParent) return false;

    if (grid && grid.parentElement === mountParent) {
      if (host.parentElement !== mountParent || host.nextElementSibling !== grid) {
        mountParent.insertBefore(host, grid);
        return true;
      }
      return false;
    }

    if (host.parentElement !== mountParent || mountParent.firstElementChild !== host) {
      mountParent.insertBefore(host, mountParent.firstChild);
      return true;
    }

    return false;
  }

  function resetSubscriptionsFilterState() {
    subscriptionsFilterMode = FILTER_MODE_ALL;
    subscriptionsIncludePlaylistId = null;
    subduedPlaylistIds = new Set();
  }

  function setAllSubscriptionsFilter() {
    resetSubscriptionsFilterState();
  }

  function setIncludeSubscriptionsFilter(playlistId) {
    subscriptionsFilterMode = FILTER_MODE_INCLUDE;
    subscriptionsIncludePlaylistId = playlistId;
    subduedPlaylistIds = new Set();
  }

  function setUncategorizedSubscriptionsFilter() {
    subscriptionsFilterMode = FILTER_MODE_UNCATEGORIZED;
    subscriptionsIncludePlaylistId = null;
    subduedPlaylistIds = new Set();
  }

  function toggleExcludedSubscriptionsFilter(playlistId) {
    const next = new Set(subduedPlaylistIds);
    if (next.has(playlistId)) {
      next.delete(playlistId);
    } else {
      next.add(playlistId);
    }

    if (next.size === 0) {
      setAllSubscriptionsFilter();
      return;
    }

    subscriptionsFilterMode = FILTER_MODE_EXCLUDE;
    subscriptionsIncludePlaylistId = null;
    subduedPlaylistIds = next;
  }

  function hasActiveSubscriptionsFilter() {
    return subscriptionsFilterMode !== FILTER_MODE_ALL;
  }

  function getSavedSubscriptionsPreference() {
    return normalizeSubscriptionsFilterPreference(data?.settings?.[SUBSCRIPTIONS_FILTER_PREFERENCE_KEY]);
  }

  function getCurrentSubscriptionsPreference() {
    if (subscriptionsFilterMode === FILTER_MODE_INCLUDE) {
      if (!subscriptionsIncludePlaylistId || !data?.playlists?.[subscriptionsIncludePlaylistId]) return null;
      return {
        mode: FILTER_MODE_INCLUDE,
        activePlaylistId: subscriptionsIncludePlaylistId,
        excludedPlaylistIds: []
      };
    }

    if (subscriptionsFilterMode === FILTER_MODE_UNCATEGORIZED) {
      return {
        mode: FILTER_MODE_UNCATEGORIZED,
        activePlaylistId: null,
        excludedPlaylistIds: []
      };
    }

    if (subscriptionsFilterMode === FILTER_MODE_EXCLUDE) {
      const excludedPlaylistIds = Array.from(subduedPlaylistIds)
        .filter((playlistId) => data?.playlists?.[playlistId]);
      if (excludedPlaylistIds.length === 0) return null;
      return {
        mode: FILTER_MODE_EXCLUDE,
        activePlaylistId: null,
        excludedPlaylistIds
      };
    }

    return null;
  }

  function normalizeSubscriptionsFilterPreference(preference) {
    if (!preference || typeof preference !== 'object') return null;

    const validPlaylistIds = new Set(Object.keys(data?.playlists || {}));

    if (preference.mode === FILTER_MODE_INCLUDE) {
      const activePlaylistId = typeof preference.activePlaylistId === 'string'
        ? preference.activePlaylistId
        : null;
      if (!activePlaylistId || !validPlaylistIds.has(activePlaylistId)) return null;
      return {
        mode: FILTER_MODE_INCLUDE,
        activePlaylistId,
        excludedPlaylistIds: []
      };
    }

    if (preference.mode === FILTER_MODE_UNCATEGORIZED) {
      return {
        mode: FILTER_MODE_UNCATEGORIZED,
        activePlaylistId: null,
        excludedPlaylistIds: []
      };
    }

    if (preference.mode === FILTER_MODE_EXCLUDE) {
      const excludedPlaylistIds = Array.isArray(preference.excludedPlaylistIds)
        ? preference.excludedPlaylistIds.filter((playlistId) => (
          typeof playlistId === 'string' && validPlaylistIds.has(playlistId)
        ))
        : [];
      if (excludedPlaylistIds.length === 0) return null;
      return {
        mode: FILTER_MODE_EXCLUDE,
        activePlaylistId: null,
        excludedPlaylistIds
      };
    }

    return null;
  }

  function applySubscriptionsFilterPreference(preference) {
    if (!preference) {
      setAllSubscriptionsFilter();
      return;
    }

    if (preference.mode === FILTER_MODE_INCLUDE) {
      setIncludeSubscriptionsFilter(preference.activePlaylistId);
      return;
    }

    if (preference.mode === FILTER_MODE_UNCATEGORIZED) {
      setUncategorizedSubscriptionsFilter();
      return;
    }

    if (preference.mode === FILTER_MODE_EXCLUDE) {
      subscriptionsFilterMode = FILTER_MODE_EXCLUDE;
      subscriptionsIncludePlaylistId = null;
      subduedPlaylistIds = new Set(preference.excludedPlaylistIds);
      return;
    }

    setAllSubscriptionsFilter();
  }

  function restoreSavedSubscriptionsPreference() {
    applySubscriptionsFilterPreference(getSavedSubscriptionsPreference());
  }

  function syncSubscriptionsFilterState() {
    const validPlaylistIds = new Set(Object.keys(data?.playlists || {}));

    if (subscriptionsFilterMode === FILTER_MODE_INCLUDE) {
      if (!subscriptionsIncludePlaylistId || !validPlaylistIds.has(subscriptionsIncludePlaylistId)) {
        setAllSubscriptionsFilter();
      }
      return;
    }

    if (subscriptionsFilterMode === FILTER_MODE_EXCLUDE) {
      subduedPlaylistIds = new Set(
        Array.from(subduedPlaylistIds).filter((playlistId) => validPlaylistIds.has(playlistId))
      );
      if (subduedPlaylistIds.size === 0) {
        setAllSubscriptionsFilter();
      }
      return;
    }

    if (subscriptionsFilterMode === FILTER_MODE_UNCATEGORIZED) {
      subscriptionsIncludePlaylistId = null;
      subduedPlaylistIds = new Set();
      return;
    }

    setAllSubscriptionsFilter();
  }

  function closeFilterMenu({ render = true } = {}) {
    if (!filterMenuOpen) {
      clearDocumentCloseListener(filterMenuCloseState);
      return;
    }
    filterMenuOpen = false;
    clearDocumentCloseListener(filterMenuCloseState);
    if (render) renderFilterBar();
  }

  async function persistSubscriptionsPreference() {
    const nextPreference = getCurrentSubscriptionsPreference();
    const settings = await sendMsg({
      type: 'UPDATE_SETTINGS',
      settings: {
        [SUBSCRIPTIONS_FILTER_PREFERENCE_KEY]: nextPreference
      }
    });
    if (settings && data) {
      data.settings = settings;
    }
  }

  async function initSubscriptionsPage(gen) {
    try {
      await loadData();
    } catch (error) {
      console.warn('SYO failed to load subscriptions data', error);
      return;
    }
    if (!data || gen !== initGeneration) return;
    const mountReady = () => {
      const mountParent = getSubscriptionsMountParent();
      const contents = getSubscriptionsContents();
      if (!mountParent || !contents) return null;
      return contents.querySelector('ytd-rich-section-renderer, ytd-rich-item-renderer') ? mountParent : null;
    };
    const mountParent = await waitForElement(mountReady);
    if (!mountParent || gen !== initGeneration) return;
    restoreSavedSubscriptionsPreference();
    if (!injectFilterBar()) return;
    applySectionVisibility();
    applyFilter();
    if (!observeFeed()) return;
    initSucceeded = true;
  }

  function applySectionVisibility() {
    const browse = getActiveSubscriptionsBrowse();
    if (!browse || !data?.settings) return;
    const sections = browse.querySelectorAll('ytd-rich-section-renderer');
    for (const section of sections) {
      const text = getSectionHeadingText(section);
      if (!text) continue;
      if (text.includes('shorts')) {
        section.style.display = data.settings.hideShorts ? 'none' : '';
      } else if (text.includes('most relevant')) {
        section.style.display = data.settings.hideMostRelevant ? 'none' : '';
      }
    }
  }

  function injectFilterBar() {
    const mountParent = getSubscriptionsMountParent();
    const grid = getSubscriptionsGrid();
    if (!mountParent) return false;

    if (filterHost?.isConnected && filterShadow) {
      placeFilterHost(filterHost, mountParent, grid);
      renderFilterBar();
      return true;
    }

    const existingHost = mountParent.querySelector(':scope > .syp-filter-host')
      || getActiveSubscriptionsBrowse()?.querySelector('.syp-filter-host');
    if (existingHost?.shadowRoot) {
      filterHost = existingHost;
      filterShadow = existingHost.shadowRoot;
      placeFilterHost(filterHost, mountParent, grid);
      renderFilterBar();
      return true;
    }

    filterHost = document.createElement('div');
    filterHost.className = 'syp-host syp-filter-host';
    filterHost.style.cssText = 'all: initial; display: block; width: 100%; flex-shrink: 0;';
    placeFilterHost(filterHost, mountParent, grid);
    filterShadow = filterHost.attachShadow({ mode: 'open' });
    renderFilterBar();
    return true;
  }

  function renderFilterBar() {
    if (!filterShadow || !data) return;

    const isDark = document.documentElement.hasAttribute('dark');
    const playlists = Object.values(data.playlists || {}).sort((a, b) => a.order - b.order);
    const savedPreference = getSavedSubscriptionsPreference();

    filterShadow.innerHTML = `
      <style>
        :host { display: block; }
        * { box-sizing: border-box; margin: 0; padding: 0; }
        .syp-bar {
          position: sticky;
          top: 0;
          z-index: 100;
          padding: 12px 12px 0px;
          background: ${isDark ? '#0f0f0f' : '#ffffff'};
          font-family: 'Roboto', 'Arial', sans-serif;
          font-size: 14px;
        }
        .syp-row {
          display: flex;
          gap: 8px;
          padding: 4px 0;
          align-items: center;
        }
        .syp-scroll {
          display: flex;
          gap: 8px;
          min-width: 0;
          flex: 1 1 auto;
          overflow-x: auto;
          scrollbar-width: none;
          align-items: center;
        }
        .syp-scroll::-webkit-scrollbar { display: none; }
        .syp-btn {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          padding: 6px 14px;
          border-radius: 8px;
          border: none;
          cursor: pointer;
          font-family: inherit;
          font-size: 14px;
          font-weight: 500;
          white-space: nowrap;
          transition: background 0.15s, color 0.15s;
          background: ${isDark ? '#272727' : '#f2f2f2'};
          color: ${isDark ? '#f1f1f1' : '#0f0f0f'};
        }
        .syp-btn:hover {
          background: ${isDark ? '#3a3a3a' : '#e0e0e0'};
        }
        .syp-btn.active {
          background: ${isDark ? '#f1f1f1' : '#0f0f0f'};
          color: ${isDark ? '#0f0f0f' : '#f1f1f1'};
        }
        .syp-btn.subdued {
          opacity: 0.5;
          background: ${isDark ? '#1d1d1d' : '#ebebeb'};
          color: ${isDark ? '#b9b9b9' : '#5b5b5b'};
        }
        .syp-btn.subdued:hover {
          opacity: 0.8;
        }
        .syp-btn .syp-dot {
          width: 8px;
          height: 8px;
          border-radius: 50%;
          flex-shrink: 0;
        }
        .syp-btn .syp-count {
          font-size: 12px;
          opacity: 0.7;
        }
        .syp-menu-wrap {
          margin-left: auto;
          position: relative;
          flex: 0 0 auto;
        }
        .syp-menu-trigger {
          background: transparent;
          color: ${isDark ? '#aaa' : '#606060'};
          font-size: 20px;
          line-height: 1;
          padding: 4px 10px 8px;
          min-width: 38px;
          justify-content: center;
        }
        .syp-menu-trigger:hover,
        .syp-menu-trigger[aria-expanded="true"] {
          color: ${isDark ? '#f1f1f1' : '#0f0f0f'};
          background: ${isDark ? '#272727' : '#f2f2f2'};
        }
        .syp-menu-indicator {
          position: absolute;
          top: 6px;
          right: 8px;
          width: 6px;
          height: 6px;
          border-radius: 50%;
          background: ${isDark ? '#8ab4f8' : '#065fd4'};
          pointer-events: none;
        }
        .syp-menu {
          position: absolute;
          top: calc(100% + 6px);
          right: 0;
          min-width: 180px;
          padding: 6px;
          border-radius: 12px;
          border: 1px solid ${isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)'};
          background: ${isDark ? '#1f1f1f' : '#ffffff'};
          box-shadow: ${isDark
        ? '0 18px 40px rgba(0,0,0,0.45)'
        : '0 18px 40px rgba(0,0,0,0.14)'};
          z-index: 5;
        }
        .syp-menu-item {
          width: 100%;
          border: none;
          background: transparent;
          color: ${isDark ? '#f1f1f1' : '#0f0f0f'};
          font: inherit;
          text-align: left;
          padding: 9px 12px;
          border-radius: 8px;
          cursor: pointer;
        }
        .syp-menu-item:hover {
          background: ${isDark ? '#2b2b2b' : '#f2f2f2'};
        }
      </style>
      <div class="syp-bar">
        <div class="syp-row">
          <div class="syp-scroll">
            <button
              type="button"
              class="syp-btn ${subscriptionsFilterMode === FILTER_MODE_ALL ? 'active' : ''}"
              data-action="all"
            >All</button>
            ${playlists.map(pl => {
          const count = playlistChannels.get(pl.id)?.size || 0;
          const isActive = subscriptionsFilterMode === FILTER_MODE_INCLUDE && subscriptionsIncludePlaylistId === pl.id;
          const isSubdued = subscriptionsFilterMode === FILTER_MODE_EXCLUDE && subduedPlaylistIds.has(pl.id);
          return `<button
                type="button"
                class="syp-btn ${isActive ? 'active' : ''} ${isSubdued ? 'subdued' : ''}"
                data-playlist="${pl.id}"
                title="Click to show only this playlist. Ctrl/Command+Click to hide it."
              >
                <span class="syp-dot" style="background:${pl.color}"></span>
                ${escapeHtml(pl.name)}
                <span class="syp-count">${count}</span>
              </button>`;
        }).join('')}
            <button
              type="button"
              class="syp-btn ${subscriptionsFilterMode === FILTER_MODE_UNCATEGORIZED ? 'active' : ''}"
              data-action="uncategorized"
            >
              <span class="syp-dot" style="background:${isDark ? '#666' : '#999'}"></span>
              Uncategorized
            </button>
          </div>
          <div class="syp-menu-wrap">
            <button
              type="button"
              class="syp-btn syp-menu-trigger"
              data-action="toggle-menu"
              aria-haspopup="menu"
              aria-expanded="${filterMenuOpen ? 'true' : 'false'}"
              aria-controls="syp-filter-menu"
              title="Filter actions"
            >...</button>
            ${savedPreference ? '<span class="syp-menu-indicator" aria-hidden="true"></span>' : ''}
            ${filterMenuOpen ? `
              <div class="syp-menu" id="syp-filter-menu" role="menu">
                <button type="button" class="syp-menu-item" role="menuitem" data-action="manage">Manage</button>
                <button type="button" class="syp-menu-item" role="menuitem" data-action="save-preference">Save preference</button>
                <button type="button" class="syp-menu-item" role="menuitem" data-action="reset-preference">Reset saved preference</button>
              </div>
            ` : ''}
          </div>
        </div>
      </div>
    `;

    filterShadow.querySelectorAll('[data-action="all"]').forEach(btn => {
      btn.addEventListener('click', () => {
        setAllSubscriptionsFilter();
        filterMenuOpen = false;
        renderFilterBar();
        applyFilter();
      });
    });

    filterShadow.querySelectorAll('[data-playlist]').forEach(btn => {
      btn.addEventListener('click', (event) => {
        const playlistId = btn.dataset.playlist;
        if (!playlistId) return;
        if (event.ctrlKey || event.metaKey) {
          toggleExcludedSubscriptionsFilter(playlistId);
        } else {
          setIncludeSubscriptionsFilter(playlistId);
        }
        filterMenuOpen = false;
        renderFilterBar();
        applyFilter();
      });
    });

    filterShadow.querySelectorAll('[data-action="uncategorized"]').forEach(btn => {
      btn.addEventListener('click', () => {
        setUncategorizedSubscriptionsFilter();
        filterMenuOpen = false;
        renderFilterBar();
        applyFilter();
      });
    });

    filterShadow.querySelectorAll('[data-action="toggle-menu"]').forEach(btn => {
      btn.addEventListener('click', (event) => {
        event.stopPropagation();
        filterMenuOpen = !filterMenuOpen;
        renderFilterBar();
      });
    });

    filterShadow.querySelectorAll('[data-action="manage"]').forEach(btn => {
      btn.addEventListener('click', () => {
        closeFilterMenu();
        void sendMsg({ type: 'OPEN_OPTIONS' }).catch((error) => handleActionError(error));
      });
    });

    filterShadow.querySelectorAll('[data-action="save-preference"]').forEach(btn => {
      btn.addEventListener('click', async () => {
        try {
          await persistSubscriptionsPreference();
          closeFilterMenu();
        } catch (error) {
          handleActionError(error, 'Could not save the filter preference.');
        }
      });
    });

    filterShadow.querySelectorAll('[data-action="reset-preference"]').forEach(btn => {
      btn.addEventListener('click', async () => {
        try {
          setAllSubscriptionsFilter();
          await persistSubscriptionsPreference();
          closeFilterMenu({ render: false });
          renderFilterBar();
          applyFilter();
        } catch (error) {
          handleActionError(error, 'Could not reset the filter preference.');
        }
      });
    });

    const menu = filterShadow.getElementById('syp-filter-menu');
    if (menu) {
      menu.addEventListener('keydown', (event) => {
        if (event.key !== 'Escape') return;
        event.preventDefault();
        closeFilterMenu();
      });
      const firstMenuItem = menu.querySelector('[data-action="manage"]');
      if (firstMenuItem) firstMenuItem.focus();
    }

    if (filterMenuOpen) {
      const closeHandler = (event) => {
        const path = event.composedPath();
        if (filterHost && path.includes(filterHost)) return;
        closeFilterMenu();
      };
      armDocumentCloseListener(filterMenuCloseState, closeHandler);
    } else {
      clearDocumentCloseListener(filterMenuCloseState);
    }
  }

  function applyFilter() {
    const cards = getSubscriptionsGrid()?.querySelectorAll('ytd-rich-item-renderer') || [];

    if (subscriptionsFilterMode === FILTER_MODE_ALL) {
      cards.forEach(card => { card.style.display = ''; });
      return;
    }

    let allowedHandles = null;
    let excludedHandles = null;
    if (subscriptionsFilterMode === FILTER_MODE_INCLUDE) {
      allowedHandles = playlistChannels.get(subscriptionsIncludePlaylistId) || new Set();
    } else if (subscriptionsFilterMode === FILTER_MODE_EXCLUDE) {
      excludedHandles = new Set();
      subduedPlaylistIds.forEach((playlistId) => {
        const handles = playlistChannels.get(playlistId);
        if (!handles) return;
        handles.forEach((handle) => excludedHandles.add(handle));
      });
    }

    cards.forEach(card => {
      const handle = extractHandleFromCard(card);
      let show;
      if (subscriptionsFilterMode === FILTER_MODE_UNCATEGORIZED) {
        show = handle && !allAssignedHandles.has(handle);
      } else if (subscriptionsFilterMode === FILTER_MODE_EXCLUDE) {
        show = !handle || !excludedHandles.has(handle);
      } else {
        show = handle && allowedHandles.has(handle);
      }
      if (show) {
        card.style.display = '';
      } else {
        card.style.display = 'none';
      }
    });
  }

  function extractHandleFromCard(card) {
    const handleLink = card.querySelector('a[href*="/@"]');
    if (handleLink) {
      const match = handleLink.getAttribute('href').match(/\/@([^/?]+)/);
      if (match) return '@' + match[1];
    }
    const channelLink = card.querySelector('a[href*="/channel/"]');
    if (channelLink) {
      const match = channelLink.getAttribute('href').match(/\/channel\/([^/?]+)/);
      if (match) return match[1];
    }
    return null;
  }

  function observeFeed() {
    const browse = getActiveSubscriptionsBrowse();
    if (!browse) return false;

    let debounceTimer = null;
    let lastFilteredCount = getSubscriptionsGrid()?.querySelectorAll('ytd-rich-item-renderer').length || 0;
    let lastFirstCard = getSubscriptionsGrid()?.querySelector('ytd-rich-item-renderer') || null;
    let cooldownUntil = 0;

    feedObserver = new MutationObserver(() => {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        if (currentPage !== 'subscriptions') return;
        if (!getSubscriptionsGrid()) return;

        if (!filterHost?.isConnected && !injectFilterBar()) return;

        applySectionVisibility();

        if (!hasActiveSubscriptionsFilter()) return;

        // Throttle repeated feed updates, but still react when the page swaps the card tree.
        const now = Date.now();
        if (now < cooldownUntil) return;

        const currentCount = getSubscriptionsGrid()?.querySelectorAll('ytd-rich-item-renderer').length || 0;
        const currentFirstCard = getSubscriptionsGrid()?.querySelector('ytd-rich-item-renderer') || null;
        if (currentCount !== lastFilteredCount || currentFirstCard !== lastFirstCard) {
          lastFilteredCount = currentCount;
          lastFirstCard = currentFirstCard;
          applyFilter();
          // Cooldown: don't filter again for 500ms to prevent rapid loop
          cooldownUntil = Date.now() + 500;
        }
      }, 150);
    });

    feedObserver.observe(browse, { childList: true, subtree: true });
    return true;
  }

  // --- Channels List Page (/feed/channels) ---

  let channelsListObserver = null;
  let activeChannelListDropdown = null; // { shadow, host, handle, channelName }

  async function initChannelsListPage(gen) {
    try {
      await loadData();
    } catch (error) {
      console.warn('SYO failed to load channels list data', error);
      return;
    }
    if (!data || gen !== initGeneration) return;
    const el = await waitForElement('ytd-channel-renderer');
    if (!el || gen !== initGeneration) return;
    injectChannelListButtons();
    observeChannelsList();
    initSucceeded = true;
  }

  function injectChannelListButtons() {
    const renderers = document.querySelectorAll('ytd-channel-renderer');
    renderers.forEach(renderer => {
      if (renderer.querySelector('.syp-host')) return;

      const buttonsDiv = renderer.querySelector('#buttons');
      if (!buttonsDiv) return;

      const channelLink = renderer.querySelector('a.channel-link[href*="/@"]')
        || renderer.querySelector('a.channel-link[href*="/channel/"]');
      if (!channelLink) return;
      const handle = extractHandleFromUrl(channelLink.getAttribute('href') || '');
      if (!handle) return;

      const nameEl = renderer.querySelector('ytd-channel-name yt-formatted-string');
      const channelName = nameEl?.textContent?.trim() || handle;

      void sendMsg({ type: 'REGISTER_CHANNEL', handle, name: channelName }).catch((error) => {
        console.warn('SYO failed to register channel list channel', error);
      });

      const subscribeBtn = renderer.querySelector('#subscribe-button');
      if (!subscribeBtn) return;

      const host = document.createElement('div');
      host.className = 'syp-host';
      host.style.cssText = 'all: initial; display: block; margin-top: 6px; position: relative; z-index: 2000;';
      subscribeBtn.appendChild(host);

      const shadow = host.attachShadow({ mode: 'open' });
      renderChannelListButton(shadow, host, handle, channelName, false);
    });
  }

  function renderChannelListButton(shadow, host, handle, channelName, isOpen) {
    host.style.zIndex = isOpen ? '9999' : '2000';
    const isDark = document.documentElement.hasAttribute('dark');
    const assignments = (data?.channelPlaylists || {})[handle] || [];
    const assignedCount = assignments.length;

    shadow.innerHTML = `
      <style>
        * { box-sizing: border-box; margin: 0; padding: 0; }
        .syp-qa-trigger {
          display: inline-flex;
          align-items: center;
          gap: 4px;
          padding: 8px 16px;
          border-radius: 18px;
          border: none;
          background: ${isDark ? '#272727' : '#f2f2f2'};
          color: ${isDark ? '#f1f1f1' : '#0f0f0f'};
          cursor: pointer;
          font-family: 'Roboto', 'Arial', sans-serif;
          font-size: 14px;
          font-weight: 500;
        }
        .syp-qa-trigger:hover {
          background: ${isDark ? '#3a3a3a' : '#e0e0e0'};
        }
        .syp-qa-trigger .syp-badge {
          background: #4a9eff;
          color: #fff;
          font-size: 11px;
          padding: 1px 6px;
          border-radius: 10px;
          font-weight: 600;
        }
        ${getDropdownStyles(isDark)}
      </style>
      <div style="position: relative; display: inline-block;">
        <button class="syp-qa-trigger" id="syp-trigger">
          + Playlist${assignedCount > 0 ? ` <span class="syp-badge">${assignedCount}</span>` : ''}
        </button>
        ${isOpen ? renderDropdownHTML(handle) : ''}
      </div>
    `;

    const trigger = shadow.getElementById('syp-trigger');
    trigger.addEventListener('click', (e) => {
      e.stopPropagation();

      // Close any other open dropdown on this page
      if (activeChannelListDropdown && activeChannelListDropdown.shadow !== shadow) {
        const prev = activeChannelListDropdown;
        activeChannelListDropdown = null;
        renderChannelListButton(prev.shadow, prev.host, prev.handle, prev.channelName, false);
      }

      const nowOpen = !isOpen;
      activeChannelListDropdown = nowOpen ? { shadow, host, handle, channelName } : null;
      renderChannelListButton(shadow, host, handle, channelName, nowOpen);
    });

    if (isOpen) {
      // Attach checkbox listeners
      shadow.querySelectorAll('input[data-playlist]').forEach(cb => {
        cb.addEventListener('change', async () => {
          try {
            await sendMsg({
              type: 'ASSIGN_CHANNEL_PLAYLIST',
              handle,
              name: channelName,
              playlistId: cb.dataset.playlist,
              assign: cb.checked
            });
            data = await sendMsg({ type: 'GET_ALL_DATA' });
            buildLookupMaps();
            activeChannelListDropdown = { shadow, host, handle, channelName };
            renderChannelListButton(shadow, host, handle, channelName, true);
          } catch (error) {
            handleActionError(error);
            cb.checked = !cb.checked;
          }
        });
      });

      shadow.querySelectorAll('[data-action="manage"]').forEach(btn => {
        btn.addEventListener('click', () => {
          void sendMsg({ type: 'OPEN_OPTIONS' }).catch((error) => handleActionError(error));
        });
      });

      attachInlineCreateListener(shadow, () => {
        activeChannelListDropdown = { shadow, host, handle, channelName };
        renderChannelListButton(shadow, host, handle, channelName, true);
      });

      // Outside click closes dropdown
      const closeHandler = (e) => {
        const path = e.composedPath();
        if (path.includes(host)) return;
        clearDocumentCloseListener(channelListCloseState);
        activeChannelListDropdown = null;
        renderChannelListButton(shadow, host, handle, channelName, false);
      };
      armDocumentCloseListener(channelListCloseState, closeHandler);
    } else {
      clearDocumentCloseListener(channelListCloseState);
    }
  }

  function refreshChannelListButtons() {
    document.querySelectorAll('ytd-channel-renderer').forEach(renderer => {
      const host = renderer.querySelector('.syp-host');
      if (!host || !host.shadowRoot) return;

      const channelLink = renderer.querySelector('a.channel-link[href*="/@"]')
        || renderer.querySelector('a.channel-link[href*="/channel/"]');
      if (!channelLink) return;
      const handle = extractHandleFromUrl(channelLink.getAttribute('href') || '');
      if (!handle) return;

      const nameEl = renderer.querySelector('ytd-channel-name yt-formatted-string');
      const channelName = nameEl?.textContent?.trim() || handle;

      const isOpen = activeChannelListDropdown?.handle === handle;
      renderChannelListButton(host.shadowRoot, host, handle, channelName, isOpen);
    });
  }

  function observeChannelsList() {
    const container = document.querySelector('ytd-section-list-renderer #contents')
      || document.querySelector('ytd-browse[page-subtype="channels"] #contents');
    if (!container) return;

    let debounceTimer = null;
    channelsListObserver = new MutationObserver(() => {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        injectChannelListButtons();
      }, 200);
    });

    channelsListObserver.observe(container, { childList: true, subtree: true });
  }

  // --- Channel Page ---

  function getChannelHeaderScope(container) {
    return container?.closest('#page-header, ytd-c4-tabbed-header-renderer, yt-page-header-view-model') || null;
  }

  function isUsableChannelActionsContainer(container) {
    if (!container || !container.isConnected || container.hasAttribute('hidden')) return false;

    const scope = getChannelHeaderScope(container);
    if (!isVisibleElement(scope || container)) return false;

    return Boolean(
      container.querySelector('button, button-view-model, .yt-flexible-actions-view-model-action, .yt-flexible-actions-view-model-wiz__action') ||
      container.children.length > 0
    );
  }

  function getVisibleChannelActionsContainer(handle) {
    const containers = Array.from(document.querySelectorAll('yt-flexible-actions-view-model'))
      .filter(isUsableChannelActionsContainer);

    const exactMatch = containers.find(container => {
      const scope = getChannelHeaderScope(container) || document;
      return Array.from(scope.querySelectorAll('a[href*="/@"], a[href*="/channel/"]'))
        .some(link => extractHandleFromUrl(link.getAttribute('href') || '') === handle);
    });

    if (exactMatch) return exactMatch;

    return containers.find(container => {
      const scope = getChannelHeaderScope(container);
      if (!scope) return false;

      const titleEl = scope.querySelector('h1, ytd-channel-name yt-formatted-string');
      return Boolean(titleEl?.textContent?.trim());
    }) || null;
  }

  function getChannelPageName(actionsContainer, fallbackHandle) {
    const channelScope = getChannelHeaderScope(actionsContainer) || document;
    const nameEl = channelScope.querySelector('yt-page-header-view-model h1')
      || channelScope.querySelector('ytd-channel-name yt-formatted-string');
    return nameEl?.textContent?.trim()?.replace(/\s+/g, ' ') || fallbackHandle;
  }

  function mountChannelQuickAdd(actionsContainer, handle, channelName) {
    if (!actionsContainer) return false;

    const existingHost = actionsContainer.querySelector(':scope > .syp-channel-qa-host');
    if (existingHost?.shadowRoot) {
      quickAddHandle = handle;
      quickAddHost = existingHost;
      quickAddShadow = existingHost.shadowRoot;
      renderQuickAddButton(handle, channelName);
      return true;
    }

    quickAddHandle = handle;
    quickAddHost = document.createElement('div');
    quickAddHost.className = 'syp-host syp-channel-qa-host ytFlexibleActionsViewModelAction';
    quickAddHost.style.cssText = 'all: initial; display: inline-flex; vertical-align: middle; position: relative; z-index: 2000;';
    actionsContainer.appendChild(quickAddHost);

    quickAddShadow = quickAddHost.attachShadow({ mode: 'open' });
    renderQuickAddButton(handle, channelName);
    return true;
  }

  function observeChannelQuickAdd(handle, gen) {
    if (quickAddObserver) {
      quickAddObserver.disconnect();
      quickAddObserver = null;
    }

    let debounceTimer = null;
    quickAddObserver = new MutationObserver(() => {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        if (gen !== initGeneration || currentPage !== 'channel') return;

        const actionsContainer = getVisibleChannelActionsContainer(handle);
        if (!actionsContainer) return;
        if (quickAddHost?.isConnected && actionsContainer.contains(quickAddHost)) return;

        const channelName = getChannelPageName(actionsContainer, handle);
        if (!mountChannelQuickAdd(actionsContainer, handle, channelName)) return;
        initSucceeded = true;
      }, 150);
    });

    quickAddObserver.observe(document.documentElement, { childList: true, subtree: true });
  }

  async function initChannelPage(url, gen) {
    try {
      await loadData();
    } catch (error) {
      console.warn('SYO failed to load channel page data', error);
      return;
    }
    if (!data || gen !== initGeneration) return;
    const handle = extractHandleFromUrl(url);
    if (!handle) return;

    // Modern YouTube channel pages use yt-flexible-actions-view-model for the subscribe area
    // inside #page-header > yt-page-header-renderer > yt-page-header-view-model
    const actionsContainer = await waitForElement(() => getVisibleChannelActionsContainer(handle));
    if (!actionsContainer || gen !== initGeneration) return;

    const channelName = getChannelPageName(actionsContainer, handle);

    void sendMsg({ type: 'REGISTER_CHANNEL', handle, name: channelName }).catch((error) => {
      console.warn('SYO failed to register channel page channel', error);
    });

    if (!mountChannelQuickAdd(actionsContainer, handle, channelName)) return;
    observeChannelQuickAdd(handle, gen);
    initSucceeded = true;
  }

  // --- Video Page ---

  function getVisibleVideoTopRow() {
    return Array.from(document.querySelectorAll('#top-row'))
      .find(row => (
        isVisibleElement(row) &&
        row.querySelector('#owner') &&
        row.querySelector('#subscribe-button')
      )) || null;
  }

  function getVisibleVideoSubscribeButton() {
    return getVisibleVideoTopRow()?.querySelector('#subscribe-button') || null;
  }

  async function initVideoPage(gen) {
    try {
      await loadData();
    } catch (error) {
      console.warn('SYO failed to load video page data', error);
      return;
    }
    if (!data || gen !== initGeneration) return;

    // Video page layout: #top-row > #owner contains channel info + #subscribe-button
    const subscribeBtn = await waitForElement(getVisibleVideoSubscribeButton);
    if (!subscribeBtn || gen !== initGeneration) return;

    // Find channel handle from the owner section
    const ownerEl = getVisibleVideoTopRow()?.querySelector('#owner');
    const handleLink = ownerEl?.querySelector('a[href*="/@"]')
      || ownerEl?.querySelector('a[href*="/channel/"]');

    if (!handleLink) return;

    const handle = extractHandleFromUrl(handleLink.getAttribute('href') || '');
    if (!handle) return;

    const nameEl = ownerEl?.querySelector('ytd-channel-name a, ytd-channel-name yt-formatted-string, yt-formatted-string a');
    const channelName = nameEl?.textContent?.trim() || handle;

    void sendMsg({ type: 'REGISTER_CHANNEL', handle, name: channelName }).catch((error) => {
      console.warn('SYO failed to register video channel', error);
    });

    // Insert our button right after the subscribe button
    quickAddHandle = handle;
    quickAddHost = document.createElement('div');
    quickAddHost.className = 'syp-host';
    quickAddHost.style.cssText = 'all: initial; display: inline-flex; align-items: center; vertical-align: middle; margin-left: 8px; position: relative; z-index: 2000;';
    subscribeBtn.parentElement.insertBefore(quickAddHost, subscribeBtn.nextSibling);

    quickAddShadow = quickAddHost.attachShadow({ mode: 'open' });
    renderQuickAddButton(handle, channelName);
    initSucceeded = true;
  }

  // --- Quick-Add Button + Dropdown ---

  let quickAddHost = null;
  let quickAddShadow = null;
  let quickAddOpen = false;
  let quickAddHandle = null;

  function renderQuickAddButton(handle, channelName) {
    if (!quickAddShadow) return;
    if (quickAddHost) quickAddHost.style.zIndex = quickAddOpen ? '9999' : '2000';
    const isDark = document.documentElement.hasAttribute('dark');

    quickAddShadow.innerHTML = `
      <style>
        * { box-sizing: border-box; margin: 0; padding: 0; }
        .syp-qa-trigger {
          display: inline-flex;
          align-items: center;
          gap: 4px;
          padding: 8px 16px;
          border-radius: 18px;
          border: none;
          background: ${isDark ? '#272727' : '#f2f2f2'};
          color: ${isDark ? '#f1f1f1' : '#0f0f0f'};
          cursor: pointer;
          font-family: 'Roboto', 'Arial', sans-serif;
          font-size: 14px;
          font-weight: 500;
        }
        .syp-qa-trigger:hover {
          background: ${isDark ? '#3a3a3a' : '#e0e0e0'};
        }
        .syp-qa-trigger .syp-badge {
          background: #4a9eff;
          color: #fff;
          font-size: 11px;
          padding: 1px 6px;
          border-radius: 10px;
          font-weight: 600;
        }
        ${getDropdownStyles(isDark)}
      </style>
      <div style="position: relative; display: inline-block;">
        <button class="syp-qa-trigger" id="syp-trigger">+ Playlist${(() => { const c = ((data?.channelPlaylists || {})[handle] || []).length; return c > 0 ? ` <span class="syp-badge">${c}</span>` : ''; })()}</button>
        ${quickAddOpen ? renderDropdownHTML(handle) : ''}
      </div>
    `;

    const trigger = quickAddShadow.getElementById('syp-trigger');
    trigger.addEventListener('click', (e) => {
      e.stopPropagation();
      quickAddOpen = !quickAddOpen;
      renderQuickAddButton(handle, channelName);
    });

    if (quickAddOpen) {
      attachDropdownListeners(handle, channelName);

      const closeHandler = (e) => {
        // Check if click is inside shadow DOM
        const path = e.composedPath();
        if (path.includes(quickAddHost)) return;
        clearDocumentCloseListener(quickAddCloseState);
        quickAddOpen = false;
        renderQuickAddButton(handle, channelName);
      };
      armDocumentCloseListener(quickAddCloseState, closeHandler);
    } else {
      clearDocumentCloseListener(quickAddCloseState);
    }
  }

  function getDropdownStyles(isDark) {
    const bg = isDark ? '#1a1a1e' : '#f8f8fa';
    const borderC = isDark ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.08)';
    const txt = isDark ? '#e4e4e8' : '#1a1a1e';
    const txtSub = isDark ? 'rgba(255,255,255,0.4)' : 'rgba(0,0,0,0.38)';
    const hoverBg = isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)';
    const shadow = isDark
      ? '0 8px 40px rgba(0,0,0,0.55), 0 2px 8px rgba(0,0,0,0.3)'
      : '0 8px 40px rgba(0,0,0,0.12), 0 2px 8px rgba(0,0,0,0.06)';

    return `
      @keyframes syp-dd-in {
        from { opacity: 0; transform: scale(0.96) translateY(-6px); }
        to { opacity: 1; transform: scale(1) translateY(0); }
      }
      .syp-dropdown {
        position: absolute;
        top: calc(100% + 8px);
        right: 0;
        width: 272px;
        background: ${bg};
        backdrop-filter: blur(16px) saturate(140%);
        -webkit-backdrop-filter: blur(16px) saturate(140%);
        border: 1px solid ${borderC};
        border-radius: 14px;
        box-shadow: ${shadow};
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
        font-size: 13px;
        color: ${txt};
        overflow: hidden;
        z-index: 9999;
        animation: syp-dd-in 0.2s cubic-bezier(0.16, 1, 0.3, 1);
        transform-origin: top right;
      }
      .syp-dd-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 14px 16px 8px;
        font-size: 10px;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.08em;
        color: ${txtSub};
      }
      .syp-dd-add-btn {
        width: 20px;
        height: 20px;
        border: 1.5px solid ${isDark ? 'rgba(255,255,255,0.15)' : 'rgba(0,0,0,0.15)'};
        border-radius: 6px;
        background: transparent;
        color: ${txtSub};
        font-size: 14px;
        line-height: 1;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        transition: all 0.15s ease;
        padding: 0;
      }
      .syp-dd-add-btn:hover {
        border-color: ${isDark ? '#6ab4ff' : '#2568c4'};
        color: ${isDark ? '#6ab4ff' : '#2568c4'};
        background: ${isDark ? 'rgba(74,158,255,0.08)' : 'rgba(37,104,196,0.06)'};
      }
      .syp-dd-add-btn:active { opacity: 0.7; }
      .syp-dd-list {
        max-height: 220px;
        overflow-y: auto;
        scrollbar-width: thin;
        scrollbar-color: ${isDark ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.1)'} transparent;
        padding: 0 6px;
      }
      .syp-dd-list::-webkit-scrollbar { width: 4px; }
      .syp-dd-list::-webkit-scrollbar-track { background: transparent; }
      .syp-dd-list::-webkit-scrollbar-thumb {
        background: ${isDark ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.1)'};
        border-radius: 4px;
      }
      .syp-dd-item {
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 7px 10px;
        border-radius: 8px;
        cursor: pointer;
        transition: background 0.12s ease;
        position: relative;
      }
      .syp-dd-item:hover {
        background: ${hoverBg};
      }
      .syp-dd-item input[type="checkbox"] {
        position: absolute;
        opacity: 0;
        width: 0;
        height: 0;
        pointer-events: none;
      }
      .syp-dd-check {
        width: 18px;
        height: 18px;
        border-radius: 6px;
        border: 1.5px solid ${isDark ? 'rgba(255,255,255,0.18)' : 'rgba(0,0,0,0.2)'};
        display: flex;
        align-items: center;
        justify-content: center;
        flex-shrink: 0;
        transition: all 0.18s cubic-bezier(0.16, 1, 0.3, 1);
      }
      .syp-dd-check svg {
        width: 10px;
        height: 10px;
        opacity: 0;
        transform: scale(0.5);
        transition: all 0.18s cubic-bezier(0.16, 1, 0.3, 1);
      }
      .syp-dd-item.checked .syp-dd-check {
        border-color: transparent;
      }
      .syp-dd-item.checked .syp-dd-check svg {
        opacity: 1;
        transform: scale(1);
      }
      .syp-dd-color {
        width: 3px;
        height: 18px;
        border-radius: 2px;
        flex-shrink: 0;
        opacity: 0.7;
        transition: opacity 0.15s, height 0.15s;
      }
      .syp-dd-item:hover .syp-dd-color,
      .syp-dd-item.checked .syp-dd-color {
        opacity: 1;
      }
      .syp-dd-name {
        flex: 1;
        font-size: 13px;
        font-weight: 450;
        letter-spacing: -0.01em;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .syp-dd-inline-input {
        flex: 1;
        min-width: 0;
        padding: 0;
        border: none;
        background: transparent;
        color: ${txt};
        font-family: inherit;
        font-size: 13px;
        font-weight: 450;
        letter-spacing: -0.01em;
        outline: none;
        caret-color: ${isDark ? '#6ab4ff' : '#2568c4'};
      }
      .syp-dd-inline-input::placeholder {
        color: ${txtSub};
      }
      .syp-dd-sep {
        height: 1px;
        background: ${borderC};
        margin: 6px 16px;
      }
      .syp-dd-empty {
        padding: 20px 16px;
        color: ${txtSub};
        font-size: 12px;
        text-align: center;
        line-height: 1.5;
      }
      .syp-dd-footer {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 10px 16px;
        cursor: pointer;
        color: ${txtSub};
        font-size: 12px;
        font-weight: 500;
        transition: color 0.12s;
      }
      .syp-dd-footer:hover {
        color: ${txt};
      }
      .syp-dd-footer svg {
        width: 14px;
        height: 14px;
        transition: transform 0.15s ease;
      }
      .syp-dd-footer:hover svg {
        transform: translateX(2px);
      }
    `;
  }

  function renderDropdownHTML(handle) {
    if (!data) return '';
    const isDark = document.documentElement.hasAttribute('dark');
    const playlists = Object.values(data.playlists || {}).sort((a, b) => a.order - b.order);
    const assignments = (data.channelPlaylists || {})[handle] || [];

    const checkSvg = `<svg viewBox="0 0 10 10" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M2 5.5L4.2 7.5L8 3"/></svg>`;
    const arrowSvg = `<svg viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M5 3l5 4-5 4"/></svg>`;

    let html = `<div class="syp-dropdown">`;
    html += `<div class="syp-dd-header"><span>Playlists</span><button class="syp-dd-add-btn" data-action="add-inline" title="New playlist">+</button></div>`;

    html += `<div class="syp-dd-list">`;
    if (playlists.length === 0) {
      html += `<div class="syp-dd-empty">No playlists yet.<br>Hit + to create one.</div>`;
    }
    for (const pl of playlists) {
      const isChecked = assignments.includes(pl.id);
      html += `<label class="syp-dd-item${isChecked ? ' checked' : ''}">
        <input type="checkbox" data-playlist="${pl.id}" ${isChecked ? 'checked' : ''}>
        <span class="syp-dd-check" style="${isChecked ? `background:${pl.color}; border-color:transparent;` : ''}">${checkSvg}</span>
        <span class="syp-dd-color" style="background:${pl.color}"></span>
        <span class="syp-dd-name">${escapeHtml(pl.name)}</span>
      </label>`;
    }
    html += `</div>`;

    html += `<div class="syp-dd-sep"></div>`;
    html += `<div class="syp-dd-footer" data-action="manage">Manage playlists ${arrowSvg}</div>`;
    html += `</div>`;
    return html;
  }

  function attachInlineCreateListener(shadowRoot, onCreated) {
    const addBtn = shadowRoot.querySelector('[data-action="add-inline"]');
    if (!addBtn) return;
    addBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const list = shadowRoot.querySelector('.syp-dd-list');
      if (!list || list.querySelector('.syp-dd-inline-input')) return;

      // Remove empty state if present
      const empty = list.querySelector('.syp-dd-empty');
      if (empty) empty.style.display = 'none';

      // Pick a random color for the visual preview
      const colors = ['#4a9eff', '#5cb85c', '#f39c12', '#d9534f', '#8e44ad', '#1abc9c', '#e74c3c', '#3498db'];
      const color = colors[Math.floor(Math.random() * colors.length)];

      const row = document.createElement('div');
      row.className = 'syp-dd-item';
      row.innerHTML = `
        <span class="syp-dd-check" style="border-color:transparent; background:${color};">
          <svg viewBox="0 0 10 10" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="opacity:0;"><path d="M2 5.5L4.2 7.5L8 3"/></svg>
        </span>
        <span class="syp-dd-color" style="background:${color}; opacity:1;"></span>
        <input type="text" class="syp-dd-inline-input" placeholder="Playlist name..." autofocus>
      `;
      list.appendChild(row);

      const input = row.querySelector('input');
      input.focus();
      list.scrollTop = list.scrollHeight;

      let settled = false;

      const commit = async () => {
        if (settled) return;
        const name = input.value.trim();
        if (!name) { discard(); return; }
        settled = true;
        try {
          await sendMsg({ type: 'CREATE_PLAYLIST', name, color });
          data = await sendMsg({ type: 'GET_ALL_DATA' });
          buildLookupMaps();
          onCreated();
        } catch (error) {
          settled = false;
          handleActionError(error, 'Could not create the playlist.');
        }
      };

      const discard = () => {
        if (settled) return;
        settled = true;
        row.remove();
        const emptyEl = list.querySelector('.syp-dd-empty');
        if (emptyEl && list.children.length <= 1) emptyEl.style.display = '';
      };

      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); commit(); }
        if (e.key === 'Escape') { e.preventDefault(); discard(); }
      });
      input.addEventListener('blur', () => {
        setTimeout(discard, 120);
      });
    });
  }

  function attachDropdownListeners(handle, channelName) {
    if (!quickAddShadow) return;

    quickAddShadow.querySelectorAll('input[data-playlist]').forEach(cb => {
      cb.addEventListener('change', async () => {
        try {
          await sendMsg({
            type: 'ASSIGN_CHANNEL_PLAYLIST',
            handle,
            name: channelName,
            playlistId: cb.dataset.playlist,
            assign: cb.checked
          });
          data = await sendMsg({ type: 'GET_ALL_DATA' });
          buildLookupMaps();
          renderQuickAddButton(handle, channelName);
        } catch (error) {
          handleActionError(error);
          cb.checked = !cb.checked;
        }
      });
    });

    quickAddShadow.querySelectorAll('[data-action="manage"]').forEach(btn => {
      btn.addEventListener('click', () => {
        void sendMsg({ type: 'OPEN_OPTIONS' }).catch((error) => handleActionError(error));
      });
    });

    attachInlineCreateListener(quickAddShadow, () => {
      renderQuickAddButton(handle, channelName);
    });
  }

  function getQuickAddChannelName() {
    if (!quickAddHandle) return null;

    if (currentPage === 'channel') {
      const actionsContainer = getVisibleChannelActionsContainer(quickAddHandle);
      if (actionsContainer) {
        return getChannelPageName(actionsContainer, quickAddHandle);
      }
    }

    if (currentPage === 'video') {
      const ownerEl = getVisibleVideoTopRow()?.querySelector('#owner');
      const nameEl = ownerEl?.querySelector('ytd-channel-name a, ytd-channel-name yt-formatted-string, yt-formatted-string a');
      return nameEl?.textContent?.trim() || quickAddHandle;
    }

    return quickAddHandle;
  }

  function scheduleQuickAddRefresh() {
    if (!quickAddHandle || !quickAddShadow || !quickAddHost?.isConnected) return;
    clearTimeout(quickAddRefreshTimer);
    quickAddRefreshTimer = setTimeout(() => {
      quickAddRefreshTimer = null;
      updateQuickAddState();
    }, 150);
  }

  function updateQuickAddState() {
    if (!quickAddHandle || !quickAddShadow || !quickAddHost?.isConnected) return;
    const name = getQuickAddChannelName();
    renderQuickAddButton(quickAddHandle, name || quickAddHandle);
  }

  // --- Helpers ---

  function extractHandleFromUrl(url) {
    const match = url.match(/\/@([^/?]+)/);
    if (match) return '@' + match[1];
    const channelMatch = url.match(/\/channel\/([^/?]+)/);
    if (channelMatch) return channelMatch[1];
    return null;
  }

  function waitForElement(selectorOrGetter, timeout = 10000) {
    const getElement = typeof selectorOrGetter === 'function'
      ? selectorOrGetter
      : () => document.querySelector(selectorOrGetter);

    return new Promise((resolve) => {
      // Try immediately
      const el = getElement();
      if (el) return resolve(el);

      // Retry with observer
      const observer = new MutationObserver(() => {
        const el = getElement();
        if (el) { observer.disconnect(); clearTimeout(timer); resolve(el); }
      });
      observer.observe(document.documentElement, { childList: true, subtree: true });

      const timer = setTimeout(() => { observer.disconnect(); resolve(null); }, timeout);
    });
  }

  function clearDocumentCloseListener(state) {
    if (state.timer) {
      clearTimeout(state.timer);
      state.timer = null;
    }
    if (state.handler) {
      document.removeEventListener('click', state.handler, true);
      state.handler = null;
    }
  }

  function armDocumentCloseListener(state, handler) {
    clearDocumentCloseListener(state);
    state.handler = handler;
    state.timer = setTimeout(() => {
      if (state.handler !== handler) return;
      document.addEventListener('click', handler, true);
      state.timer = null;
    }, 0);
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  // --- Init ---

  startUrlPoll();
  handleNavigation(window.location.href);
})();
