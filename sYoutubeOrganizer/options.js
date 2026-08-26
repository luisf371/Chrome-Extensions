'use strict';

const sharedCore = globalThis.SYPSharedCore;

// Inline SVG icon set for the sidebar rows: crisp at any zoom, themeable
// via currentColor, and immune to the platform glyph-substitution issues
// that made the old unicode move arrow render as a colored emoji.
const ICONS = {
  plus: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M8 3.5v9M3.5 8h9"/></svg>',
  caret: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M6 4.5L10 8l-4 3.5"/></svg>',
  pencil: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M11.5 2.5l2 2L6 12l-2.8.8L4 10z"/></svg>',
  x: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M4.5 4.5l7 7M11.5 4.5l-7 7"/></svg>',
  move: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M13 3H6v7"/><path d="M13 3L3.5 12.5"/></svg>',
  kebab: '<svg viewBox="0 0 16 16" fill="currentColor"><circle cx="3" cy="8" r="1.4"/><circle cx="8" cy="8" r="1.4"/><circle cx="13" cy="8" r="1.4"/></svg>'
};

const UNCATEGORIZED_ID = '__uncategorized';

let data = null;
let selectedPlaylistId = null;
// 'direct' shows only channels assigned to the selected playlist; 'union'
// (top-level groups) also includes channels assigned to their subgroups.
let selectedView = 'direct';
let editingPlaylistId = null;
// Anchored row popup: { id, kind } where kind is 'kebab' | 'move' | 'subgroups'.
let rowPopup = null;
let openSubmenuHandle = null;
let dragId = null;
const collapsedGroups = new Set();
const assignmentExpandedGroups = new Set();
const COLLAPSED_GROUPS_KEY = 'optionsCollapsedGroups';
const MAX_MESSAGE_RETRIES = 2;
const MESSAGE_RETRY_DELAY_MS = 200;
const RETRYABLE_MESSAGE_TYPES = new Set([
  'GET_ALL_DATA',
  'CREATE_PLAYLIST',
  'REGISTER_CHANNEL',
  'ASSIGN_CHANNEL_PLAYLIST',
  'UPDATE_SETTINGS',
  'OPEN_OPTIONS',
  'DELETE_PLAYLIST',
  'UPDATE_PLAYLIST',
  'REORDER_PLAYLISTS',
  'IMPORT_DATA'
]);

// --- Init ---

document.addEventListener('DOMContentLoaded', async () => {
  initTheme();
  initSectionToggles();
  initI18n();
  try {
    await Promise.all([loadData(), loadCollapsedGroups()]);
  } catch (error) {
    showToast(error.message || 'Could not load extension data', 'error');
  }
  render();
  attachListeners();
});

// Listen for external data changes
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  // Don't rebuild the list mid-edit: render() recreates the edit input from
  // stored values, discarding the user's typed text and stealing focus.
  // An open subgroups popup holds a name input too, so wait it out as well.
  if (editingPlaylistId !== null || rowPopup?.kind === 'subgroups') return;
  const keys = ['playlists', 'channels', 'channelPlaylists', 'settings'];
  if (keys.some(k => k in changes)) {
    loadData().then(() => render()).catch((error) => {
      showToast(error.message || 'Could not refresh data', 'error');
    });
  }
});

// --- Data ---

async function loadData() {
  data = await sendRuntimeMessage({ type: 'GET_ALL_DATA' });
}

async function loadCollapsedGroups() {
  const stored = await chrome.storage.local.get([COLLAPSED_GROUPS_KEY]);
  const ids = stored[COLLAPSED_GROUPS_KEY];
  collapsedGroups.clear();
  if (!Array.isArray(ids)) return;
  for (const id of ids) {
    if (typeof id === 'string' && id) collapsedGroups.add(id);
  }
}

function saveCollapsedGroups() {
  return chrome.storage.local.set({ [COLLAPSED_GROUPS_KEY]: [...collapsedGroups] });
}

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

async function sendRuntimeMessage(message) {
  if (!message?.type) {
    throw new Error('Invalid extension request');
  }

  const maxRetries = RETRYABLE_MESSAGE_TYPES.has(message.type) ? MAX_MESSAGE_RETRIES : 0;
  let attempt = 0;

  while (true) {
    if (!chrome.runtime?.id) {
      throw new Error('Extension unavailable. Reload the extension and try again.');
    }

    try {
      const response = await chrome.runtime.sendMessage(message);
      if (response?.error) {
        throw new Error(response.error);
      }
      return response;
    } catch (error) {
      const normalizedError = normalizeRuntimeError(error);
      if (attempt >= maxRetries || !isRetryableRuntimeError(message.type, normalizedError)) {
        throw normalizedError;
      }
      await sleep(MESSAGE_RETRY_DELAY_MS * (2 ** attempt));
      attempt += 1;
    }
  }
}

function getPlaylistsSorted() {
  if (!data) return [];
  return Object.values(data.playlists || {}).sort((a, b) => a.order - b.order);
}

// Top-level playlists in display order, each with its direct subgroups.
// Orphaned parent links (should not happen — storage rules promote orphans)
// still render as top-level so no playlist ever disappears from the list.
// Own-property check only: an inherited name like "constructor" must never
// count as an existing parent.
function getPlaylistTree() {
  if (!data) return [];
  const byOrder = getPlaylistsSorted();
  const tops = byOrder.filter(pl => !pl.parentId || !Object.hasOwn(data.playlists, pl.parentId));
  return tops.map(top => ({
    ...top,
    children: byOrder.filter(pl => pl.parentId === top.id)
  }));
}

function getSubgroupIds(playlistId) {
  if (!data) return [];
  return Object.values(data.playlists || {})
    .filter(pl => pl.parentId === playlistId)
    .map(pl => pl.id);
}

function getFamilyPlaylistIds(playlistId) {
  if (!data?.playlists?.[playlistId]) return [];
  return [playlistId, ...getSubgroupIds(playlistId)];
}

