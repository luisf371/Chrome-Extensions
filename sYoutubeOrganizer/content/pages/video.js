(function () {
  'use strict';

  const app = globalThis.__SYP_CONTENT__;
  const { state, api, pages } = app;

  function getVisibleVideoTopRow() {
    return Array.from(document.querySelectorAll('#top-row'))
      .find((row) => (
        api.isVisibleElement(row) &&
        row.querySelector('#owner') &&
        row.querySelector('#subscribe-button')
      )) || null;
  }

  function getVisibleVideoSubscribeButton() {
    return getVisibleVideoTopRow()?.querySelector('#subscribe-button') || null;
  }

  function getCurrentChannelName() {
    const ownerEl = getVisibleVideoTopRow()?.querySelector('#owner');
    const nameEl = ownerEl?.querySelector('ytd-channel-name a, ytd-channel-name yt-formatted-string, yt-formatted-string a');
    return nameEl?.textContent?.trim() || state.quickAddHandle;
  }

  async function initVideoPage(gen) {
    try {
      await api.loadData();
    } catch (error) {
      console.warn('SYO failed to load video page data', error);
      return;
    }
    if (!state.data || gen !== state.initGeneration) return;

    const subscribeBtn = await api.waitForElement(getVisibleVideoSubscribeButton);
    if (!subscribeBtn || gen !== state.initGeneration) return;

    const ownerEl = getVisibleVideoTopRow()?.querySelector('#owner');
    const handleLink = ownerEl?.querySelector('a[href*="/@"]')
      || ownerEl?.querySelector('a[href*="/channel/"]');

    if (!handleLink) return;

    const handle = api.extractHandleFromUrl(handleLink.getAttribute('href') || '');
    if (!handle) return;

    const channelName = getCurrentChannelName() || handle;

    void api.sendMsg({ type: 'REGISTER_CHANNEL', handle, name: channelName }).catch((error) => {
      console.warn('SYO failed to register video channel', error);
    });

    state.quickAddHandle = handle;
    state.quickAddHost = document.createElement('div');
    state.quickAddHost.className = 'syp-host';
    state.quickAddHost.style.cssText = 'all: initial; display: inline-flex; align-items: center; vertical-align: middle; margin-left: 8px; position: relative; z-index: 2000;';
    subscribeBtn.parentElement.insertBefore(state.quickAddHost, subscribeBtn.nextSibling);

    state.quickAddShadow = state.quickAddHost.attachShadow({ mode: 'open' });
    api.renderQuickAddButton(handle, channelName);
    state.initSucceeded = true;
  }

  pages.video = {
    init: ({ gen }) => initVideoPage(gen),
    getVisibleVideoTopRow,
    getVisibleVideoSubscribeButton,
    getCurrentChannelName
  };
})();
