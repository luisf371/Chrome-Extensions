(function () {
  'use strict';

  const app = globalThis.__SYP_CONTENT__;
  const { state, api, pages } = app;

  async function initChannelsListPage(gen) {
    try {
      await api.loadData();
    } catch (error) {
      console.warn('SYO failed to load channels list data', error);
      return;
    }
    if (!state.data || gen !== state.initGeneration) return;
    const el = await api.waitForElement('ytd-channel-renderer');
    if (!el || gen !== state.initGeneration) return;
    injectChannelListButtons();
    observeChannelsList();
    state.initSucceeded = true;
  }

  function injectChannelListButtons() {
    const renderers = document.querySelectorAll('ytd-channel-renderer');
    renderers.forEach((renderer) => {
      if (renderer.querySelector('.syp-host')) return;

      const buttonsDiv = renderer.querySelector('#buttons');
      if (!buttonsDiv) return;

      const channelLink = renderer.querySelector('a.channel-link[href*="/@"]')
        || renderer.querySelector('a.channel-link[href*="/channel/"]');
      if (!channelLink) return;
      const handle = api.extractHandleFromUrl(channelLink.getAttribute('href') || '');
      if (!handle) return;

      const nameEl = renderer.querySelector('ytd-channel-name yt-formatted-string');
      const channelName = nameEl?.textContent?.trim() || handle;

      void api.sendMsg({ type: 'REGISTER_CHANNEL', handle, name: channelName }).catch((error) => {
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
    const assignments = (state.data?.channelPlaylists || {})[handle] || [];
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
        ${api.getDropdownStyles(isDark)}
      </style>
      <div style="position: relative; display: inline-block;">
        <button class="syp-qa-trigger" id="syp-trigger">
          + Playlist${assignedCount > 0 ? ` <span class="syp-badge">${assignedCount}</span>` : ''}
        </button>
        ${isOpen ? api.renderDropdownHTML(handle) : ''}
      </div>
    `;

    const trigger = shadow.getElementById('syp-trigger');
    trigger.addEventListener('click', (event) => {
      event.stopPropagation();

      if (state.activeChannelListDropdown && state.activeChannelListDropdown.shadow !== shadow) {
        const prev = state.activeChannelListDropdown;
        state.activeChannelListDropdown = null;
        renderChannelListButton(prev.shadow, prev.host, prev.handle, prev.channelName, false);
      }

      const nowOpen = !isOpen;
      state.activeChannelListDropdown = nowOpen ? { shadow, host, handle, channelName } : null;
      renderChannelListButton(shadow, host, handle, channelName, nowOpen);
    });

    if (isOpen) {
      shadow.querySelectorAll('input[data-playlist]').forEach((cb) => {
        cb.addEventListener('change', async () => {
          try {
            await api.sendMsg({
              type: 'ASSIGN_CHANNEL_PLAYLIST',
              handle,
              name: channelName,
              playlistId: cb.dataset.playlist,
              assign: cb.checked
            });
            state.data = await api.sendMsg({ type: 'GET_ALL_DATA' });
            api.buildLookupMaps();
            state.activeChannelListDropdown = { shadow, host, handle, channelName };
            renderChannelListButton(shadow, host, handle, channelName, true);
          } catch (error) {
            api.handleActionError(error);
            cb.checked = !cb.checked;
          }
        });
      });

      shadow.querySelectorAll('[data-action="manage"]').forEach((btn) => {
        btn.addEventListener('click', () => {
          void api.sendMsg({ type: 'OPEN_OPTIONS' }).catch((error) => api.handleActionError(error));
        });
      });

      api.attachInlineCreateListener(shadow, () => {
        state.activeChannelListDropdown = { shadow, host, handle, channelName };
        renderChannelListButton(shadow, host, handle, channelName, true);
      });

      const closeHandler = (event) => {
        const path = event.composedPath();
        if (path.includes(host)) return;
        api.clearDocumentCloseListener(state.channelListCloseState);
        state.activeChannelListDropdown = null;
        renderChannelListButton(shadow, host, handle, channelName, false);
      };
      api.armDocumentCloseListener(state.channelListCloseState, closeHandler);
    } else {
      api.clearDocumentCloseListener(state.channelListCloseState);
    }
  }

  function refreshChannelListButtons() {
    document.querySelectorAll('ytd-channel-renderer').forEach((renderer) => {
      const host = renderer.querySelector('.syp-host');
      if (!host || !host.shadowRoot) return;

      const channelLink = renderer.querySelector('a.channel-link[href*="/@"]')
        || renderer.querySelector('a.channel-link[href*="/channel/"]');
      if (!channelLink) return;
      const handle = api.extractHandleFromUrl(channelLink.getAttribute('href') || '');
      if (!handle) return;

      const nameEl = renderer.querySelector('ytd-channel-name yt-formatted-string');
      const channelName = nameEl?.textContent?.trim() || handle;

      const isOpen = state.activeChannelListDropdown?.handle === handle;
      renderChannelListButton(host.shadowRoot, host, handle, channelName, isOpen);
    });
  }

  function observeChannelsList() {
    const container = document.querySelector('ytd-section-list-renderer #contents')
      || document.querySelector('ytd-browse[page-subtype="channels"] #contents');
    if (!container) return;

    state.channelsListObserver = new MutationObserver(() => {
      clearTimeout(state.channelsListDebounceTimer);
      state.channelsListDebounceTimer = setTimeout(() => {
        injectChannelListButtons();
      }, 200);
    });

    state.channelsListObserver.observe(container, { childList: true, subtree: true });
  }

  pages.channelsList = {
    init: ({ gen }) => initChannelsListPage(gen),
    refreshChannelListButtons
  };
})();