function getChannelsForPlaylist(playlistId) {
  if (!data) return [];

  if (playlistId === UNCATEGORIZED_ID) {
    return Object.entries(data.channels || {})
      .filter(([handle, channel]) => (
        channel?.subscribed === true &&
        ((data.channelPlaylists || {})[handle] || []).length === 0
      ))
      .map(([handle, channel]) => ({ handle, ...channel }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  const handles = new Set();

  for (const [handle, plIds] of Object.entries(data.channelPlaylists || {})) {
    if (plIds.includes(playlistId)) handles.add(handle);
  }

  return Array.from(handles).map(h => {
    const ch = (data.channels || {})[h] || { handle: h, name: h };
    return { ...ch };
  }).sort((a, b) => a.name.localeCompare(b.name));
}

// Union view for a parent group: every channel assigned directly or to any
// subgroup, with the family memberships needed to render/remove per channel.
function getChannelsForFamily(playlistId) {
  if (!data) return [];
  const familyIds = getFamilyPlaylistIds(playlistId);
  const result = [];

  for (const [handle, plIds] of Object.entries(data.channelPlaylists || {})) {
    const memberIds = familyIds.filter(fid => plIds.includes(fid));
    if (memberIds.length === 0) continue;
    const ch = (data.channels || {})[handle] || { handle, name: handle };
    result.push({ ...ch, memberIds });
  }

  return result.sort((a, b) => a.name.localeCompare(b.name));
}

// --- Render ---

function render() {
  if (!data) return;
  renderPlaylistList();
  renderDetail();
}

function editRowHTML(pl, isSub) {
  return `<div class="edit-inline ${isSub ? 'sub-edit' : ''}" data-id="${pl.id}">
    <input type="color" class="edit-pl-color" value="${pl.color}" style="width:28px;height:28px;padding:1px;border:1px solid var(--border);border-radius:3px;background:var(--bg-input);cursor:pointer;">
    <input type="text" class="edit-pl-name" value="${escapeAttr(pl.name)}" maxlength="50">
    <button class="btn btn-sm edit-pl-save">Save</button>
    <button class="btn btn-sm edit-pl-cancel">Cancel</button>
  </div>`;
}

// Anchored row popups. The "..." kebab holds the playlist's own actions;
// the "+" on groups holds the subgroups list plus creation — never an
// inline row in the main list.
function kebabPopupHTML(pl) {
  const isSubgroup = Boolean(pl.parentId);
  const childless = getSubgroupIds(pl.id).length === 0;
  const otherTops = getPlaylistTree().some(top => top.id !== pl.id && top.id !== pl.parentId);
  const canMove = isSubgroup || (childless && otherTops);
  return `
    ${canMove ? `<button type="button" class="row-popup-item" data-popup-action="move"><span class="row-popup-ic">${ICONS.move}</span>Move under...</button>` : ''}
    <button type="button" class="row-popup-item" data-popup-action="edit"><span class="row-popup-ic">${ICONS.pencil}</span>Edit</button>
    <button type="button" class="row-popup-item row-popup-item--danger" data-popup-action="delete"><span class="row-popup-ic">${ICONS.x}</span>Delete</button>`;
}

function movePopupHTML(pl) {
  // A childless playlist can move anywhere: "Top level" (only meaningful
  // for subgroups) plus every top-level playlist except itself and, for
  // subgroups, its current parent. Playlists with subgroups never get a
  // Move action — the storage rules reject nesting a parent.
  const isSubgroup = Boolean(pl.parentId);
  const targets = getPlaylistTree().filter(top => top.id !== pl.id && top.id !== pl.parentId);
  const options = [];
  if (isSubgroup) {
    options.push('<button type="button" class="row-popup-item" data-move-parent=""><span class="row-popup-ic">' + ICONS.caret + '</span>Top level</button>');
  }
  options.push(...targets.map(top =>
    `<button type="button" class="row-popup-item" data-move-parent="${top.id}"><span class="row-popup-ic">${ICONS.move}</span>${escapeHtml(top.name)}</button>`
  ));
  return `<div class="row-popup-title">Move "${escapeHtml(pl.name)}" under</div>${options.join('')}`;
}

function subgroupsPopupHTML(pl) {
  const children = getSubgroupIds(pl.id).map(id => data.playlists[id]);
  return `
    <div class="row-popup-title">Subgroups</div>
    ${children.map(child => `<button type="button" class="row-popup-item" data-goto-child="${child.id}">
      <span class="spine" style="background:${child.color}"></span>${escapeHtml(child.name)}
      <span class="row-popup-count">${getChannelsForPlaylist(child.id).length}</span>
    </button>`).join('')}
    ${children.length > 0 ? '<div class="row-popup-sep"></div>' : ''}
    <div class="row-popup-add">
      <input type="text" class="row-popup-add-name" placeholder="New subgroup name..." maxlength="50">
      <button type="button" class="btn btn-sm row-popup-add-btn">Add</button>
    </div>`;
}

function rowPopupHTML(pl) {
  if (rowPopup?.id !== pl.id) return '';
  let inner = '';
  if (rowPopup.kind === 'kebab') inner = kebabPopupHTML(pl);
  else if (rowPopup.kind === 'move') inner = movePopupHTML(pl);
  else if (rowPopup.kind === 'subgroups') inner = subgroupsPopupHTML(pl);
  if (!inner) return '';
  return `<div class="row-popup" data-popup-for="${pl.id}" role="menu">${inner}</div>`;
}

function renderPlaylistList() {
  const list = document.getElementById('playlistList');
  const tree = getPlaylistTree();
  const rows = [];
  for (const top of tree) {
    const isCollapsed = collapsedGroups.has(top.id);
    const directCount = getChannelsForPlaylist(top.id).length;
    const rollupCount = top.children.length > 0
      ? getChannelsForFamily(top.id).length
      : directCount;

    if (editingPlaylistId === top.id) {
      rows.push(editRowHTML(top, false));
    } else {
      rows.push(`<div class="list-item group-item ${selectedPlaylistId === top.id ? 'active' : ''}" data-id="${top.id}" data-parent="">
        ${top.children.length > 0
          ? `<span class="chevron ${isCollapsed ? '' : 'expanded'}" data-toggle="${top.id}" title="${isCollapsed ? 'Expand' : 'Collapse'}" role="button" tabindex="0" aria-expanded="${isCollapsed ? 'false' : 'true'}">${ICONS.caret}</span>`
          : '<span class="chevron-spacer"></span>'}
        <span class="spine" style="background:${top.color}"></span>
        <span class="item-name">${escapeHtml(top.name)}</span>
        <span class="item-count">${rollupCount}</span>
        <span class="item-actions">
          <button class="row-icon-btn sub-popup-btn" data-id="${top.id}" title="Subgroups" aria-label="Subgroups of ${escapeAttr(top.name)}" aria-haspopup="menu">${ICONS.plus}</button>
          <button class="row-icon-btn kebab-btn" data-id="${top.id}" title="More options" aria-label="More options for ${escapeAttr(top.name)}" aria-haspopup="menu">${ICONS.kebab}</button>
        </span>
        ${rowPopupHTML(top)}
      </div>`);
    }

    if (isCollapsed) continue;

    for (const child of top.children) {
      if (editingPlaylistId === child.id) {
        rows.push(editRowHTML(child, true));
      } else {
        const count = getChannelsForPlaylist(child.id).length;
        rows.push(`<div class="list-item sub-item ${selectedPlaylistId === child.id ? 'active' : ''}" data-id="${child.id}" data-parent="${top.id}">
          <span class="spine" style="background:${child.color}"></span>
          <span class="item-name">${escapeHtml(child.name)}</span>
          <span class="item-count">${count}</span>
          <span class="item-actions">
            <button class="row-icon-btn kebab-btn" data-id="${child.id}" title="More options" aria-label="More options for ${escapeAttr(child.name)}" aria-haspopup="menu">${ICONS.kebab}</button>
          </span>
          ${rowPopupHTML(child)}
        </div>`);
      }
    }
  }

  const uncategorizedCount = getChannelsForPlaylist(UNCATEGORIZED_ID).length;
  rows.push(`<div class="list-item group-item uncategorized-item ${selectedPlaylistId === UNCATEGORIZED_ID ? 'active' : ''}" data-virtual="uncategorized" title="Channels not assigned to a playlist · Built in">
    <span class="chevron-spacer"></span>
    <span class="spine uncategorized-spine"></span>
    <span class="item-name">Uncategorized</span>
    <span class="built-in-pill">Built in</span>
    <span class="item-count">${uncategorizedCount}</span>
  </div>`);

  list.innerHTML = rows.join('');
  attachPlaylistListEvents(list);
  attachReorderListeners(list);
}

function attachPlaylistListEvents(list) {
  list.querySelectorAll('.list-item[data-id], .list-item[data-virtual]').forEach(item => {
    item.addEventListener('click', (e) => {
      if (e.target.closest('.item-actions, .row-popup, .chevron')) return;
      if (item.dataset.dragged === 'true') { delete item.dataset.dragged; return; }
      selectedPlaylistId = item.dataset.virtual ? UNCATEGORIZED_ID : item.dataset.id;
      // Top-level rows open the union view; subgroups show direct channels.
      selectedView = item.dataset.virtual ? 'uncategorized' : (item.dataset.parent ? 'direct' : 'union');
      rowPopup = null;
      render();
    });
  });

  list.querySelectorAll('.chevron[data-toggle]').forEach(el => {
    const toggle = () => {
      const id = el.dataset.toggle;
      if (collapsedGroups.has(id)) collapsedGroups.delete(id);
      else collapsedGroups.add(id);
      void saveCollapsedGroups().catch((error) => {
        showToast(error.message || 'Could not save group display state', 'error');
      });
      render();
    };
    el.addEventListener('click', (e) => { e.stopPropagation(); toggle(); });
    el.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); }
    });
  });

  // "+" on a group opens the subgroups popup (list + creation); "..." opens
  // the kebab with the playlist's own actions.
  list.querySelectorAll('.sub-popup-btn, .kebab-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const id = btn.dataset.id;
      const kind = btn.classList.contains('sub-popup-btn') ? 'subgroups' : 'kebab';
      const opening = rowPopup?.id !== id || rowPopup?.kind !== kind;
      rowPopup = opening ? { id, kind } : null;
      render();
      if (opening) focusPopup(list, id, kind);
    });
  });

  list.querySelectorAll('[data-popup-action]').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const id = btn.closest('.row-popup').dataset.popupFor;
      const action = btn.dataset.popupAction;
      if (action === 'move') {
        rowPopup = { id, kind: 'move' };
        render();
        focusPopup(list, id, 'move');
        return;
      }
      if (action === 'edit') {
        rowPopup = null;
        editingPlaylistId = id;
        render();
        return;
      }
      if (action === 'delete') {
        rowPopup = null;
        try {
          const pl = data.playlists[id];
          if (!pl) { await loadData(); render(); return; }
          const childCount = getSubgroupIds(id).length;
          const message = childCount > 0
            ? `Delete group "${pl.name}"? Its ${childCount} subgroup${childCount > 1 ? 's' : ''} will become top-level playlist${childCount > 1 ? 's' : ''}.`
            : `Delete playlist "${pl.name}"?`;
          if (!confirm(message)) { render(); return; }
          await sendRuntimeMessage({ type: 'DELETE_PLAYLIST', id });
          if (selectedPlaylistId === id) selectedPlaylistId = null;
          collapsedGroups.delete(id);
          await loadData();
          render();
          showToast('Playlist deleted');
        } catch (error) {
          showToast(error.message || 'Could not delete the playlist', 'error');
        }
      }
    });
  });

  list.querySelectorAll('[data-move-parent]').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const parentId = btn.dataset.moveParent || null;
      const id = btn.closest('.row-popup').dataset.popupFor;
      rowPopup = null;
      try {
        await sendRuntimeMessage({ type: 'UPDATE_PLAYLIST', id, parentId });
        await loadData();
        render();
        showToast(parentId ? 'Subgroup moved' : 'Moved to top level');
      } catch (error) {
        showToast(error.message || 'Could not move the subgroup', 'error');
      }
    });
  });

  list.querySelectorAll('[data-goto-child]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      rowPopup = null;
      selectedPlaylistId = btn.dataset.gotoChild;
      selectedView = 'direct';
      render();
    });
  });

  const addInput = list.querySelector('.row-popup-add-name');
  if (addInput) {
    const commitSubgroup = async () => {
      const popup = addInput.closest('.row-popup');
      const parentId = popup.dataset.popupFor;
      const name = addInput.value.trim();
      if (!name) return;
      try {
        const playlist = await sendRuntimeMessage({
          type: 'CREATE_PLAYLIST',
          name,
          color: '#4a9eff',
          parentId
        });
        rowPopup = null;
        await loadData();
        selectedPlaylistId = playlist.id;
        selectedView = 'direct';
        render();
        showToast('Subgroup created');
      } catch (error) {
        showToast(error.message || 'Could not create the subgroup', 'error');
      }
    };

    list.querySelector('.row-popup-add-btn')?.addEventListener('click', (e) => {
      e.stopPropagation();
      void commitSubgroup();
    });
    addInput.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') void commitSubgroup();
    });
    addInput.focus();
  }

  // Escape closes the popup and hands focus back to its trigger.
  const popup = list.querySelector('.row-popup');
  if (popup) {
    popup.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      const id = popup.dataset.popupFor;
      const kind = rowPopup?.kind || 'kebab';
      rowPopup = null;
      render();
      requestAnimationFrame(() => {
        const triggerClass = kind === 'subgroups' ? '.sub-popup-btn' : '.kebab-btn';
        document.querySelector(`${triggerClass}[data-id="${id}"]`)?.focus();
      });
    });
    popup.querySelector('.row-popup-item, .row-popup-add-name')?.focus();
  }

  // Edit inline
  list.querySelectorAll('.edit-pl-save').forEach(btn => {
    btn.addEventListener('click', async () => {
      try {
        const row = btn.closest('.edit-inline');
        const id = row.dataset.id;
        const name = row.querySelector('.edit-pl-name').value.trim();
        const color = row.querySelector('.edit-pl-color').value;
        if (!name) return;
        await sendRuntimeMessage({ type: 'UPDATE_PLAYLIST', id, name, color });
        editingPlaylistId = null;
        await loadData();
        render();
        showToast('Playlist updated');
      } catch (error) {
        showToast(error.message || 'Could not update the playlist', 'error');
      }
    });
  });

  list.querySelectorAll('.edit-pl-cancel').forEach(btn => {
    btn.addEventListener('click', () => { editingPlaylistId = null; render(); });
  });

  list.querySelectorAll('.edit-pl-name').forEach(input => {
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') input.closest('.edit-inline').querySelector('.edit-pl-save').click();
      if (e.key === 'Escape') { editingPlaylistId = null; render(); }
    });
    input.focus();
  });
}

