(function () {
  'use strict';

  const app = globalThis.__SYP_CONTENT__;
  const { constants, state, api, pages } = app;

  function getActiveSubscriptionsBrowse() {
    return Array.from(document.querySelectorAll('ytd-browse[page-subtype="subscriptions"]'))
      .find(api.isVisibleElement) || null;
  }

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
    state.subscriptionsFilterMode = constants.FILTER_MODE_ALL;
    state.subscriptionsIncludePlaylistId = null;
    state.subduedPlaylistIds = new Set();
  }

  function setAllSubscriptionsFilter() {
    resetSubscriptionsFilterState();
  }

  function setIncludeSubscriptionsFilter(playlistId) {
    state.subscriptionsFilterMode = constants.FILTER_MODE_INCLUDE;
    state.subscriptionsIncludePlaylistId = playlistId;
    state.subduedPlaylistIds = new Set();
  }

  function setUncategorizedSubscriptionsFilter() {
    state.subscriptionsFilterMode = constants.FILTER_MODE_UNCATEGORIZED;
    state.subscriptionsIncludePlaylistId = null;
    state.subduedPlaylistIds = new Set();
  }

  function toggleExcludedSubscriptionsFilter(playlistId) {
    const next = new Set(state.subduedPlaylistIds);
    if (next.has(playlistId)) {
      next.delete(playlistId);
    } else {
      next.add(playlistId);
    }

    if (next.size === 0) {
      setAllSubscriptionsFilter();
      return;
    }

    state.subscriptionsFilterMode = constants.FILTER_MODE_EXCLUDE;
    state.subscriptionsIncludePlaylistId = null;
    state.subduedPlaylistIds = next;
  }

  function hasActiveSubscriptionsFilter() {
    return state.subscriptionsFilterMode !== constants.FILTER_MODE_ALL;
  }

  function getSavedSubscriptionsPreference() {
    return normalizeSubscriptionsFilterPreference(
      state.data?.settings?.[constants.SUBSCRIPTIONS_FILTER_PREFERENCE_KEY]
    );
  }

  function getCurrentSubscriptionsPreference() {
    if (state.subscriptionsFilterMode === constants.FILTER_MODE_INCLUDE) {
      if (!state.subscriptionsIncludePlaylistId || !state.data?.playlists?.[state.subscriptionsIncludePlaylistId]) return null;
      return {
        mode: constants.FILTER_MODE_INCLUDE,
        activePlaylistId: state.subscriptionsIncludePlaylistId,
        excludedPlaylistIds: []
      };
    }

    if (state.subscriptionsFilterMode === constants.FILTER_MODE_UNCATEGORIZED) {
      return {
        mode: constants.FILTER_MODE_UNCATEGORIZED,
        activePlaylistId: null,
        excludedPlaylistIds: []
      };
    }

    if (state.subscriptionsFilterMode === constants.FILTER_MODE_EXCLUDE) {
      const excludedPlaylistIds = Array.from(state.subduedPlaylistIds)
        .filter((playlistId) => state.data?.playlists?.[playlistId]);
      if (excludedPlaylistIds.length === 0) return null;
      return {
        mode: constants.FILTER_MODE_EXCLUDE,
        activePlaylistId: null,
        excludedPlaylistIds
      };
    }

    return null;
  }

  function normalizeSubscriptionsFilterPreference(preference) {
    if (!preference || typeof preference !== 'object') return null;

    const validPlaylistIds = new Set(Object.keys(state.data?.playlists || {}));

    if (preference.mode === constants.FILTER_MODE_INCLUDE) {
      const activePlaylistId = typeof preference.activePlaylistId === 'string'
        ? preference.activePlaylistId
        : null;
      if (!activePlaylistId || !validPlaylistIds.has(activePlaylistId)) return null;
      return {
        mode: constants.FILTER_MODE_INCLUDE,
        activePlaylistId,
        excludedPlaylistIds: []
      };
    }

    if (preference.mode === constants.FILTER_MODE_UNCATEGORIZED) {
      return {
        mode: constants.FILTER_MODE_UNCATEGORIZED,
        activePlaylistId: null,
        excludedPlaylistIds: []
      };
    }

    if (preference.mode === constants.FILTER_MODE_EXCLUDE) {
      const excludedPlaylistIds = Array.isArray(preference.excludedPlaylistIds)
        ? preference.excludedPlaylistIds.filter((playlistId) => (
          typeof playlistId === 'string' && validPlaylistIds.has(playlistId)
        ))
        : [];
      if (excludedPlaylistIds.length === 0) return null;
      return {
        mode: constants.FILTER_MODE_EXCLUDE,
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

    if (preference.mode === constants.FILTER_MODE_INCLUDE) {
      setIncludeSubscriptionsFilter(preference.activePlaylistId);
      return;
    }

    if (preference.mode === constants.FILTER_MODE_UNCATEGORIZED) {
      setUncategorizedSubscriptionsFilter();
      return;
    }

    if (preference.mode === constants.FILTER_MODE_EXCLUDE) {
      state.subscriptionsFilterMode = constants.FILTER_MODE_EXCLUDE;
      state.subscriptionsIncludePlaylistId = null;
      state.subduedPlaylistIds = new Set(preference.excludedPlaylistIds);
      return;
    }

    setAllSubscriptionsFilter();
  }

  function restoreSavedSubscriptionsPreference() {
    applySubscriptionsFilterPreference(getSavedSubscriptionsPreference());
  }

  function syncSubscriptionsFilterState() {
    const validPlaylistIds = new Set(Object.keys(state.data?.playlists || {}));

    if (state.subscriptionsFilterMode === constants.FILTER_MODE_INCLUDE) {
      if (!state.subscriptionsIncludePlaylistId || !validPlaylistIds.has(state.subscriptionsIncludePlaylistId)) {
        setAllSubscriptionsFilter();
      }
      return;
    }

    if (state.subscriptionsFilterMode === constants.FILTER_MODE_EXCLUDE) {
      state.subduedPlaylistIds = new Set(
        Array.from(state.subduedPlaylistIds).filter((playlistId) => validPlaylistIds.has(playlistId))
      );
      if (state.subduedPlaylistIds.size === 0) {
        setAllSubscriptionsFilter();
      }
      return;
    }

    if (state.subscriptionsFilterMode === constants.FILTER_MODE_UNCATEGORIZED) {
      state.subscriptionsIncludePlaylistId = null;
      state.subduedPlaylistIds = new Set();
      return;
    }

    setAllSubscriptionsFilter();
  }

  function closeFilterMenu({ render = true } = {}) {
    if (!state.filterMenuOpen) {
      api.clearDocumentCloseListener(state.filterMenuCloseState);
      return;
    }
    state.filterMenuOpen = false;
    api.clearDocumentCloseListener(state.filterMenuCloseState);
    if (render) renderFilterBar();
  }

  async function persistSubscriptionsPreference() {
    const nextPreference = getCurrentSubscriptionsPreference();
    const settings = await api.sendMsg({
      type: 'UPDATE_SETTINGS',
      settings: {
        [constants.SUBSCRIPTIONS_FILTER_PREFERENCE_KEY]: nextPreference
      }
    });
    if (settings && state.data) {
      state.data.settings = settings;
    }
  }

  async function initSubscriptionsPage(gen) {
    try {
      await api.loadData();
    } catch (error) {
      console.warn('SYO failed to load subscriptions data', error);
      return;
    }
    if (!state.data || gen !== state.initGeneration) return;
    const mountReady = () => {
      const mountParent = getSubscriptionsMountParent();
      const contents = getSubscriptionsContents();
      if (!mountParent || !contents) return null;
      return contents.querySelector('ytd-rich-section-renderer, ytd-rich-item-renderer') ? mountParent : null;
    };
    const mountParent = await api.waitForElement(mountReady);
    if (!mountParent || gen !== state.initGeneration) return;
    restoreSavedSubscriptionsPreference();
    if (!injectFilterBar()) return;
    applySectionVisibility();
    applyFilter();
    if (!observeFeed()) return;
    state.initSucceeded = true;
  }

  function applySectionVisibility() {
    const browse = getActiveSubscriptionsBrowse();
    if (!browse || !state.data?.settings) return;
    const sections = browse.querySelectorAll('ytd-rich-section-renderer');
    for (const section of sections) {
      const text = getSectionHeadingText(section);
      if (!text) continue;
      if (text.includes('shorts')) {
        section.style.display = state.data.settings.hideShorts ? 'none' : '';
      } else if (text.includes('most relevant')) {
        section.style.display = state.data.settings.hideMostRelevant ? 'none' : '';
      }
    }
  }

  function injectFilterBar() {
    const mountParent = getSubscriptionsMountParent();
    const grid = getSubscriptionsGrid();
    if (!mountParent) return false;

    if (state.filterHost?.isConnected && state.filterShadow) {
      placeFilterHost(state.filterHost, mountParent, grid);
      renderFilterBar();
      return true;
    }

    const existingHost = mountParent.querySelector(':scope > .syp-filter-host')
      || getActiveSubscriptionsBrowse()?.querySelector('.syp-filter-host');
    if (existingHost?.shadowRoot) {
      state.filterHost = existingHost;
      state.filterShadow = existingHost.shadowRoot;
      placeFilterHost(state.filterHost, mountParent, grid);
      renderFilterBar();
      return true;
    }

    state.filterHost = document.createElement('div');
    state.filterHost.className = 'syp-host syp-filter-host';
    state.filterHost.style.cssText = 'all: initial; display: block; width: 100%; flex-shrink: 0;';
    placeFilterHost(state.filterHost, mountParent, grid);
    state.filterShadow = state.filterHost.attachShadow({ mode: 'open' });
    renderFilterBar();
    return true;
  }

  function renderFilterBar() {
    if (!state.filterShadow || !state.data) return;

    const isDark = document.documentElement.hasAttribute('dark');
    const playlists = Object.values(state.data.playlists || {}).sort((a, b) => a.order - b.order);
    const savedPreference = getSavedSubscriptionsPreference();

    state.filterShadow.innerHTML = `
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
              class="syp-btn ${state.subscriptionsFilterMode === constants.FILTER_MODE_ALL ? 'active' : ''}"
              data-action="all"
            >All</button>
            ${playlists.map((pl) => {
          const count = state.playlistChannels.get(pl.id)?.size || 0;
          const isActive = state.subscriptionsFilterMode === constants.FILTER_MODE_INCLUDE && state.subscriptionsIncludePlaylistId === pl.id;
          const isSubdued = state.subscriptionsFilterMode === constants.FILTER_MODE_EXCLUDE && state.subduedPlaylistIds.has(pl.id);
          return `<button
                type="button"
                class="syp-btn ${isActive ? 'active' : ''} ${isSubdued ? 'subdued' : ''}"
                data-playlist="${pl.id}"
                title="Click to show only this playlist. Ctrl/Command+Click to hide it."
              >
                <span class="syp-dot" style="background:${pl.color}"></span>
                ${api.escapeHtml(pl.name)}
                <span class="syp-count">${count}</span>
              </button>`;
        }).join('')}
            <button
              type="button"
              class="syp-btn ${state.subscriptionsFilterMode === constants.FILTER_MODE_UNCATEGORIZED ? 'active' : ''}"
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
              aria-expanded="${state.filterMenuOpen ? 'true' : 'false'}"
              aria-controls="syp-filter-menu"
              title="Filter actions"
            >...</button>
            ${savedPreference ? '<span class="syp-menu-indicator" aria-hidden="true"></span>' : ''}
            ${state.filterMenuOpen ? `
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

    state.filterShadow.querySelectorAll('[data-action="all"]').forEach((btn) => {
      btn.addEventListener('click', () => {
        setAllSubscriptionsFilter();
        state.filterMenuOpen = false;
        renderFilterBar();
        applyFilter();
      });
    });

    state.filterShadow.querySelectorAll('[data-playlist]').forEach((btn) => {
      btn.addEventListener('click', (event) => {
        const playlistId = btn.dataset.playlist;
        if (!playlistId) return;
        if (event.ctrlKey || event.metaKey) {
          toggleExcludedSubscriptionsFilter(playlistId);
        } else {
          setIncludeSubscriptionsFilter(playlistId);
        }
        state.filterMenuOpen = false;
        renderFilterBar();
        applyFilter();
      });
    });

    state.filterShadow.querySelectorAll('[data-action="uncategorized"]').forEach((btn) => {
      btn.addEventListener('click', () => {
        setUncategorizedSubscriptionsFilter();
        state.filterMenuOpen = false;
        renderFilterBar();
        applyFilter();
      });
    });

    state.filterShadow.querySelectorAll('[data-action="toggle-menu"]').forEach((btn) => {
      btn.addEventListener('click', (event) => {
        event.stopPropagation();
        state.filterMenuOpen = !state.filterMenuOpen;
        renderFilterBar();
      });
    });

    state.filterShadow.querySelectorAll('[data-action="manage"]').forEach((btn) => {
      btn.addEventListener('click', () => {
        closeFilterMenu();
        void api.sendMsg({ type: 'OPEN_OPTIONS' }).catch((error) => api.handleActionError(error));
      });
    });

    state.filterShadow.querySelectorAll('[data-action="save-preference"]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        try {
          await persistSubscriptionsPreference();
          closeFilterMenu();
        } catch (error) {
          api.handleActionError(error, 'Could not save the filter preference.');
        }
      });
    });

    state.filterShadow.querySelectorAll('[data-action="reset-preference"]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        try {
          setAllSubscriptionsFilter();
          await persistSubscriptionsPreference();
          closeFilterMenu({ render: false });
          renderFilterBar();
          applyFilter();
        } catch (error) {
          api.handleActionError(error, 'Could not reset the filter preference.');
        }
      });
    });

    const menu = state.filterShadow.getElementById('syp-filter-menu');
    if (menu) {
      menu.addEventListener('keydown', (event) => {
        if (event.key !== 'Escape') return;
        event.preventDefault();
        closeFilterMenu();
      });
      const firstMenuItem = menu.querySelector('[data-action="manage"]');
      if (firstMenuItem) firstMenuItem.focus();
    }

    if (state.filterMenuOpen) {
      const closeHandler = (event) => {
        const path = event.composedPath();
        if (state.filterHost && path.includes(state.filterHost)) return;
        closeFilterMenu();
      };
      api.armDocumentCloseListener(state.filterMenuCloseState, closeHandler);
    } else {
      api.clearDocumentCloseListener(state.filterMenuCloseState);
    }
  }

  function applyFilter() {
    const cards = getSubscriptionsGrid()?.querySelectorAll('ytd-rich-item-renderer') || [];

    if (state.subscriptionsFilterMode === constants.FILTER_MODE_ALL) {
      cards.forEach((card) => {
        card.style.display = '';
      });
      return;
    }

    let allowedHandles = null;
    let excludedHandles = null;
    if (state.subscriptionsFilterMode === constants.FILTER_MODE_INCLUDE) {
      allowedHandles = state.playlistChannels.get(state.subscriptionsIncludePlaylistId) || new Set();
    } else if (state.subscriptionsFilterMode === constants.FILTER_MODE_EXCLUDE) {
      excludedHandles = new Set();
      state.subduedPlaylistIds.forEach((playlistId) => {
        const handles = state.playlistChannels.get(playlistId);
        if (!handles) return;
        handles.forEach((handle) => excludedHandles.add(handle));
      });
    }

    cards.forEach((card) => {
      const handle = extractHandleFromCard(card);
      let show;
      if (state.subscriptionsFilterMode === constants.FILTER_MODE_UNCATEGORIZED) {
        show = handle && !state.allAssignedHandles.has(handle);
      } else if (state.subscriptionsFilterMode === constants.FILTER_MODE_EXCLUDE) {
        show = !handle || !excludedHandles.has(handle);
      } else {
        show = handle && allowedHandles.has(handle);
      }
      card.style.display = show ? '' : 'none';
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

    let lastFilteredCount = getSubscriptionsGrid()?.querySelectorAll('ytd-rich-item-renderer').length || 0;
    let lastFirstCard = getSubscriptionsGrid()?.querySelector('ytd-rich-item-renderer') || null;
    let cooldownUntil = 0;

    state.feedObserver = new MutationObserver(() => {
      clearTimeout(state.feedObserverDebounceTimer);
      state.feedObserverDebounceTimer = setTimeout(() => {
        if (state.currentPage !== 'subscriptions') return;
        if (!getSubscriptionsGrid()) return;

        if (!state.filterHost?.isConnected && !injectFilterBar()) return;

        applySectionVisibility();

        if (!hasActiveSubscriptionsFilter()) return;

        const now = Date.now();
        if (now < cooldownUntil) return;

        const currentCount = getSubscriptionsGrid()?.querySelectorAll('ytd-rich-item-renderer').length || 0;
        const currentFirstCard = getSubscriptionsGrid()?.querySelector('ytd-rich-item-renderer') || null;
        if (currentCount !== lastFilteredCount || currentFirstCard !== lastFirstCard) {
          lastFilteredCount = currentCount;
          lastFirstCard = currentFirstCard;
          applyFilter();
          cooldownUntil = Date.now() + 500;
        }
      }, 150);
    });

    state.feedObserver.observe(browse, { childList: true, subtree: true });
    return true;
  }

  pages.subscriptions = {
    init: ({ gen }) => initSubscriptionsPage(gen),
    onDataChanged() {
      syncSubscriptionsFilterState();
      renderFilterBar();
      applySectionVisibility();
      applyFilter();
    },
    resetState: resetSubscriptionsFilterState
  };
})();
