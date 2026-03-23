(function () {
  'use strict';

  const app = globalThis.__SYP_CONTENT__;
  const { state, api } = app;

  api.getDropdownStyles = function getDropdownStyles(isDark) {
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
  };

  api.renderDropdownHTML = function renderDropdownHTML(handle) {
    if (!state.data) return '';
    const playlists = Object.values(state.data.playlists || {}).sort((a, b) => a.order - b.order);
    const assignments = (state.data.channelPlaylists || {})[handle] || [];

    const checkSvg = '<svg viewBox="0 0 10 10" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M2 5.5L4.2 7.5L8 3"/></svg>';
    const arrowSvg = '<svg viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M5 3l5 4-5 4"/></svg>';

    let html = '<div class="syp-dropdown">';
    html += '<div class="syp-dd-header"><span>Playlists</span><button class="syp-dd-add-btn" data-action="add-inline" title="New playlist">+</button></div>';

    html += '<div class="syp-dd-list">';
    if (playlists.length === 0) {
      html += '<div class="syp-dd-empty">No playlists yet.<br>Hit + to create one.</div>';
    }
    for (const pl of playlists) {
      const isChecked = assignments.includes(pl.id);
      html += `<label class="syp-dd-item${isChecked ? ' checked' : ''}">
        <input type="checkbox" data-playlist="${pl.id}" ${isChecked ? 'checked' : ''}>
        <span class="syp-dd-check" style="${isChecked ? `background:${pl.color}; border-color:transparent;` : ''}">${checkSvg}</span>
        <span class="syp-dd-color" style="background:${pl.color}"></span>
        <span class="syp-dd-name">${api.escapeHtml(pl.name)}</span>
      </label>`;
    }
    html += '</div>';

    html += '<div class="syp-dd-sep"></div>';
    html += `<div class="syp-dd-footer" data-action="manage">Manage playlists ${arrowSvg}</div>`;
    html += '</div>';
    return html;
  };

  api.attachInlineCreateListener = function attachInlineCreateListener(shadowRoot, onCreated) {
    const addBtn = shadowRoot.querySelector('[data-action="add-inline"]');
    if (!addBtn) return;
    addBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const list = shadowRoot.querySelector('.syp-dd-list');
      if (!list || list.querySelector('.syp-dd-inline-input')) return;

      const empty = list.querySelector('.syp-dd-empty');
      if (empty) empty.style.display = 'none';

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
        if (!name) {
          discard();
          return;
        }
        settled = true;
        try {
          await api.sendMsg({ type: 'CREATE_PLAYLIST', name, color });
          state.data = await api.sendMsg({ type: 'GET_ALL_DATA' });
          api.buildLookupMaps();
          onCreated();
        } catch (error) {
          settled = false;
          api.handleActionError(error, 'Could not create the playlist.');
        }
      };

      const discard = () => {
        if (settled) return;
        settled = true;
        row.remove();
        const emptyEl = list.querySelector('.syp-dd-empty');
        if (emptyEl && list.children.length <= 1) emptyEl.style.display = '';
      };

      input.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          void commit();
        }
        if (event.key === 'Escape') {
          event.preventDefault();
          discard();
        }
      });
      input.addEventListener('blur', () => {
        setTimeout(discard, 120);
      });
    });
  };

  api.attachDropdownListeners = function attachDropdownListeners(handle, channelName) {
    if (!state.quickAddShadow) return;

    state.quickAddShadow.querySelectorAll('input[data-playlist]').forEach((cb) => {
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
          api.renderQuickAddButton(handle, channelName);
        } catch (error) {
          api.handleActionError(error);
          cb.checked = !cb.checked;
        }
      });
    });

    state.quickAddShadow.querySelectorAll('[data-action="manage"]').forEach((btn) => {
      btn.addEventListener('click', () => {
        void api.sendMsg({ type: 'OPEN_OPTIONS' }).catch((error) => api.handleActionError(error));
      });
    });

    api.attachInlineCreateListener(state.quickAddShadow, () => {
      api.renderQuickAddButton(handle, channelName);
    });
  };

  api.renderQuickAddButton = function renderQuickAddButton(handle, channelName) {
    if (!state.quickAddShadow) return;
    if (state.quickAddHost) state.quickAddHost.style.zIndex = state.quickAddOpen ? '9999' : '2000';
    const isDark = document.documentElement.hasAttribute('dark');

    state.quickAddShadow.innerHTML = `
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
        <button class="syp-qa-trigger" id="syp-trigger">+ Playlist${(() => {
          const count = ((state.data?.channelPlaylists || {})[handle] || []).length;
          return count > 0 ? ` <span class="syp-badge">${count}</span>` : '';
        })()}</button>
        ${state.quickAddOpen ? api.renderDropdownHTML(handle) : ''}
      </div>
    `;

    const trigger = state.quickAddShadow.getElementById('syp-trigger');
    trigger.addEventListener('click', (event) => {
      event.stopPropagation();
      state.quickAddOpen = !state.quickAddOpen;
      api.renderQuickAddButton(handle, channelName);
    });

    if (state.quickAddOpen) {
      api.attachDropdownListeners(handle, channelName);

      const closeHandler = (event) => {
        const path = event.composedPath();
        if (path.includes(state.quickAddHost)) return;
        api.clearDocumentCloseListener(state.quickAddCloseState);
        state.quickAddOpen = false;
        api.renderQuickAddButton(handle, channelName);
      };
      api.armDocumentCloseListener(state.quickAddCloseState, closeHandler);
    } else {
      api.clearDocumentCloseListener(state.quickAddCloseState);
    }
  };

  api.getQuickAddChannelName = function getQuickAddChannelName() {
    if (!state.quickAddHandle) return null;

    if (state.currentPage === 'channel') {
      const actionsContainer = app.pages.channel?.getVisibleChannelActionsContainer?.(state.quickAddHandle);
      if (actionsContainer) {
        return app.pages.channel?.getChannelPageName?.(actionsContainer, state.quickAddHandle) || state.quickAddHandle;
      }
    }

    if (state.currentPage === 'video') {
      return app.pages.video?.getCurrentChannelName?.() || state.quickAddHandle;
    }

    return state.quickAddHandle;
  };

  api.scheduleQuickAddRefresh = function scheduleQuickAddRefresh() {
    if (!state.quickAddHandle || !state.quickAddShadow || !state.quickAddHost?.isConnected) return;
    clearTimeout(state.quickAddRefreshTimer);
    state.quickAddRefreshTimer = setTimeout(() => {
      state.quickAddRefreshTimer = null;
      api.updateQuickAddState();
    }, 150);
  };

  api.updateQuickAddState = function updateQuickAddState() {
    if (!state.quickAddHandle || !state.quickAddShadow || !state.quickAddHost?.isConnected) return;
    const name = api.getQuickAddChannelName();
    api.renderQuickAddButton(state.quickAddHandle, name || state.quickAddHandle);
  };
})();