function focusPopup(list, id, kind) {
  const popup = list.querySelector(`.row-popup[data-popup-for="${id}"]`);
  if (!popup) return;
  if (kind === 'subgroups') {
    const input = popup.querySelector('.row-popup-add-name');
    const firstChild = popup.querySelector('[data-goto-child]');
    (firstChild || input)?.focus();
  } else {
    popup.querySelector('.row-popup-item')?.focus();
  }
}

// --- Drag-and-drop reorder ---
//
// Reordering works among siblings only: drop targets are restricted to rows
// sharing the dragged row's parent (group rows for groups, a group's own
// subgroups for subgroups), and "Move" is the deliberate way to change a
// subgroup's parent. Dragging a group moves its whole rendered block — the
// group row plus its subgroups — as one unit.

function getDragAfterElement(list, y, dragging) {
  const draggingParent = dragging.dataset.parent;
  const rows = [...list.querySelectorAll('.list-item[data-id]:not(.dragging)')]
    .filter(row => row.dataset.parent === draggingParent);
  let closest = { offset: Number.NEGATIVE_INFINITY, element: null };
  for (const row of rows) {
    const box = row.getBoundingClientRect();
    const offset = y - box.top - box.height / 2;
    if (offset < 0 && offset > closest.offset) {
      closest = { offset, element: row };
    }
  }
  return closest.element;
}

