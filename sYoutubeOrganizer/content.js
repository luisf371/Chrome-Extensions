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
  let activePlaylistId = null;
  let initSucceeded = false;
  let initGeneration = 0; // increments on each navigation to cancel stale async inits
  let navDebounceTimer = null;
  const quickAddCloseState = { handler: null, timer: null };
  const channelListCloseState = { handler: null, timer: null };

  const UNCATEGORIZED_ID = '__uncategorized';

  // Runtime lookup: playlistId -> Set<handle>
  let playlistChannels = new Map();
  let allAssignedHandles = new Set();

  // --- SPA Navigation ---

  function scheduleNavigation(url) {
    // Skip if same URL and already successfully initialized
    if (url === lastUrl && initSucceeded) return;
    // Debounce rapid duplicate events (load + yt-navigate-finish + yt-page-data-updated)
    clearTimeout(navDebounceTimer);
    navDebounceTimer = setTimeout(() => {
      lastUrl = url;
      handleNavigation(url);
    }, 80);
  }

  window.addEventListener('message', (event) => {
    if (event.source !== window) return;
    if (event.data?.type === 'SYO_NAV_EVENT') {
      scheduleNavigation(event.data.url);
    }
  });

  function startUrlPoll() {
    if (pollInterval) return;
    lastUrl = window.location.href;
    pollInterval = setInterval(() => {
      const url = window.location.href;
      if (url !== lastUrl) {
        lastUrl = url;
        handleNavigation(url);
      } else if (!initSucceeded && currentPage) {
        // Retry failed initialization (e.g. DOM wasn't ready or service worker was asleep)
        handleNavigation(url);
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
        renderFilterBar();
        applyFilter();
      }
      if (currentPage === 'channel' || currentPage === 'video') {
        updateQuickAddState();
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
    const gen = ++initGeneration; // cancel any in-flight async inits

    if (url.includes('/feed/subscriptions')) {
      currentPage = 'subscriptions';
      initSubscriptionsPage(gen);
    } else if (url.includes('/feed/channels')) {
      currentPage = 'channelsList';
      initChannelsListPage(gen);
    } else if (url.match(/\/@[^/]+/) || url.includes('/channel/')) {
      currentPage = 'channel';
      initChannelPage(url, gen);
    } else if (url.includes('/watch')) {
      currentPage = 'video';
      initVideoPage(gen);
    } else {
      currentPage = null;
      initSucceeded = true;
    }
  }

  function cleanup() {
    if (feedObserver) { feedObserver.disconnect(); feedObserver = null; }
    if (channelsListObserver) { channelsListObserver.disconnect(); channelsListObserver = null; }
    if (quickAddObserver) { quickAddObserver.disconnect(); quickAddObserver = null; }
    clearDocumentCloseListener(quickAddCloseState);
    clearDocumentCloseListener(channelListCloseState);
    activeChannelListDropdown = null;
    document.querySelectorAll('.syo-host').forEach(el => el.remove());
    filterHost = null;
    filterShadow = null;
    activePlaylistId = null;
    quickAddOpen = false;
    quickAddHost = null;
    quickAddShadow = null;
    quickAddHandle = null;
  }

  // --- Data Loading ---

  function sendMsg(msg) {
    try {
      if (!chrome.runtime?.id) return Promise.resolve(null);
      return chrome.runtime.sendMessage(msg);
    } catch {
      return Promise.resolve(null);
    }
  }

  async function loadData() {
    data = await sendMsg({ type: 'GET_ALL_DATA' });
    if (!data) return;
    buildLookupMaps();
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

  function getSubscriptionsGrid() {
    const browse = getActiveSubscriptionsBrowse();
    return browse?.querySelector('ytd-rich-grid-renderer') || null;
  }

  function getSubscriptionsContents() {
    return getSubscriptionsGrid()?.querySelector('#contents') || null;
  }

  async function initSubscriptionsPage(gen) {
    await loadData();
    if (!data || gen !== initGeneration) return;
    const contents = await waitForElement(getSubscriptionsContents);
    if (!contents || gen !== initGeneration) return;
    if (!injectFilterBar()) return;
    applyFilter();
    if (!observeFeed()) return;
    initSucceeded = true;
  }

  function injectFilterBar() {
    if (filterHost?.isConnected && filterShadow) {
      renderFilterBar();
      return true;
    }

    const grid = getSubscriptionsGrid();
    if (!grid || !grid.parentElement) return false;

    const existingHost = grid.parentElement.querySelector(':scope > .syo-filter-host');
    if (existingHost?.shadowRoot) {
      filterHost = existingHost;
      filterShadow = existingHost.shadowRoot;
      renderFilterBar();
      return true;
    }

    filterHost = document.createElement('div');
    filterHost.className = 'syo-host syo-filter-host';
    filterHost.style.cssText = 'all: initial; display: block;';
    grid.parentElement.insertBefore(filterHost, grid);

    filterShadow = filterHost.attachShadow({ mode: 'open' });
    renderFilterBar();
    return true;
  }

  function renderFilterBar() {
    if (!filterShadow || !data) return;

    const isDark = document.documentElement.hasAttribute('dark');
    const playlists = Object.values(data.playlists || {}).sort((a, b) => a.order - b.order);

    filterShadow.innerHTML = `
      <style>
        :host { display: block; }
        * { box-sizing: border-box; margin: 0; padding: 0; }
        .syo-bar {
          position: sticky;
          top: 0;
          z-index: 100;
          padding: 8px 0 4px;
          background: ${isDark ? '#0f0f0f' : '#ffffff'};
          font-family: 'Roboto', 'Arial', sans-serif;
          font-size: 14px;
        }
        .syo-row {
          display: flex;
          gap: 8px;
          padding: 4px 0;
          overflow-x: auto;
          scrollbar-width: none;
          align-items: center;
        }
        .syo-row::-webkit-scrollbar { display: none; }
        .syo-btn {
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
        .syo-btn:hover {
          background: ${isDark ? '#3a3a3a' : '#e0e0e0'};
        }
        .syo-btn.active {
          background: ${isDark ? '#f1f1f1' : '#0f0f0f'};
          color: ${isDark ? '#0f0f0f' : '#f1f1f1'};
        }
        .syo-btn .syo-dot {
          width: 8px;
          height: 8px;
          border-radius: 50%;
          flex-shrink: 0;
        }
        .syo-btn .syo-count {
          font-size: 12px;
          opacity: 0.7;
        }
        .syo-manage {
          margin-left: auto;
          background: transparent;
          color: ${isDark ? '#aaa' : '#606060'};
          font-size: 13px;
          padding: 6px 10px;
        }
        .syo-manage:hover {
          color: ${isDark ? '#f1f1f1' : '#0f0f0f'};
          background: ${isDark ? '#272727' : '#f2f2f2'};
        }
      </style>
      <div class="syo-bar">
        <div class="syo-row">
          <button class="syo-btn ${!activePlaylistId ? 'active' : ''}" data-action="all">All</button>
          ${playlists.map(pl => {
            const count = playlistChannels.get(pl.id)?.size || 0;
            return `<button class="syo-btn ${activePlaylistId === pl.id ? 'active' : ''}" data-playlist="${pl.id}">
              <span class="syo-dot" style="background:${pl.color}"></span>
              ${escapeHtml(pl.name)}
              <span class="syo-count">${count}</span>
            </button>`;
          }).join('')}
          <button class="syo-btn ${activePlaylistId === UNCATEGORIZED_ID ? 'active' : ''}" data-action="uncategorized">
            <span class="syo-dot" style="background:${isDark ? '#666' : '#999'}"></span>
            Uncategorized
          </button>
          <button class="syo-btn syo-manage" data-action="manage">Manage</button>
        </div>
      </div>
    `;

    filterShadow.querySelectorAll('[data-action="all"]').forEach(btn => {
      btn.addEventListener('click', () => {
        activePlaylistId = null;
        renderFilterBar();
        applyFilter();
      });
    });

    filterShadow.querySelectorAll('[data-playlist]').forEach(btn => {
      btn.addEventListener('click', () => {
        activePlaylistId = btn.dataset.playlist;
        renderFilterBar();
        applyFilter();
      });
    });

    filterShadow.querySelectorAll('[data-action="uncategorized"]').forEach(btn => {
      btn.addEventListener('click', () => {
        activePlaylistId = UNCATEGORIZED_ID;
        renderFilterBar();
        applyFilter();
      });
    });

    filterShadow.querySelectorAll('[data-action="manage"]').forEach(btn => {
      btn.addEventListener('click', () => {
        sendMsg({ type: 'OPEN_OPTIONS' });
      });
    });
  }

  function applyFilter() {
    const cards = getSubscriptionsGrid()?.querySelectorAll('ytd-rich-item-renderer') || [];

    if (!activePlaylistId) {
      cards.forEach(card => { card.style.display = ''; });
      return;
    }

    let allowedHandles;
    if (activePlaylistId === UNCATEGORIZED_ID) {
      allowedHandles = null; // special case below
    } else {
      allowedHandles = playlistChannels.get(activePlaylistId) || new Set();
    }

    cards.forEach(card => {
      const handle = extractHandleFromCard(card);
      let show;
      if (activePlaylistId === UNCATEGORIZED_ID) {
        show = handle && !allAssignedHandles.has(handle);
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

        if (!activePlaylistId) return;

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
    await loadData();
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
      if (renderer.querySelector('.syo-host')) return;

      const buttonsDiv = renderer.querySelector('#buttons');
      if (!buttonsDiv) return;

      const channelLink = renderer.querySelector('a.channel-link[href*="/@"]');
      if (!channelLink) return;
      const match = channelLink.getAttribute('href').match(/\/@([^/?]+)/);
      if (!match) return;
      const handle = '@' + match[1];

      const nameEl = renderer.querySelector('ytd-channel-name yt-formatted-string');
      const channelName = nameEl?.textContent?.trim() || handle;

      sendMsg({ type: 'REGISTER_CHANNEL', handle, name: channelName });

      const subscribeBtn = renderer.querySelector('#subscribe-button');
      if (!subscribeBtn) return;

      const host = document.createElement('div');
      host.className = 'syo-host';
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
        .syo-qa-trigger {
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
        .syo-qa-trigger:hover {
          background: ${isDark ? '#3a3a3a' : '#e0e0e0'};
        }
        .syo-qa-trigger .syo-badge {
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
        <button class="syo-qa-trigger" id="syo-trigger">
          + Playlist${assignedCount > 0 ? ` <span class="syo-badge">${assignedCount}</span>` : ''}
        </button>
        ${isOpen ? renderDropdownHTML(handle) : ''}
      </div>
    `;

    const trigger = shadow.getElementById('syo-trigger');
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
        });
      });

      shadow.querySelectorAll('[data-action="manage"]').forEach(btn => {
        btn.addEventListener('click', () => {
          sendMsg({ type: 'OPEN_OPTIONS' });
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
      const host = renderer.querySelector('.syo-host');
      if (!host || !host.shadowRoot) return;

      const channelLink = renderer.querySelector('a.channel-link[href*="/@"]');
      if (!channelLink) return;
      const match = channelLink.getAttribute('href').match(/\/@([^/?]+)/);
      if (!match) return;
      const handle = '@' + match[1];

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

    const existingHost = actionsContainer.querySelector(':scope > .syo-channel-qa-host');
    if (existingHost?.shadowRoot) {
      quickAddHandle = handle;
      quickAddHost = existingHost;
      quickAddShadow = existingHost.shadowRoot;
      renderQuickAddButton(handle, channelName);
      return true;
    }

    quickAddHandle = handle;
    quickAddHost = document.createElement('div');
    quickAddHost.className = 'syo-host syo-channel-qa-host ytFlexibleActionsViewModelAction';
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
    await loadData();
    if (!data || gen !== initGeneration) return;
    const handle = extractHandleFromUrl(url);
    if (!handle) return;

    // Modern YouTube channel pages use yt-flexible-actions-view-model for the subscribe area
    // inside #page-header > yt-page-header-renderer > yt-page-header-view-model
    const actionsContainer = await waitForElement(() => getVisibleChannelActionsContainer(handle));
    if (!actionsContainer || gen !== initGeneration) return;

    const channelName = getChannelPageName(actionsContainer, handle);

    sendMsg({ type: 'REGISTER_CHANNEL', handle, name: channelName });

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
    await loadData();
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

    sendMsg({ type: 'REGISTER_CHANNEL', handle, name: channelName });

    // Insert our button right after the subscribe button
    quickAddHandle = handle;
    quickAddHost = document.createElement('div');
    quickAddHost.className = 'syo-host';
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
        .syo-qa-trigger {
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
        .syo-qa-trigger:hover {
          background: ${isDark ? '#3a3a3a' : '#e0e0e0'};
        }
        .syo-qa-trigger .syo-badge {
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
        <button class="syo-qa-trigger" id="syo-trigger">+ Playlist${(() => { const c = ((data?.channelPlaylists || {})[handle] || []).length; return c > 0 ? ` <span class="syo-badge">${c}</span>` : ''; })()}</button>
        ${quickAddOpen ? renderDropdownHTML(handle) : ''}
      </div>
    `;

    const trigger = quickAddShadow.getElementById('syo-trigger');
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
      @keyframes syo-dd-in {
        from { opacity: 0; transform: scale(0.96) translateY(-6px); }
        to { opacity: 1; transform: scale(1) translateY(0); }
      }
      .syo-dropdown {
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
        animation: syo-dd-in 0.2s cubic-bezier(0.16, 1, 0.3, 1);
        transform-origin: top right;
      }
      .syo-dd-header {
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
      .syo-dd-add-btn {
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
      .syo-dd-add-btn:hover {
        border-color: ${isDark ? '#6ab4ff' : '#2568c4'};
        color: ${isDark ? '#6ab4ff' : '#2568c4'};
        background: ${isDark ? 'rgba(74,158,255,0.08)' : 'rgba(37,104,196,0.06)'};
      }
      .syo-dd-add-btn:active { opacity: 0.7; }
      .syo-dd-list {
        max-height: 220px;
        overflow-y: auto;
        scrollbar-width: thin;
        scrollbar-color: ${isDark ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.1)'} transparent;
        padding: 0 6px;
      }
      .syo-dd-list::-webkit-scrollbar { width: 4px; }
      .syo-dd-list::-webkit-scrollbar-track { background: transparent; }
      .syo-dd-list::-webkit-scrollbar-thumb {
        background: ${isDark ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.1)'};
        border-radius: 4px;
      }
      .syo-dd-item {
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 7px 10px;
        border-radius: 8px;
        cursor: pointer;
        transition: background 0.12s ease;
        position: relative;
      }
      .syo-dd-item:hover {
        background: ${hoverBg};
      }
      .syo-dd-item input[type="checkbox"] {
        position: absolute;
        opacity: 0;
        width: 0;
        height: 0;
        pointer-events: none;
      }
      .syo-dd-check {
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
      .syo-dd-check svg {
        width: 10px;
        height: 10px;
        opacity: 0;
        transform: scale(0.5);
        transition: all 0.18s cubic-bezier(0.16, 1, 0.3, 1);
      }
      .syo-dd-item.checked .syo-dd-check {
        border-color: transparent;
      }
      .syo-dd-item.checked .syo-dd-check svg {
        opacity: 1;
        transform: scale(1);
      }
      .syo-dd-color {
        width: 3px;
        height: 18px;
        border-radius: 2px;
        flex-shrink: 0;
        opacity: 0.7;
        transition: opacity 0.15s, height 0.15s;
      }
      .syo-dd-item:hover .syo-dd-color,
      .syo-dd-item.checked .syo-dd-color {
        opacity: 1;
      }
      .syo-dd-name {
        flex: 1;
        font-size: 13px;
        font-weight: 450;
        letter-spacing: -0.01em;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .syo-dd-inline-input {
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
      .syo-dd-inline-input::placeholder {
        color: ${txtSub};
      }
      .syo-dd-sep {
        height: 1px;
        background: ${borderC};
        margin: 6px 16px;
      }
      .syo-dd-empty {
        padding: 20px 16px;
        color: ${txtSub};
        font-size: 12px;
        text-align: center;
        line-height: 1.5;
      }
      .syo-dd-footer {
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
      .syo-dd-footer:hover {
        color: ${txt};
      }
      .syo-dd-footer svg {
        width: 14px;
        height: 14px;
        transition: transform 0.15s ease;
      }
      .syo-dd-footer:hover svg {
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

    let html = `<div class="syo-dropdown">`;
    html += `<div class="syo-dd-header"><span>Playlists</span><button class="syo-dd-add-btn" data-action="add-inline" title="New playlist">+</button></div>`;

    html += `<div class="syo-dd-list">`;
    if (playlists.length === 0) {
      html += `<div class="syo-dd-empty">No playlists yet.<br>Hit + to create one.</div>`;
    }
    for (const pl of playlists) {
      const isChecked = assignments.includes(pl.id);
      html += `<label class="syo-dd-item${isChecked ? ' checked' : ''}">
        <input type="checkbox" data-playlist="${pl.id}" ${isChecked ? 'checked' : ''}>
        <span class="syo-dd-check" style="${isChecked ? `background:${pl.color}; border-color:transparent;` : ''}">${checkSvg}</span>
        <span class="syo-dd-color" style="background:${pl.color}"></span>
        <span class="syo-dd-name">${escapeHtml(pl.name)}</span>
      </label>`;
    }
    html += `</div>`;

    html += `<div class="syo-dd-sep"></div>`;
    html += `<div class="syo-dd-footer" data-action="manage">Manage playlists ${arrowSvg}</div>`;
    html += `</div>`;
    return html;
  }

  function attachInlineCreateListener(shadowRoot, onCreated) {
    const addBtn = shadowRoot.querySelector('[data-action="add-inline"]');
    if (!addBtn) return;
    addBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const list = shadowRoot.querySelector('.syo-dd-list');
      if (!list || list.querySelector('.syo-dd-inline-input')) return;

      // Remove empty state if present
      const empty = list.querySelector('.syo-dd-empty');
      if (empty) empty.style.display = 'none';

      // Pick a random color for the visual preview
      const colors = ['#4a9eff','#5cb85c','#f39c12','#d9534f','#8e44ad','#1abc9c','#e74c3c','#3498db'];
      const color = colors[Math.floor(Math.random() * colors.length)];
      const isDark = document.documentElement.hasAttribute('dark');

      const row = document.createElement('div');
      row.className = 'syo-dd-item';
      row.innerHTML = `
        <span class="syo-dd-check" style="border-color:transparent; background:${color};">
          <svg viewBox="0 0 10 10" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="opacity:0;"><path d="M2 5.5L4.2 7.5L8 3"/></svg>
        </span>
        <span class="syo-dd-color" style="background:${color}; opacity:1;"></span>
        <input type="text" class="syo-dd-inline-input" placeholder="Playlist name..." autofocus>
      `;
      list.appendChild(row);

      const input = row.querySelector('input');
      input.focus();
      list.scrollTop = list.scrollHeight;

      const commit = async () => {
        const name = input.value.trim();
        if (name) {
          await sendMsg({ type: 'CREATE_PLAYLIST', name, color });
          data = await sendMsg({ type: 'GET_ALL_DATA' });
          buildLookupMaps();
          onCreated();
        } else {
          discard();
        }
      };

      const discard = () => {
        row.remove();
        const emptyEl = list.querySelector('.syo-dd-empty');
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
      });
    });

    quickAddShadow.querySelectorAll('[data-action="manage"]').forEach(btn => {
      btn.addEventListener('click', () => {
        sendMsg({ type: 'OPEN_OPTIONS' });
      });
    });

    attachInlineCreateListener(quickAddShadow, () => {
      renderQuickAddButton(handle, channelName);
    });
  }

  function updateQuickAddState() {
    if (!quickAddOpen || !quickAddHandle) return;
    const nameEl = document.querySelector('ytd-channel-name yt-formatted-string')
      || document.querySelector('ytd-video-owner-renderer yt-formatted-string a')
      || document.querySelector('#owner #channel-name a');
    const name = nameEl?.textContent?.trim() || quickAddHandle;
    renderQuickAddButton(quickAddHandle, name);
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
