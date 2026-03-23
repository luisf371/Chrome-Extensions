(function () {
  'use strict';

  const app = globalThis.__SYP_CONTENT__;
  const { state, api, pages } = app;

  function getChannelHeaderScope(container) {
    return container?.closest('#page-header, ytd-c4-tabbed-header-renderer, yt-page-header-view-model') || null;
  }

  function isUsableChannelActionsContainer(container) {
    if (!container || !container.isConnected || container.hasAttribute('hidden')) return false;

    const scope = getChannelHeaderScope(container);
    if (!api.isVisibleElement(scope || container)) return false;

    return Boolean(
      container.querySelector('button, button-view-model, .yt-flexible-actions-view-model-action, .yt-flexible-actions-view-model-wiz__action') ||
      container.children.length > 0
    );
  }

  function getVisibleChannelActionsContainer(handle) {
    const containers = Array.from(document.querySelectorAll('yt-flexible-actions-view-model'))
      .filter(isUsableChannelActionsContainer);

    const exactMatch = containers.find((container) => {
      const scope = getChannelHeaderScope(container) || document;
      return Array.from(scope.querySelectorAll('a[href*="/@"], a[href*="/channel/"]'))
        .some((link) => api.extractHandleFromUrl(link.getAttribute('href') || '') === handle);
    });

    if (exactMatch) return exactMatch;

    return containers.find((container) => {
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
      state.quickAddHandle = handle;
      state.quickAddHost = existingHost;
      state.quickAddShadow = existingHost.shadowRoot;
      api.renderQuickAddButton(handle, channelName);
      return true;
    }

    state.quickAddHandle = handle;
    state.quickAddHost = document.createElement('div');
    state.quickAddHost.className = 'syp-host syp-channel-qa-host ytFlexibleActionsViewModelAction';
    state.quickAddHost.style.cssText = 'all: initial; display: inline-flex; vertical-align: middle; position: relative; z-index: 2000;';
    actionsContainer.appendChild(state.quickAddHost);

    state.quickAddShadow = state.quickAddHost.attachShadow({ mode: 'open' });
    api.renderQuickAddButton(handle, channelName);
    return true;
  }

  function observeChannelQuickAdd(handle, gen) {
    if (state.quickAddObserver) {
      state.quickAddObserver.disconnect();
      state.quickAddObserver = null;
    }

    state.quickAddObserver = new MutationObserver(() => {
      clearTimeout(state.quickAddObserverDebounceTimer);
      state.quickAddObserverDebounceTimer = setTimeout(() => {
        if (gen !== state.initGeneration || state.currentPage !== 'channel') return;

        const actionsContainer = getVisibleChannelActionsContainer(handle);
        if (!actionsContainer) return;
        if (state.quickAddHost?.isConnected && actionsContainer.contains(state.quickAddHost)) return;

        const channelName = getChannelPageName(actionsContainer, handle);
        if (!mountChannelQuickAdd(actionsContainer, handle, channelName)) return;
        state.initSucceeded = true;
      }, 150);
    });

    state.quickAddObserver.observe(document.documentElement, { childList: true, subtree: true });
  }

  async function initChannelPage(url, gen) {
    try {
      await api.loadData();
    } catch (error) {
      console.warn('SYO failed to load channel page data', error);
      return;
    }
    if (!state.data || gen !== state.initGeneration) return;
    const handle = api.extractHandleFromUrl(url);
    if (!handle) return;

    const actionsContainer = await api.waitForElement(() => getVisibleChannelActionsContainer(handle));
    if (!actionsContainer || gen !== state.initGeneration) return;

    const channelName = getChannelPageName(actionsContainer, handle);

    void api.sendMsg({ type: 'REGISTER_CHANNEL', handle, name: channelName }).catch((error) => {
      console.warn('SYO failed to register channel page channel', error);
    });

    if (!mountChannelQuickAdd(actionsContainer, handle, channelName)) return;
    observeChannelQuickAdd(handle, gen);
    state.initSucceeded = true;
  }

  pages.channel = {
    init: ({ url, gen }) => initChannelPage(url, gen),
    getChannelHeaderScope,
    getVisibleChannelActionsContainer,
    getChannelPageName
  };
})();