// A group's rendered block: the group row plus every row after it up to the
// next group row (subgroups, their edit rows, menus — whatever is rendered).
function getDragRowBlock(row) {
  if (row.dataset.parent !== '') return [row];
  const block = [row];
  let sibling = row.nextElementSibling;
  while (sibling && !sibling.classList.contains('group-item')) {
    block.push(sibling);
    sibling = sibling.nextElementSibling;
  }
  return block;
}

// Every rendered subgroup row must sit directly below its own group's row
// (collapsed groups simply render no subgroups, so absent rows are fine).
function isValidSiblingLayout(list) {
  let currentTop = null;
  for (const row of list.querySelectorAll('.list-item[data-id]')) {
    if (row.dataset.parent === '') {
      currentTop = row.dataset.id;
      continue;
    }
    if (row.dataset.parent !== currentTop) return false;
  }
  return true;
}

function attachListLevelReorderListeners() {
  const list = document.getElementById('playlistList');

  list.addEventListener('dragover', (e) => {
    if (!dragId) return;
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
    const dragging = list.querySelector('.list-item.dragging');
    if (!dragging) return;
    const afterElement = getDragAfterElement(list, e.clientY, dragging);
    const block = getDragRowBlock(dragging);
    if (afterElement == null) {
      if (dragging.dataset.parent === '') {
        // Below every group row: a group drag goes to the very end.
        block.forEach(el => list.appendChild(el));
      } else {
        // Below the last sibling: a subgroup still belongs at the end of
        // its OWN group's block — right before the next group row — not
        // after unrelated groups that follow.
        const parentRow = list.querySelector(`.list-item[data-id="${CSS.escape(dragging.dataset.parent)}"]`);
        let next = parentRow?.nextElementSibling || null;
        while (next && !next.classList.contains('group-item')) {
          next = next.nextElementSibling;
        }
        if (next) list.insertBefore(dragging, next);
        else list.appendChild(dragging);
      }
    } else if (afterElement !== dragging) {
      block.forEach(el => list.insertBefore(el, afterElement));
    }
  });

  list.addEventListener('drop', (e) => { if (dragId) e.preventDefault(); });
}

