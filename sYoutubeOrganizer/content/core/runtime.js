(function () {
  'use strict';

  const app = globalThis.__SYP_CONTENT__;
  const { constants, state, api } = app;

  api.normalizeRuntimeError = function normalizeRuntimeError(error) {
    if (error instanceof Error) return error;
    if (typeof error === 'string' && error) return new Error(error);
    return new Error('Extension request failed');
  };

  api.isRetryableRuntimeError = function isRetryableRuntimeError(type, error) {
    if (!constants.RETRYABLE_MESSAGE_TYPES.has(type) || !chrome.runtime?.id) return false;
    const message = error?.message || '';
    return (
      /receiving end does not exist/i.test(message) ||
      /message port closed/i.test(message) ||
      /could not establish connection/i.test(message)
    );
  };

  api.sendMsg = async function sendMsg(msg) {
    if (!msg?.type) {
      throw new Error('Invalid extension request');
    }

    const maxRetries = constants.RETRYABLE_MESSAGE_TYPES.has(msg.type)
      ? constants.MAX_MESSAGE_RETRIES
      : 0;
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
        const normalizedError = api.normalizeRuntimeError(error);
        if (attempt >= maxRetries || !api.isRetryableRuntimeError(msg.type, normalizedError)) {
          throw normalizedError;
        }
        await api.sleep(constants.MESSAGE_RETRY_DELAY_MS * (2 ** attempt));
        attempt += 1;
      }
    }
  };

  api.buildLookupMaps = function buildLookupMaps() {
    if (!state.data) return;
    state.playlistChannels = new Map();
    state.allAssignedHandles = new Set();

    for (const [handle, plIds] of Object.entries(state.data.channelPlaylists || {})) {
      if (plIds.length > 0) state.allAssignedHandles.add(handle);
      for (const plId of plIds) {
        if (!state.playlistChannels.has(plId)) state.playlistChannels.set(plId, new Set());
        state.playlistChannels.get(plId).add(handle);
      }
    }
  };

  api.loadData = async function loadData() {
    state.data = await api.sendMsg({ type: 'GET_ALL_DATA' });
    api.buildLookupMaps();
  };

  api.ensurePageToast = function ensurePageToast() {
    if (state.pageToastHost?.isConnected && state.pageToastShadow) {
      return state.pageToastShadow;
    }

    state.pageToastHost = document.createElement('div');
    state.pageToastHost.className = 'syp-toast-host';
    state.pageToastHost.style.cssText = 'all: initial; position: fixed; left: 50%; bottom: 24px; transform: translateX(-50%); z-index: 2147483647;';
    document.documentElement.appendChild(state.pageToastHost);
    state.pageToastShadow = state.pageToastHost.attachShadow({ mode: 'open' });
    return state.pageToastShadow;
  };

  api.showPageToast = function showPageToast(message, type = 'error') {
    const shadow = api.ensurePageToast();
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
      <div class="toast">${api.escapeHtml(message)}</div>
    `;

    if (state.pageToastTimer) clearTimeout(state.pageToastTimer);
    state.pageToastTimer = setTimeout(() => {
      if (state.pageToastHost?.isConnected) {
        state.pageToastHost.remove();
      }
      state.pageToastHost = null;
      state.pageToastShadow = null;
      state.pageToastTimer = null;
    }, 2800);
  };

  api.handleActionError = function handleActionError(
    error,
    fallbackMessage = 'Action failed. Reload the extension and try again.'
  ) {
    const message = error?.message || fallbackMessage;
    console.warn('SYO action failed', error);
    api.showPageToast(message, 'error');
  };
})();