function attachReorderListeners(list) {
  // Rows drag as a whole (no dedicated handle slot wasting space left of
  // the title); interactive elements opt out, and drags are refused while
  // an editor or popup is open — the affected playlist would render
  // without a data-id row and get silently persisted at the end.
  list.querySelectorAll('.list-item[data-id]').forEach(item => {
    item.addEventListener('mousedown', (e) => {
      delete item.dataset.dragged;
      if (editingPlaylistId !== null || rowPopup !== null) return;
      if (e.target.closest('.item-actions, .chevron, .row-popup, input, button')) return;
      item.setAttribute('draggable', 'true');
    });
    item.addEventListener('mouseup', () => item.removeAttribute('draggable'));
    item.addEventListener('mouseleave', () => {
      if (!item.classList.contains('dragging')) item.removeAttribute('draggable');
    });

    item.addEventListener('dragstart', (e) => {
      if (editingPlaylistId !== null || rowPopup !== null) {
        e.preventDefault();
        showToast('Close the open editor or menu before reordering', 'error');
        return;
      }
      dragId = item.dataset.id;
      item.classList.add('dragging');
      if (e.dataTransfer) {
        e.dataTransfer.effectAllowed = 'move';
        // Required for Firefox to initiate the drag session.
        try { e.dataTransfer.setData('text/plain', dragId); } catch {}
      }
    });

    item.addEventListener('dragend', () => {
      item.classList.remove('dragging');
      item.removeAttribute('draggable');
      // Flag so the synthetic click after a drag does not change selection.
      item.dataset.dragged = 'true';
      const orderedIds = [...list.querySelectorAll('.list-item[data-id]')].map(el => el.dataset.id);
      dragId = null;
      if (!isValidSiblingLayout(list)) {
        render();
        showToast('Reordering works within the same group. Use "Move" to change a subgroup\'s parent.', 'error');
        return;
      }
      void commitPlaylistReorder(orderedIds);
    });
  });
}

async function commitPlaylistReorder(orderedIds) {
  if (!data) return;

  const currentOrder = getPlaylistsSorted().map(pl => pl.id);
  // No-op if the order did not actually change.
  if (orderedIds.length === currentOrder.length &&
      orderedIds.every((id, i) => id === currentOrder[i])) {
    return;
  }

  try {
    await sendRuntimeMessage({ type: 'REORDER_PLAYLISTS', orderedIds });
    await loadData();
    render();
    showToast('Playlists reordered');
  } catch (error) {
    // Restore the persisted order on failure.
    await loadData().catch(() => {});
    render();
    showToast(error.message || 'Could not reorder playlists', 'error');
  }
}

function renderDetail() {
  const detail = document.getElementById('playlistDetail');
  const empty = document.getElementById('emptyDetail');
  const context = document.getElementById('detailContext');
  const addChannelBtn = document.getElementById('addChannelBtn');
  const addChannelRow = document.getElementById('addChannelRow');
  const isUncategorized = selectedPlaylistId === UNCATEGORIZED_ID;

  if (!selectedPlaylistId || (!isUncategorized && !data.playlists[selectedPlaylistId])) {
    detail.style.display = 'none';
    empty.style.display = '';
    context.textContent = '';
    return;
  }

  detail.style.display = '';
  empty.style.display = 'none';
  addChannelBtn.style.display = isUncategorized ? 'none' : '';
  if (isUncategorized) {
    addChannelRow.style.display = 'none';
    context.textContent = `Uncategorized — not assigned to any playlist (${getChannelsForPlaylist(UNCATEGORIZED_ID).length} channels)`;
    renderChannelList();
    return;
  }

  const playlist = data.playlists[selectedPlaylistId];
  const hasChildren = getSubgroupIds(selectedPlaylistId).length > 0;
  // A selected top-level group with subgroups always shows the union view —
  // the "Directly in X" row no longer exists, and a stale 'direct' view
  // (e.g. the group gained children via a Move while selected) would show
  // a roll-up count next to a direct-only channel list.
  if (hasChildren && !playlist.parentId) {
    selectedView = 'union';
  }
  if (selectedView === 'union' && hasChildren) {
    context.textContent = `${playlist.name} — includes subgroups (${getChannelsForFamily(selectedPlaylistId).length} channels)`;
  } else {
    context.textContent = `${playlist.name} (${getChannelsForPlaylist(selectedPlaylistId).length} channels)`;
  }

  renderChannelList();
}

function uncategorizedAssignmentMenuHTML(ch) {
  if (openSubmenuHandle !== ch.handle) return '';

  const checkSvg = '<svg viewBox="0 0 10 10" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M2 5.5L4.2 7.5L8 3"/></svg>';
  const renderItem = (pl, { subgroup = false, groupId = '', hidden = false } = {}) => `
    <label class="syp-dd-item${subgroup ? ' syp-dd-item--sub' : ''}" style="--playlist-color:${pl.color}"${groupId ? ` data-group-child="${groupId}"` : ''}${hidden ? ' hidden' : ''}>
      <input type="checkbox" data-playlist="${pl.id}">
      <span class="syp-dd-check">${checkSvg}</span>
      <span class="syp-dd-color" style="background:${pl.color}"></span>
      <span class="syp-dd-name">${escapeHtml(pl.name)}</span>
    </label>`;

  const rows = getPlaylistTree().map(top => {
    if (top.children.length === 0) return renderItem(top);
    const isOpen = assignmentExpandedGroups.has(top.id);
    return `<div class="syp-dd-group-row">
      ${renderItem(top)}
      <button type="button" class="syp-dd-group-toggle" data-group-toggle="${top.id}" aria-expanded="${isOpen}" aria-label="${isOpen ? 'Hide' : 'Show'} subgroups for ${escapeAttr(top.name)}">
        <span class="syp-dd-group-caret${isOpen ? ' open' : ''}">${ICONS.caret}</span>
        <span class="syp-dd-group-count">${top.children.length}</span>
      </button>
    </div>${top.children.map(child => renderItem(child, { subgroup: true, groupId: top.id, hidden: !isOpen })).join('')}`;
  }).join('');

  return `<div class="sub-assign-menu syp-dropdown" data-submenu-for="${escapeAttr(ch.handle)}" role="menu">
    <div class="syp-dd-header"><span>Playlists</span><button type="button" class="syp-dd-add-btn" data-assignment-add title="New playlist">+</button></div>
    <div class="syp-dd-list">${rows || '<div class="syp-dd-empty">No playlists yet.<br>Hit + to create one.</div>'}</div>
    <div class="syp-dd-sep"></div>
    <button type="button" class="syp-dd-footer" data-assignment-manage>Manage playlists ${ICONS.caret}</button>
  </div>`;
}

function renderChannelList() {
  const list = document.getElementById('channelList');
  const noChannels = document.getElementById('noChannels');
  const searchInput = document.getElementById('channelSearch');
  const searchTerm = searchInput.value.toLowerCase();
  const isUncategorized = selectedPlaylistId === UNCATEGORIZED_ID;
  const isUnionView = selectedView === 'union' && getSubgroupIds(selectedPlaylistId).length > 0;

  let channels = isUncategorized
    ? getChannelsForPlaylist(UNCATEGORIZED_ID)
    : isUnionView
    ? getChannelsForFamily(selectedPlaylistId)
    : getChannelsForPlaylist(selectedPlaylistId);
  if (searchTerm) {
    channels = channels.filter(ch =>
      ch.name.toLowerCase().includes(searchTerm) ||
      ch.handle.toLowerCase().includes(searchTerm)
    );
  }

  if (channels.length === 0) {
    list.innerHTML = '';
    noChannels.style.display = searchTerm ? 'none' : '';
    if (searchTerm) {
      list.innerHTML = '<div style="padding:12px 0;color:var(--text-muted);font-size:12px;text-align:center;">No matches</div>';
    }
    return;
  }

  noChannels.style.display = 'none';

  // Union view only: chips for the channel's subgroup assignments, anchored
  // right after the channel name; plus a per-row picker offering only the
  // selected group's subgroups.
  const assignmentPlaylists = isUncategorized
    ? getPlaylistTree().flatMap(top => [top, ...top.children])
    : (isUnionView ? getSubgroupIds(selectedPlaylistId).map(id => data.playlists[id]) : []);
  const subgroupIds = isUnionView ? assignmentPlaylists.map(pl => pl.id) : [];
  const subgroupChipsHTML = (ch) => {
    if (!isUnionView || !ch.memberIds) return '';
    const chips = ch.memberIds
      .filter(fid => subgroupIds.includes(fid))
      .map(fid => {
        const pl = data.playlists[fid] || {};
        return `<span class="sub-chip" title="${escapeAttr(`In ${pl.name || ''}`)}"><span class="sub-chip-dot" style="background:${pl.color || '#4a9eff'}"></span>${escapeHtml(pl.name || '')}</span>`;
      })
      .join('');
    return chips ? `<span class="sub-chips">${chips}</span>` : '';
  };
  const assignmentMenuHTML = (ch) => {
    if ((!isUnionView && !isUncategorized) || openSubmenuHandle !== ch.handle) return '';
    if (isUncategorized) return uncategorizedAssignmentMenuHTML(ch);
    const assigned = new Set(ch.memberIds || []);
    const options = assignmentPlaylists.map(pl => {
      return `<button type="button" class="sub-assign-option" data-handle="${escapeAttr(ch.handle)}" data-assign-id="${pl.id}">
        <span class="sub-assign-check">${assigned.has(pl.id) ? '&#10003;' : ''}</span>${escapeHtml(pl.name || '')}
      </button>`;
    });
    return `<div class="sub-assign-menu" data-submenu-for="${escapeAttr(ch.handle)}">${options.join('')}</div>`;
  };

  list.innerHTML = channels.map(ch => {
    return `<div class="list-item channel-item" data-handle="${escapeAttr(ch.handle)}">
      <div class="channel-item-info">
        <div class="channel-item-name">${escapeHtml(ch.name)}${subgroupChipsHTML(ch)}</div>
        <a class="channel-item-handle" href="https://www.youtube.com/${ch.handle.startsWith('@') ? '@' + encodeURIComponent(ch.handle.slice(1)) : 'channel/' + encodeURIComponent(ch.handle)}" target="_blank" rel="noopener">${escapeHtml(ch.handle)}</a>
      </div>
      <span class="item-actions" style="opacity:1;">
        ${isUncategorized || (isUnionView && assignmentPlaylists.length > 0) ? `<button class="btn btn-sm sub-assign-btn" data-handle="${escapeAttr(ch.handle)}" title="${isUncategorized ? 'Assign to a playlist' : 'Assign to a subgroup'}">+</button>` : ''}
        ${isUncategorized ? '' : `<button class="btn btn-sm btn-danger remove-ch-btn" data-handle="${escapeAttr(ch.handle)}" title="${isUnionView ? 'Remove from this group and its subgroups' : 'Remove from playlist'}">&#10005;</button>`}
      </span>
      ${assignmentMenuHTML(ch)}
    </div>`;
  }).join('');

  list.querySelectorAll('.sub-assign-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      openSubmenuHandle = openSubmenuHandle === btn.dataset.handle ? null : btn.dataset.handle;
      renderChannelList();
      const menu = list.querySelector('.sub-assign-menu');
      // Reveal the popup when its row sits near the panel's bottom edge.
      menu?.scrollIntoView({ block: 'nearest' });
      const first = menu?.querySelector('.sub-assign-option, .syp-dd-item input');
      first?.focus();
    });
  });

  list.querySelectorAll('[data-group-toggle]').forEach(toggle => {
    toggle.addEventListener('click', (e) => {
      e.stopPropagation();
      const groupId = toggle.dataset.groupToggle;
      const isOpen = !assignmentExpandedGroups.has(groupId);
      if (isOpen) assignmentExpandedGroups.add(groupId);
      else assignmentExpandedGroups.delete(groupId);
      toggle.setAttribute('aria-expanded', String(isOpen));
      toggle.setAttribute('aria-label', `${isOpen ? 'Hide' : 'Show'} subgroups for ${data.playlists[groupId]?.name || 'playlist'}`);
      toggle.querySelector('.syp-dd-group-caret')?.classList.toggle('open', isOpen);
      toggle.closest('.syp-dropdown').querySelectorAll('[data-group-child]').forEach(row => {
        if (row.dataset.groupChild === groupId) row.hidden = !isOpen;
      });
    });
  });

  list.querySelectorAll('.syp-dd-item input[data-playlist]').forEach(input => {
    input.addEventListener('change', async () => {
      const item = input.closest('.syp-dd-item');
      const handle = input.closest('.syp-dropdown').dataset.submenuFor;
      const playlistId = input.dataset.playlist;
      const playlistName = data.playlists[playlistId]?.name || 'playlist';
      item.classList.toggle('checked', input.checked);
      input.disabled = true;
      try {
        await sendRuntimeMessage({
          type: 'ASSIGN_CHANNEL_PLAYLIST',
          handle,
          name: (data.channels || {})[handle]?.name || handle,
          playlistId,
          assign: input.checked
        });
        openSubmenuHandle = null;
        await loadData();
        render();
        showToast(`Added to ${playlistName}`);
      } catch (error) {
        input.checked = !input.checked;
        item.classList.toggle('checked', input.checked);
        input.disabled = false;
        showToast(error.message || 'Could not update the playlist assignment', 'error');
      }
    });
  });

  list.querySelectorAll('[data-assignment-add]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      openSubmenuHandle = null;
      renderChannelList();
      const row = document.getElementById('addPlaylistRow');
      if (row.style.display === 'none') document.getElementById('addPlaylistBtn').click();
      else row.querySelector('input[type="text"]').focus();
    });
  });

  list.querySelectorAll('[data-assignment-manage]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      openSubmenuHandle = null;
      renderChannelList();
      const target = document.getElementById('addPlaylistBtn');
      target.scrollIntoView({ block: 'nearest' });
      target.focus();
    });
  });

  list.querySelectorAll('.sub-assign-option').forEach(btn => {
    btn.addEventListener('click', async () => {
      const handle = btn.dataset.handle;
      const playlistId = btn.dataset.assignId;
      const assigned = ((data.channelPlaylists || {})[handle] || []).includes(playlistId);
      const playlistName = data.playlists[playlistId]?.name || 'playlist';
      openSubmenuHandle = null;
      try {
        await sendRuntimeMessage({
          type: 'ASSIGN_CHANNEL_PLAYLIST',
          handle,
          name: (data.channels || {})[handle]?.name || handle,
          playlistId,
          assign: !assigned
        });
        await loadData();
        render();
        showToast(assigned ? 'Removed from subgroup' : 'Added to subgroup');
      } catch (error) {
        showToast(error.message || 'Could not update the playlist assignment', 'error');
      }
    });
  });

  // Escape closes the subgroup popup and refocuses its "+" trigger.
  const subMenu = list.querySelector('.sub-assign-menu');
  if (subMenu) {
    subMenu.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      const handle = subMenu.dataset.submenuFor;
      openSubmenuHandle = null;
      renderChannelList();
      requestAnimationFrame(() => {
        document.querySelector(`.sub-assign-btn[data-handle="${handle}"]`)?.focus();
      });
    });
  }

  list.querySelectorAll('.remove-ch-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      try {
        const handle = btn.dataset.handle;
        if (isUnionView) {
          // Union view: removing drops the channel from every family
          // playlist it belongs to (the group plus the subgroups shown as
          // dots), so the row genuinely disappears from the list.
          const memberIds = getChannelsForFamily(selectedPlaylistId)
            .find(ch => ch.handle === handle)?.memberIds || [];
          for (const playlistId of memberIds) {
            await sendRuntimeMessage({
              type: 'ASSIGN_CHANNEL_PLAYLIST',
              handle,
              playlistId,
              assign: false
            });
          }
          await loadData();
          render();
          showToast(memberIds.length > 1 ? `Removed from ${memberIds.length} playlists` : 'Channel removed');
          return;
        }
        await sendRuntimeMessage({
          type: 'ASSIGN_CHANNEL_PLAYLIST',
          handle,
          playlistId: selectedPlaylistId,
          assign: false
        });
        await loadData();
        render();
        showToast('Channel removed');
      } catch (error) {
        showToast(error.message || 'Could not remove the channel', 'error');
      }
    });
  });
}

// --- Event Listeners ---

function attachListeners() {
  // Playlist add: click "+" to reveal input, Enter commits, blur/Escape discards
  setupInlineAdd('addPlaylistBtn', 'addPlaylistRow', addPlaylist);

  // Channel add: same behavior
  setupInlineAdd('addChannelBtn', 'addChannelRow', addChannelManually);

  // List-level drag targets live as long as the page does; per-row drag
  // handlers are (re)attached on every render.
  attachListLevelReorderListeners();

  // Close the row popup and the subgroup-assignment menu when clicking
  // anywhere outside them.
  document.addEventListener('click', (e) => {
    if (rowPopup !== null &&
        !e.target.closest('.row-popup') && !e.target.closest('.sub-popup-btn') && !e.target.closest('.kebab-btn')) {
      rowPopup = null;
      render();
    }
    if (openSubmenuHandle !== null &&
        !e.target.closest('.sub-assign-menu') && !e.target.closest('.sub-assign-btn')) {
      openSubmenuHandle = null;
      renderChannelList();
    }
  });

  document.getElementById('channelSearch').addEventListener('input', () => {
    renderChannelList();
  });

  document.getElementById('exportBtn').addEventListener('click', exportPlaylists);
  document.getElementById('importBtn').addEventListener('click', () => document.getElementById('importFile').click());
  document.getElementById('importFile').addEventListener('change', importPlaylists);
}

function setupInlineAdd(btnId, rowId, commitFn) {
  const btn = document.getElementById(btnId);
  const row = document.getElementById(rowId);
  const textInput = row.querySelector('input[type="text"]');

  const isOpen = () => row.style.display !== 'none';

  const show = () => {
    row.style.display = '';
    textInput.focus();
  };

  const hide = () => {
    textInput.value = '';
    row.style.display = 'none';
  };

  btn.addEventListener('click', () => {
    if (!isOpen()) {
      show();
    } else {
      commitFn();
    }
  });

  textInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') commitFn();
    if (e.key === 'Escape') hide();
  });

  textInput.addEventListener('blur', () => {
    // Allow clicking the "+" button or color picker without discarding
    setTimeout(() => {
      if (!row.contains(document.activeElement)) {
        hide();
      }
    }, 120);
  });
}

async function addPlaylist() {
  const nameInput = document.getElementById('newPlaylistName');
  const colorInput = document.getElementById('newPlaylistColor');
  const name = nameInput.value.trim();
  if (!name) return;

  try {
    const playlist = await sendRuntimeMessage({
      type: 'CREATE_PLAYLIST',
      name,
      color: colorInput.value
    });

    nameInput.value = '';
    document.getElementById('addPlaylistRow').style.display = 'none';
    await loadData();
    selectedPlaylistId = playlist.id;
    selectedView = 'direct';
    render();
    showToast('Playlist created');
  } catch (error) {
    showToast(error.message || 'Could not create the playlist', 'error');
  }
}

async function addChannelManually() {
  if (!selectedPlaylistId || selectedPlaylistId === UNCATEGORIZED_ID) return;
  const input = document.getElementById('addChannelHandle');
  const parsed = parseManualChannelInput(input.value);
  if (!parsed) return;
  if (parsed.error) {
    showToast(parsed.error, 'error');
    return;
  }

  const { handle, displayName } = parsed;

  try {
    // Register channel
    await sendRuntimeMessage({
      type: 'REGISTER_CHANNEL',
      handle,
      name: displayName
    });

    // Assign to current playlist
    await sendRuntimeMessage({
      type: 'ASSIGN_CHANNEL_PLAYLIST',
      handle,
      name: displayName,
      playlistId: selectedPlaylistId,
      assign: true
    });

    input.value = '';
    document.getElementById('addChannelRow').style.display = 'none';
    await loadData();
    render();
    showToast('Channel added');
  } catch (error) {
    showToast(error.message || 'Could not add the channel', 'error');
  }
}

function parseManualChannelInput(rawValue) {
  return sharedCore.parseManualChannelInput(rawValue);
}

// --- Export ---

function exportPlaylists() {
  if (!data) return;

  const exportData = {
    playlists: data.playlists || {},
    channels: data.channels || {},
    channelPlaylists: data.channelPlaylists || {},
    exportedAt: new Date().toISOString()
  };

  const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `sYoutubePlaylist-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
  showToast('Playlists exported');
}

async function importPlaylists(e) {
  const file = e.target.files[0];
  if (!file) return;

  try {
    const text = await file.text();
    const imported = JSON.parse(text);

    // Validate structure
    if (!imported.playlists || typeof imported.playlists !== 'object') {
      showToast('Invalid file: missing playlists', 'error');
      return;
    }

    const mode = confirm(
      'Replace all existing data?\n\nOK = Replace everything\nCancel = Merge with existing'
    ) ? 'replace' : 'merge';

    const result = await sendRuntimeMessage({
      type: 'IMPORT_DATA',
      playlists: imported.playlists,
      channels: imported.channels || {},
      channelPlaylists: imported.channelPlaylists || {},
      mode
    });
    if (result?.error) throw new Error(result.error);

    selectedPlaylistId = null;
    await loadData();
    render();
    showToast('Playlists imported');
  } catch (err) {
    showToast(err?.message || 'Failed to read file', 'error');
  } finally {
    e.target.value = '';
  }
}

// --- Theme ---

function initTheme() {
  const toggle = document.getElementById('themeToggle');
  chrome.storage.local.get(['settings'], (result) => {
    const theme = result.settings?.theme || 'dark';
    document.body.setAttribute('data-theme', theme);
  });

  toggle.addEventListener('click', () => {
    const current = document.body.getAttribute('data-theme') || 'dark';
    const next = current === 'dark' ? 'light' : 'dark';
    document.body.setAttribute('data-theme', next);
    void sendRuntimeMessage({ type: 'UPDATE_SETTINGS', settings: { theme: next } }).catch((error) => {
      document.body.setAttribute('data-theme', current);
      showToast(error.message || 'Could not update the theme', 'error');
    });
  });
}

function initSectionToggles() {
  const toggles = [
    { element: document.getElementById('hideShortsToggle'), key: 'hideShorts' },
    { element: document.getElementById('hideMostRelevantToggle'), key: 'hideMostRelevant' },
    { element: document.getElementById('redirectRootToSubscriptionsToggle'), key: 'redirectRootToSubscriptions' }
  ];

  // Load current state
  chrome.storage.local.get(['settings'], (result) => {
    toggles.forEach(({ element, key }) => {
      element.checked = !!result.settings?.[key];
    });
  });

  toggles.forEach(({ element, key }) => {
    element.addEventListener('change', () => {
      void sendRuntimeMessage({ type: 'UPDATE_SETTINGS', settings: { [key]: element.checked } }).catch((error) => {
        element.checked = !element.checked;
        showToast(error.message || 'Could not update setting', 'error');
      });
    });
  });
}

// --- i18n ---

function initI18n() {
  document.querySelectorAll('[data-i18n]').forEach(el => {
    const key = el.getAttribute('data-i18n');
    const message = chrome.i18n.getMessage(key);
    if (message) {
      if (el.children.length === 0 || el.tagName === 'OPTION') {
        el.textContent = message;
      }
    }
  });
}

// --- Toast ---

let toastTimeout = null;
let toastVisible = false;

function showToast(message, type = 'success') {
  const toast = document.getElementById('toast');
  const toastIcon = toast.querySelector('.toast-icon');
  const toastMessage = toast.querySelector('.toast-message');

  if (toastTimeout) clearTimeout(toastTimeout);

  if (toastVisible) {
    toast.classList.remove('show');
    setTimeout(() => displayToast(), 100);
  } else {
    displayToast();
  }

  function displayToast() {
    toastMessage.textContent = message;
    toastIcon.textContent = type === 'success' ? '\u2713' : '\u2715';
    toast.className = 'toast ' + type;
    requestAnimationFrame(() => {
      toast.classList.add('show');
      toastVisible = true;
    });
    toastTimeout = setTimeout(() => {
      toast.classList.remove('show');
      toastVisible = false;
    }, 1500);
  }
}

// --- Helpers ---

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str || '';
  return div.innerHTML;
}

function escapeAttr(str) {
  return (str || '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/'/g, '&#39;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
