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

  function getSubscriptionsFilterSnapshot() {
    const cards = Array.from(getSubscriptionsGrid()?.querySelectorAll('ytd-rich-item-renderer') || []);
    let unresolvedCount = 0;
    cards.forEach((card) => {
      if (!extractHandleFromCard(card)) {
        unresolvedCount += 1;
      }
    });
    return {
      cards,
      count: cards.length,
      firstCard: cards[0] || null,
      unresolvedCount
    };
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
    state.subscriptionsIncludeGroups = new Map();
    state.subduedPlaylistIds = new Set();
    state.subduedDirectPlaylistIds = new Set();
    state.filterPopupPlaylistId = null;
  }

  function setAllSubscriptionsFilter() {
    resetSubscriptionsFilterState();
  }

  function subgroupIdsOf(playlistId) {
    return Object.values(state.data?.playlists || {})
      .filter((pl) => pl.parentId === playlistId)
      .map((pl) => pl.id);
  }

  function directPlaylistHandlesOf(playlistId) {
    const handles = new Set(state.playlistChannels.get(playlistId) || []);
    subgroupIdsOf(playlistId).forEach((childId) => {
      (state.playlistChannels.get(childId) || []).forEach((handle) => handles.delete(handle));
    });
    return handles;
  }

  function checkedPlaylistIdsOf(playlistId) {
    const members = [playlistId, ...subgroupIdsOf(playlistId)];
    if (state.subscriptionsFilterMode === constants.FILTER_MODE_ALL) {
      return new Set(members);
    }
    if (state.subscriptionsFilterMode === constants.FILTER_MODE_EXCLUDE) {
      if (state.subduedPlaylistIds.has(playlistId)) return new Set();
      return new Set(members.filter((memberId) => (
        memberId === playlistId
          ? !state.subduedDirectPlaylistIds.has(playlistId)
          : !state.subduedPlaylistIds.has(memberId)
      )));
    }
    if (!state.subscriptionsIncludeGroups.has(playlistId)) {
      return new Set();
    }
    const selected = state.subscriptionsIncludeGroups.get(playlistId);
    return selected === null ? new Set(members) : selected;
  }

  function checkedSubgroupIdsOf(playlistId) {
    const checked = checkedPlaylistIdsOf(playlistId);
    return new Set(subgroupIdsOf(playlistId).filter((childId) => checked.has(childId)));
  }

  // Ctrl/Command+click: this group becomes the SOLE active one, reset to
  // its whole roll-up.
  function setIncludeSubscriptionsFilter(playlistId) {
    state.subscriptionsFilterMode = constants.FILTER_MODE_INCLUDE;
    state.subscriptionsIncludeGroups = new Map([[playlistId, null]]);
    state.subduedPlaylistIds = new Set();
    state.subduedDirectPlaylistIds = new Set();
  }

  function setIncludeSubscriptionsBucket(parentId, playlistId) {
    state.subscriptionsFilterMode = constants.FILTER_MODE_INCLUDE;
    state.subscriptionsIncludeGroups = new Map([[parentId, new Set([playlistId])]]);
    state.subduedPlaylistIds = new Set();
    state.subduedDirectPlaylistIds = new Set();
  }

  // Plain click toggles what the bar currently shows: from All/exclude mode
  // it turns this group off/on; from an include selection it appends/removes.
  function toggleSubscriptionsGroup(playlistId) {
    if (state.subscriptionsFilterMode === constants.FILTER_MODE_ALL ||
        state.subscriptionsFilterMode === constants.FILTER_MODE_EXCLUDE) {
      const next = new Set(state.subduedPlaylistIds);
      const directNext = new Set(state.subduedDirectPlaylistIds);
      const children = subgroupIdsOf(playlistId);
      if (next.has(playlistId)) next.delete(playlistId);
      else next.add(playlistId);
      children.forEach((childId) => next.delete(childId));
      directNext.delete(playlistId);
      setExcludedSubscriptionsFilter(next, directNext);
      return;
    }
    if (state.subscriptionsIncludeGroups.has(playlistId)) {
      state.subscriptionsIncludeGroups.delete(playlistId);
      return;
    }
    if (state.subscriptionsFilterMode !== constants.FILTER_MODE_INCLUDE) {
      state.subscriptionsFilterMode = constants.FILTER_MODE_INCLUDE;
      state.subduedPlaylistIds = new Set();
      state.subduedDirectPlaylistIds = new Set();
      state.subscriptionsIncludeGroups = new Map();
    }
    state.subscriptionsIncludeGroups.set(playlistId, null);
  }

  // Popup "All <group>": make this group full while preserving every other
  // active group.
  function setWholeGroupInclude(playlistId) {
    if (state.subscriptionsFilterMode === constants.FILTER_MODE_ALL) return;
    if (state.subscriptionsFilterMode === constants.FILTER_MODE_EXCLUDE) {
      const next = new Set(state.subduedPlaylistIds);
      const directNext = new Set(state.subduedDirectPlaylistIds);
      next.delete(playlistId);
      subgroupIdsOf(playlistId).forEach((childId) => next.delete(childId));
      directNext.delete(playlistId);
      setExcludedSubscriptionsFilter(next, directNext);
      return;
    }
    if (state.subscriptionsFilterMode !== constants.FILTER_MODE_INCLUDE) {
      state.subscriptionsFilterMode = constants.FILTER_MODE_INCLUDE;
      state.subduedPlaylistIds = new Set();
      state.subduedDirectPlaylistIds = new Set();
      state.subscriptionsIncludeGroups = new Map();
    }
    state.subscriptionsIncludeGroups.set(playlistId, null);
  }

  // Popup bucket toggle. playlistId may be the parent itself (direct members)
  // or one of its subgroups.
  function toggleIncludedSubgroup(parentId, playlistId) {
    const children = subgroupIdsOf(parentId);
    const members = [parentId, ...children];
    if (state.subscriptionsFilterMode === constants.FILTER_MODE_ALL) {
      if (playlistId === parentId) {
        const directNext = new Set(state.subduedDirectPlaylistIds);
        directNext.add(parentId);
        setExcludedSubscriptionsFilter(new Set(state.subduedPlaylistIds), directNext);
      } else {
        toggleExcludedSubscriptionsFilter(playlistId);
      }
      return;
    }
    if (state.subscriptionsFilterMode === constants.FILTER_MODE_EXCLUDE) {
      const next = new Set(state.subduedPlaylistIds);
      const directNext = new Set(state.subduedDirectPlaylistIds);
      if (next.has(parentId)) {
        next.delete(parentId);
        members.forEach((id) => {
          if (id === parentId) {
            if (id === playlistId) directNext.delete(parentId);
            else directNext.add(parentId);
          } else if (id === playlistId) {
            next.delete(id);
          } else {
            next.add(id);
          }
        });
      } else if (playlistId === parentId) {
        if (directNext.has(parentId)) directNext.delete(parentId);
        else directNext.add(parentId);
      } else if (next.has(playlistId)) {
        next.delete(playlistId);
      } else {
        next.add(playlistId);
      }
      setExcludedSubscriptionsFilter(next, directNext);
      return;
    }
    if (state.subscriptionsFilterMode !== constants.FILTER_MODE_INCLUDE) {
      state.subscriptionsFilterMode = constants.FILTER_MODE_INCLUDE;
      state.subduedPlaylistIds = new Set();
      state.subduedDirectPlaylistIds = new Set();
      state.subscriptionsIncludeGroups = new Map();
    }
    const current = state.subscriptionsIncludeGroups.get(parentId);
    const selected = current === null ? new Set(members) : new Set(current || []);
    if (selected.has(playlistId)) selected.delete(playlistId);
    else selected.add(playlistId);
    if (selected.size === 0) state.subscriptionsIncludeGroups.delete(parentId);
    else state.subscriptionsIncludeGroups.set(parentId, selected);
  }

  function closeFilterPopup({ render = true, restoreFocus = false } = {}) {
    if (!state.filterPopupPlaylistId) {
      api.clearDocumentCloseListener(state.filterPopupCloseState);
      return;
    }
    const playlistId = state.filterPopupPlaylistId;
    state.filterPopupPlaylistId = null;
    api.clearDocumentCloseListener(state.filterPopupCloseState);
    if (render) {
      renderFilterBar();
      if (restoreFocus) state.filterShadow?.querySelector(`[data-expand="${playlistId}"]`)?.focus();
    }
  }

  function armFilterPopupClose() {
    const closeHandler = (event) => {
      const path = event.composedPath();
      if (state.filterHost && path.includes(state.filterHost)) return;
      closeFilterPopup();
    };
    api.armDocumentCloseListener(state.filterPopupCloseState, closeHandler);
    armFilterPopupScrollClose();
  }

  // Page or chip-strip scrolling closes the popup; scrolling INSIDE the
  // popup (long subgroup lists) must not. Resize re-anchors nothing, so it
  // closes too.
  let filterPopupScrollCloseArmed = false;
  function armFilterPopupScrollClose() {
    if (filterPopupScrollCloseArmed) return;
    filterPopupScrollCloseArmed = true;
    window.addEventListener('scroll', (event) => {
      if (!state.filterPopupPlaylistId) return;
      const pop = state.filterShadow?.querySelector('.syp-pop');
      if (pop && event.target && pop.contains(event.target)) return;
      closeFilterPopup();
    }, true);
    window.addEventListener('resize', () => {
      if (state.filterPopupPlaylistId) closeFilterPopup();
    });
  }

  // The popup lives at the .syp-bar level (position:sticky, so a valid
  // containing block that nothing clips); only its horizontal offset is
  // computed, from the expand button, on every render.
  function placeFilterPopup() {
    const pop = state.filterShadow?.querySelector('.syp-pop');
    if (!pop) return;
    const btn = state.filterShadow.querySelector(`[data-expand="${state.filterPopupPlaylistId}"]`);
    const bar = state.filterShadow.querySelector('.syp-bar');
    if (!btn || !bar) return;
    const left = btn.getBoundingClientRect().left - bar.getBoundingClientRect().left;
    const maxLeft = Math.max(0, bar.clientWidth - pop.offsetWidth - 8);
    pop.style.left = `${Math.round(Math.max(0, Math.min(left, maxLeft)))}px`;
  }

  function setExcludedSubscriptionsFilter(next, directNext = new Set(state.subduedDirectPlaylistIds)) {
    if (next.size === 0 && directNext.size === 0) {
      setAllSubscriptionsFilter();
      return;
    }

    state.subscriptionsFilterMode = constants.FILTER_MODE_EXCLUDE;
    state.subscriptionsIncludeGroups = new Map();
    state.subduedPlaylistIds = next;
    state.subduedDirectPlaylistIds = directNext;
  }

  function toggleExcludedSubscriptionsFilter(playlistId) {
    const next = new Set(state.subduedPlaylistIds);
    if (next.has(playlistId)) next.delete(playlistId);
    else next.add(playlistId);
    setExcludedSubscriptionsFilter(next);
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
      const playlists = state.data?.playlists || {};
      const entries = [];
      for (const [parentId, selected] of state.subscriptionsIncludeGroups) {
        if (parentId === constants.UNCATEGORIZED_ID) {
          entries.push({ activePlaylistId: parentId });
          continue;
        }
        if (!playlists[parentId]) continue;
        if (selected === null) {
          entries.push({ activePlaylistId: parentId });
          continue;
        }
        const members = [parentId, ...subgroupIdsOf(parentId)];
        const included = Array.from(selected)
          .filter((playlistId) => members.includes(playlistId))
          .sort();
        entries.push({ activePlaylistId: parentId, includedPlaylistIds: included });
      }
      entries.sort((a, b) => (
        (playlists[a.activePlaylistId]?.order ?? Number.MAX_SAFE_INTEGER) -
        (playlists[b.activePlaylistId]?.order ?? Number.MAX_SAFE_INTEGER)
      ));
      return {
        mode: constants.FILTER_MODE_INCLUDE,
        includeGroups: entries,
        excludedPlaylistIds: [],
        excludedDirectPlaylistIds: []
      };
    }

    if (state.subscriptionsFilterMode === constants.FILTER_MODE_EXCLUDE) {
      const excludedPlaylistIds = Array.from(state.subduedPlaylistIds)
        .filter((playlistId) => (
          playlistId === constants.UNCATEGORIZED_ID || state.data?.playlists?.[playlistId]
        ));
      const excludedDirectPlaylistIds = Array.from(state.subduedDirectPlaylistIds)
        .filter((playlistId) => (
          state.data?.playlists?.[playlistId] && !state.data.playlists[playlistId].parentId
        ));
      if (excludedPlaylistIds.length === 0 && excludedDirectPlaylistIds.length === 0) return null;
      return {
        mode: constants.FILTER_MODE_EXCLUDE,
        includeGroups: [],
        excludedPlaylistIds,
        excludedDirectPlaylistIds
      };
    }

    return null;
  }

  function normalizeSubscriptionsFilterPreference(preference) {
    if (!preference || typeof preference !== 'object') return null;

    const playlists = state.data?.playlists || {};
    const validPlaylistIds = new Set(Object.keys(playlists));

    if (preference.mode === constants.FILTER_MODE_UNCATEGORIZED) {
      preference = {
        mode: constants.FILTER_MODE_INCLUDE,
        includeGroups: [{ activePlaylistId: constants.UNCATEGORIZED_ID }]
      };
    }

    if (preference.mode === constants.FILTER_MODE_INCLUDE ||
        (!preference.mode && typeof preference.activePlaylistId === 'string')) {
      // Accept the canonical multi-group shape and every legacy single-group
      // shape ({activePlaylistId, includedPlaylistIds?}, subgroup-as-active,
      // pre-popup bare saves). Absent includedPlaylistIds = whole group; an
      // empty list means no subgroup selection.
      const rawGroups = Array.isArray(preference.includeGroups)
        ? preference.includeGroups
        : [preference];

      const merged = new Map();
      for (const group of rawGroups) {
        if (!group || typeof group.activePlaylistId !== 'string') continue;
        let parentId = group.activePlaylistId;
        if (parentId === constants.UNCATEGORIZED_ID) {
          merged.set(parentId, null);
          continue;
        }
        if (!validPlaylistIds.has(parentId)) continue;

        let included = null;
        if (playlists[parentId]?.parentId) {
          // Legacy: a subgroup saved as the active playlist becomes its
          // parent with only that subgroup checked.
          included = new Set([parentId]);
          parentId = playlists[parentId].parentId;
        } else if (Array.isArray(group.includedPlaylistIds)) {
          included = new Set(group.includedPlaylistIds.filter((playlistId) => (
            typeof playlistId === 'string' &&
            (playlistId === parentId || playlists[playlistId]?.parentId === parentId)
          )));
        }

        const existing = merged.get(parentId);
        if (existing === undefined) {
          merged.set(parentId, included);
        } else if (existing !== null && included !== null) {
          included.forEach((id) => existing.add(id));
        } else {
          // A whole-group entry dominates an explicit subset.
          merged.set(parentId, null);
        }
      }

      // An explicitly empty canonical list means "show no groups". Invalid
      // non-empty/legacy shapes still fall back to All instead of hiding the
      // feed unexpectedly.
      if (merged.size === 0 && rawGroups.length > 0) return null;
      const includeGroups = Array.from(merged.entries())
        .filter(([, selected]) => selected === null || selected.size > 0)
        .map(([activePlaylistId, selected]) => (
          selected === null
            ? { activePlaylistId }
            : { activePlaylistId, includedPlaylistIds: Array.from(selected).sort() }
        ))
        .sort((a, b) => (
          (playlists[a.activePlaylistId]?.order ?? Number.MAX_SAFE_INTEGER) -
          (playlists[b.activePlaylistId]?.order ?? Number.MAX_SAFE_INTEGER)
        ));
      return {
        mode: constants.FILTER_MODE_INCLUDE,
        includeGroups,
        excludedPlaylistIds: [],
        excludedDirectPlaylistIds: []
      };
    }

    if (preference.mode === constants.FILTER_MODE_EXCLUDE) {
      const excludedPlaylistIds = Array.isArray(preference.excludedPlaylistIds)
        ? preference.excludedPlaylistIds.filter((playlistId) => (
          typeof playlistId === 'string' &&
          (playlistId === constants.UNCATEGORIZED_ID || validPlaylistIds.has(playlistId))
        ))
        : [];
      const excludedDirectPlaylistIds = Array.isArray(preference.excludedDirectPlaylistIds)
        ? preference.excludedDirectPlaylistIds.filter((playlistId) => (
          typeof playlistId === 'string' &&
          validPlaylistIds.has(playlistId) &&
          !playlists[playlistId]?.parentId
        ))
        : [];
      if (excludedPlaylistIds.length === 0 && excludedDirectPlaylistIds.length === 0) return null;
      return {
        mode: constants.FILTER_MODE_EXCLUDE,
        includeGroups: [],
        excludedPlaylistIds,
        excludedDirectPlaylistIds
      };
    }

    return null;
  }

  function applySubscriptionsFilterPreference(preference) {
    if (!preference) {
      setAllSubscriptionsFilter();
      return;
    }

    if (preference.mode === constants.FILTER_MODE_UNCATEGORIZED) {
      setIncludeSubscriptionsFilter(constants.UNCATEGORIZED_ID);
      return;
    }

    if (preference.mode === constants.FILTER_MODE_INCLUDE) {
      const map = new Map();
      for (const group of preference.includeGroups) {
        const parentId = group.activePlaylistId;
        if (parentId === constants.UNCATEGORIZED_ID) {
          map.set(parentId, null);
          continue;
        }
        if (!Array.isArray(group.includedPlaylistIds)) {
          map.set(parentId, null);
          continue;
        }
        const members = [parentId, ...subgroupIdsOf(parentId)];
        const set = new Set(members.filter((id) => group.includedPlaylistIds.includes(id)));
        if (set.size > 0) map.set(parentId, set);
      }
      state.subscriptionsFilterMode = constants.FILTER_MODE_INCLUDE;
      state.subscriptionsIncludeGroups = map;
      state.subduedPlaylistIds = new Set();
      state.subduedDirectPlaylistIds = new Set();
      return;
    }

    if (preference.mode === constants.FILTER_MODE_EXCLUDE) {
      state.subscriptionsFilterMode = constants.FILTER_MODE_EXCLUDE;
      state.subscriptionsIncludeGroups = new Map();
      state.subduedPlaylistIds = new Set(preference.excludedPlaylistIds);
      state.subduedDirectPlaylistIds = new Set(preference.excludedDirectPlaylistIds);
      return;
    }

    setAllSubscriptionsFilter();
  }

  function restoreSavedSubscriptionsPreference() {
    applySubscriptionsFilterPreference(getSavedSubscriptionsPreference());
  }

  function syncSubscriptionsFilterState() {
    const playlists = state.data?.playlists || {};
    const validPlaylistIds = new Set(Object.keys(playlists));

    if (state.subscriptionsFilterMode === constants.FILTER_MODE_INCLUDE) {
      // Prune deleted groups and stale subgroup ids. A null (whole-group)
      // entry stays null so subgroups created later are included
      // automatically. A group moved under another parent converts to a
      // checked child of its new parent; deleting a parent simply drops it
      // (promoted children are not auto-activated).
      //
      // Two passes, in order: moved playlists must MERGE into the
      // destination's own surviving entry — processing moves inline let a
      // later destination entry overwrite an earlier merge, silently
      // dropping the moved playlist depending on map insertion order.
      const next = new Map();
      const movedChildIds = [];
      for (const [parentId, selected] of state.subscriptionsIncludeGroups) {
        if (parentId === constants.UNCATEGORIZED_ID) {
          next.set(parentId, null);
          continue;
        }
        const playlist = playlists[parentId];
        if (!playlist) continue;
        if (playlist.parentId) {
          movedChildIds.push(parentId);
          continue;
        }
        if (selected === null) {
          next.set(parentId, null);
          continue;
        }
        const members = [parentId, ...subgroupIdsOf(parentId)];
        const pruned = new Set(Array.from(selected).filter((id) => members.includes(id)));
        if (pruned.size > 0) next.set(parentId, pruned);
      }
      for (const childId of movedChildIds) {
        const destination = playlists[childId].parentId;
        const existing = next.get(destination);
        if (existing === undefined) {
          next.set(destination, new Set([childId]));
        } else if (existing !== null) {
          existing.add(childId);
        }
        // A null (whole-group) destination dominates: the moved child is
        // already included.
      }
      state.subscriptionsIncludeGroups = next;
      return;
    }

    if (state.subscriptionsFilterMode === constants.FILTER_MODE_EXCLUDE) {
      state.subduedPlaylistIds = new Set(
        Array.from(state.subduedPlaylistIds).filter((playlistId) => (
          playlistId === constants.UNCATEGORIZED_ID || validPlaylistIds.has(playlistId)
        ))
      );
      state.subduedDirectPlaylistIds = new Set(
        Array.from(state.subduedDirectPlaylistIds).filter((playlistId) => (
          validPlaylistIds.has(playlistId) && !playlists[playlistId]?.parentId
        ))
      );
      if (state.subduedPlaylistIds.size === 0 && state.subduedDirectPlaylistIds.size === 0) {
        setAllSubscriptionsFilter();
      }
      return;
    }

    if (state.subscriptionsFilterMode === constants.FILTER_MODE_UNCATEGORIZED) {
      state.subscriptionsFilterMode = constants.FILTER_MODE_INCLUDE;
      state.subscriptionsIncludeGroups = new Map([[constants.UNCATEGORIZED_ID, null]]);
      state.subduedPlaylistIds = new Set();
      state.subduedDirectPlaylistIds = new Set();
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
    // Hydrate from the saved preference only ONCE per tab session — later
    // re-inits (SPA churn) must continue from the live state, not replay
    // the save over the user's in-session toggles. Sync ALWAYS runs after:
    // playlist data may have changed while this tab sat on another page
    // (DATA_CHANGED only routes here when subscriptions is current), and a
    // stale deleted group in the map would empty the feed.
    if (!state.subscriptionsFilterRestored) {
      state.subscriptionsFilterRestored = true;
      restoreSavedSubscriptionsPreference();
    }
    syncSubscriptionsFilterState();
    if (!injectFilterBar()) return;
    applySectionVisibility();
    const filterResult = applyFilter();
    if (!observeFeed(filterResult)) return;
    scheduleSubscriptionsFilterRetry(gen, filterResult.unresolvedCount);
    state.initSucceeded = true;
  }

  function scheduleSubscriptionsFilterRetry(gen, unresolvedCount, attempt = 0) {
    clearTimeout(state.subscriptionsFilterRetryTimer);
    state.subscriptionsFilterRetryTimer = null;

    if (!hasActiveSubscriptionsFilter() || unresolvedCount === 0 || attempt >= 6) return;

    state.subscriptionsFilterRetryTimer = setTimeout(() => {
      state.subscriptionsFilterRetryTimer = null;

      const rerunFilter = () => {
        if (state.currentPage !== 'subscriptions' || gen !== state.initGeneration) return;
        const nextResult = applyFilter();
        scheduleSubscriptionsFilterRetry(gen, nextResult.unresolvedCount, attempt + 1);
      };

      if (typeof window.requestAnimationFrame === 'function') {
        window.requestAnimationFrame(rerunFilter);
        return;
      }

      rerunFilter();
    }, attempt === 0 ? 80 : 150);
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
    // The bar shows top-level groups only. A group with subgroups gets an
    // expand segment that opens a popup for toggling individual subgroups;
    // clicking the main listing itself filters on the whole group (union).
    const playlistsByOrder = Object.values(state.data.playlists || {}).sort((a, b) => a.order - b.order);
    const topPlaylists = playlistsByOrder.filter((pl) => !pl.parentId || !state.data.playlists[pl.parentId]);
    const childrenOf = (playlistId) => playlistsByOrder.filter((pl) => pl.parentId === playlistId);
    const caretSvg = '<svg viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M5 3l5 4-5 4"/></svg>';
    const savedPreference = getSavedSubscriptionsPreference();

    const checkSvg = '<svg viewBox="0 0 10 10" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M2 5.5L4.2 7.5L8 3"/></svg>';
    const mixedSvg = '<svg viewBox="0 0 10 10" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M2 5h6"/></svg>';
    const checkHTML = (checked, color) => `<span class="syp-pop-check"${checked ? ` style="background:${color};border-color:transparent;"` : ''}>${checked === 'mixed' ? mixedSvg : checkSvg}</span>`;

    const popupHTML = (pl, children) => {
      const checked = checkedPlaylistIdsOf(pl.id);
      const memberCount = children.length + 1;
      const isAllOn = checked.size === memberCount;
      const parentChecked = isAllOn ? true : checked.size > 0 ? 'mixed' : false;
      const isExcluded = (playlistId) => (
        state.subscriptionsFilterMode === constants.FILTER_MODE_EXCLUDE &&
        state.subduedPlaylistIds.has(playlistId)
      );
      const directOn = checked.has(pl.id);
      const directExcluded = state.subscriptionsFilterMode === constants.FILTER_MODE_EXCLUDE && (
        state.subduedPlaylistIds.has(pl.id) || state.subduedDirectPlaylistIds.has(pl.id)
      );
      const directCount = directPlaylistHandlesOf(pl.id).size;
      const directRow = `<button type="button" role="menuitemcheckbox" aria-checked="${directOn}" class="syp-pop-item ${directOn ? 'on' : ''}${directExcluded ? ' syp-pop-item--excluded' : ''}" data-pop-playlist="${pl.id}" data-pop-parent="${pl.id}" title="Click to toggle direct members. Ctrl/Command+Click to show only these channels.">
        ${checkHTML(directOn, pl.color)}<span class="syp-pop-name">${api.escapeHtml(pl.name)} — no subgroup</span><span class="syp-count">${directCount}</span>
      </button>`;
      const childRows = children.map((child) => {
        const on = checked.has(child.id);
        const childCount = state.playlistChannels.get(child.id)?.size || 0;
        const excluded = isExcluded(child.id);
        return `<button type="button" role="menuitemcheckbox" aria-checked="${on}" class="syp-pop-item ${on ? 'on' : ''}${excluded ? ' syp-pop-item--excluded' : ''}" data-pop-playlist="${child.id}" data-pop-parent="${pl.id}" title="Click to toggle this subgroup. Ctrl/Command+Click to show only this subgroup.">
          ${checkHTML(on, child.color)}<span class="syp-pop-name">${api.escapeHtml(child.name)}</span><span class="syp-count">${childCount}</span>
        </button>`;
      }).join('');
      const groupCount = state.playlistChannelsRollup.get(pl.id)?.size || 0;
      return `<div class="syp-pop" id="syp-filter-popup" role="menu" aria-label="${api.escapeHtml(pl.name)} filters">
        <button type="button" role="menuitemcheckbox" aria-checked="${parentChecked}" class="syp-pop-item ${isAllOn ? 'on' : parentChecked === 'mixed' ? 'partial' : ''}" data-pop-all="${pl.id}" title="Show the whole group including all subgroups">
          ${checkHTML(parentChecked, pl.color)}<span class="syp-pop-name">All ${api.escapeHtml(pl.name)}</span><span class="syp-count">${groupCount}</span>
        </button>
        ${directRow}
        ${childRows}
      </div>`;
    };

    let openPopupHTML = '';
    const uncategorizedExcluded = state.subscriptionsFilterMode === constants.FILTER_MODE_EXCLUDE &&
      state.subduedPlaylistIds.has(constants.UNCATEGORIZED_ID);
    const uncategorizedActive = state.subscriptionsFilterMode === constants.FILTER_MODE_ALL ||
      (state.subscriptionsFilterMode === constants.FILTER_MODE_EXCLUDE && !uncategorizedExcluded) ||
      (state.subscriptionsFilterMode === constants.FILTER_MODE_INCLUDE &&
        state.subscriptionsIncludeGroups.has(constants.UNCATEGORIZED_ID));
    const uncategorizedClasses = ['syp-btn'];
    if (uncategorizedActive) uncategorizedClasses.push('active');
    if (uncategorizedExcluded) uncategorizedClasses.push('subdued');
    else if (state.subscriptionsFilterMode === constants.FILTER_MODE_INCLUDE && !uncategorizedActive) {
      uncategorizedClasses.push('off');
    }
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
        /* Toggled-ON groups render as the normal chip (no special active
        style); groups that are OFF while a selection exists get the
        subdued dim. A PARTIAL group (on, but with some subgroups
        unchecked) gets a third, accent-tinted state. Excluded
        (ctrl-hidden) keeps the 50% subdued look. */
        .syp-btn.off,
        .syp-btn-group .syp-btn-main.off + .syp-btn-expand {
          background: ${isDark ? '#1d1d1d' : '#ebebeb'};
          color: ${isDark ? '#b9b9b9' : '#5b5b5b'};
        }
        .syp-btn.partial,
        .syp-btn-group .syp-btn-main.partial + .syp-btn-expand {
          background: ${isDark ? '#2d3a49' : '#d7e5f4'};
          color: ${isDark ? '#8ab4f8' : '#065fd4'};
        }
        .syp-btn[data-action="all"].active {
          background: ${isDark ? '#2d3a49' : '#d7e5f4'};
          color: ${isDark ? '#8ab4f8' : '#065fd4'};
        }
        .syp-btn.subdued {
          opacity: 0.5;
          background: ${isDark ? '#1d1d1d' : '#ebebeb'};
          color: ${isDark ? '#b9b9b9' : '#5b5b5b'};
        }
        .syp-btn.subdued:hover {
          opacity: 0.8;
        }
        .syp-btn:focus-visible,
        .syp-pop-item:focus-visible,
        .syp-menu-item:focus-visible {
          outline: 2px solid ${isDark ? '#8ab4f8' : '#065fd4'};
          outline-offset: 2px;
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
        .syp-btn-group {
          display: inline-flex;
          align-items: stretch;
          position: relative;
        }
        .syp-btn-group .syp-btn-main {
          border-radius: 8px 0 0 8px;
        }
        .syp-btn-group .syp-btn-main:hover {
          border-top-right-radius: 0;
          border-bottom-right-radius: 0;
        }
        .syp-btn-group .syp-btn-expand {
          border-radius: 0 8px 8px 0;
          padding: 6px 10px;
          position: relative;
          border-left: 1px solid ${isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)'};
        }
        .syp-btn-group .syp-btn-expand.open {
          background: ${isDark ? '#3a3a3a' : '#e0e0e0'};
        }
        .syp-btn-group .syp-btn-expand svg {
          width: 13px;
          height: 13px;
          display: block;
          transition: transform 0.15s ease;
        }
        .syp-btn-group .syp-btn-expand.open svg {
          transform: rotate(90deg);
        }
        .syp-btn-group .syp-btn-expand.subset::after {
          content: '';
          position: absolute;
          top: 4px;
          right: 4px;
          width: 5px;
          height: 5px;
          border-radius: 50%;
          background: ${isDark ? '#8ab4f8' : '#065fd4'};
        }
        /* Anchored to the sticky bar (not the scrolling chip strip): the
           strip's overflow-x would clip it vertically. Left is set by JS. */
        .syp-pop {
          position: absolute;
          top: calc(100% + 6px);
          left: 0;
          z-index: 20;
          min-width: 220px;
          max-width: 280px;
          max-height: min(420px, 60vh);
          overflow-y: auto;
          padding: 6px;
          border-radius: 12px;
          border: 1px solid ${isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)'};
          background: ${isDark ? '#1f1f1f' : '#ffffff'};
          box-shadow: ${isDark
        ? '0 18px 40px rgba(0,0,0,0.45)'
        : '0 18px 40px rgba(0,0,0,0.14)'};
        }
        .syp-pop-item {
          display: flex;
          align-items: center;
          gap: 10px;
          width: 100%;
          text-align: left;
          padding: 8px 10px;
          border: none;
          border-radius: 8px;
          background: transparent;
          color: ${isDark ? '#f1f1f1' : '#0f0f0f'};
          font-family: inherit;
          font-size: 13px;
          white-space: nowrap;
          cursor: pointer;
        }
        .syp-pop-item:hover {
          background: ${isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.05)'};
        }
        .syp-pop-item.on,
        .syp-pop-item.partial {
          background: ${isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.06)'};
        }
        .syp-pop-check {
          width: 16px;
          height: 16px;
          border-radius: 5px;
          border: 1.5px solid ${isDark ? 'rgba(255,255,255,0.25)' : 'rgba(0,0,0,0.25)'};
          display: grid;
          place-items: center;
          flex-shrink: 0;
        }
        .syp-pop-check svg {
          width: 9px;
          height: 9px;
          opacity: 0;
        }
        .syp-pop-item.on .syp-pop-check svg,
        .syp-pop-item.partial .syp-pop-check svg {
          opacity: 1;
        }
        .syp-pop-name {
          flex: 1;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .syp-pop-item .syp-count {
          margin-left: auto;
          font-size: 11px;
          opacity: 0.7;
        }
        .syp-pop-item--excluded {
          opacity: 0.5;
          color: ${isDark ? '#b9b9b9' : '#5b5b5b'};
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
              aria-pressed="${state.subscriptionsFilterMode === constants.FILTER_MODE_ALL}"
            >All</button>
            ${(() => {
          let openPopup = '';
          const html = topPlaylists.map((pl) => {
            const children = childrenOf(pl.id);
            const count = state.playlistChannelsRollup.get(pl.id)?.size || 0;
            const isParentExcluded = state.subscriptionsFilterMode === constants.FILTER_MODE_EXCLUDE &&
              state.subduedPlaylistIds.has(pl.id);
            const isActive = state.subscriptionsFilterMode === constants.FILTER_MODE_ALL ||
              (state.subscriptionsFilterMode === constants.FILTER_MODE_EXCLUDE && !isParentExcluded) ||
              (state.subscriptionsFilterMode === constants.FILTER_MODE_INCLUDE && state.subscriptionsIncludeGroups.has(pl.id));
            const includeSelection = state.subscriptionsIncludeGroups.get(pl.id);
            const isPartial = isActive && children.length > 0 && (
              (state.subscriptionsFilterMode === constants.FILTER_MODE_INCLUDE && includeSelection !== null) ||
              (state.subscriptionsFilterMode === constants.FILTER_MODE_EXCLUDE &&
                (state.subduedDirectPlaylistIds.has(pl.id) ||
                  children.some((child) => state.subduedPlaylistIds.has(child.id))))
            );
            const mainClasses = ['syp-btn'];
            if (isActive) mainClasses.push('active');
            if (isParentExcluded) mainClasses.push('subdued');
            if (children.length > 0) mainClasses.push('syp-btn-main');
            // While an include selection exists, unselected groups dim —
            // the subdued look marks OFF, not ON. A partial group (on with
            // unchecked subgroups) shows the accent-tinted third state.
            if (isPartial) mainClasses.push('partial');
            else if (state.subscriptionsFilterMode === constants.FILTER_MODE_INCLUDE && !isActive) mainClasses.push('off');
            const mainBtn = `<button
                  type="button"
                  class="${mainClasses.join(' ')}"
                  data-playlist="${pl.id}"
                  aria-pressed="${isPartial ? 'mixed' : isActive}"
                  title="Click to toggle this playlist. Ctrl/Command+Click to show only this one."
                >
                  <span class="syp-dot" style="background:${pl.color}"></span>
                  ${api.escapeHtml(pl.name)}
                  <span class="syp-count">${count}</span>
                </button>`;
            if (children.length === 0) return mainBtn;

            const popupOpen = state.filterPopupPlaylistId === pl.id;
            const hasSubset = isPartial;
            if (popupOpen) openPopup = popupHTML(pl, children);
            return `<div class="syp-btn-group">
                ${mainBtn}
                <button
                  type="button"
                  class="syp-btn syp-btn-expand${popupOpen ? ' open' : ''}${hasSubset ? ' subset' : ''}"
                  data-expand="${pl.id}"
                  aria-haspopup="menu"
                  aria-expanded="${popupOpen}"
                  aria-controls="syp-filter-popup"
                  aria-label="Toggle ${api.escapeHtml(pl.name)} filters"
                  title="Toggle group filters"
                >${caretSvg}</button>
              </div>`;
          }).join('');
          // The popup is rendered at the .syp-bar level, NOT inside the
          // horizontally-scrolling chip strip — the strip's overflow-x clips
          // absolutely positioned children vertically.
          openPopupHTML = openPopup;
          return html;
        })()}
            <button
              type="button"
              class="${uncategorizedClasses.join(' ')}"
              data-playlist="${constants.UNCATEGORIZED_ID}"
              aria-pressed="${uncategorizedActive}"
              title="Click to toggle Uncategorized. Ctrl/Command+Click to show only Uncategorized."
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
        ${openPopupHTML}
      </div>
    `;

    state.filterShadow.querySelectorAll('[data-action="all"]').forEach((btn) => {
      btn.addEventListener('click', () => {
        setAllSubscriptionsFilter();
        state.filterMenuOpen = false;
        closeFilterPopup({ render: false });
        renderFilterBar();
        applyFilter();
      });
    });

    state.filterShadow.querySelectorAll('[data-playlist]').forEach((btn) => {
      btn.addEventListener('click', (event) => {
        const playlistId = btn.dataset.playlist;
        if (!playlistId) return;
        // Plain click toggles the group's current on/off state;
        // Ctrl/Command+click makes it the only active one.
        if (event.ctrlKey || event.metaKey) {
          setIncludeSubscriptionsFilter(playlistId);
        } else {
          toggleSubscriptionsGroup(playlistId);
        }
        state.filterMenuOpen = false;
        closeFilterPopup({ render: false });
        renderFilterBar();
        applyFilter();
      });
    });

    // Expand segment: opens the subgroup popup for that group.
    state.filterShadow.querySelectorAll('[data-expand]').forEach((btn) => {
      btn.addEventListener('click', (event) => {
        event.stopPropagation();
        const playlistId = btn.dataset.expand;
        // Opening a popup is a pure UI operation: it mirrors the group's
        // current state (OFF parent -> all subgroups unchecked) without
        // touching the include map.
        const opening = state.filterPopupPlaylistId !== playlistId;
        state.filterPopupPlaylistId = opening ? playlistId : null;
        renderFilterBar();
        if (opening) armFilterPopupClose();
        else api.clearDocumentCloseListener(state.filterPopupCloseState);
      });
    });

    // "All <group>": re-checks every subgroup of that group while keeping
    // any other active groups intact.
    state.filterShadow.querySelectorAll('[data-pop-all]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const parentId = btn.dataset.popAll;
        setWholeGroupInclude(parentId);
        renderFilterBar();
        applyFilter();
        state.filterShadow.querySelector(`[data-pop-all="${parentId}"]`)?.focus();
      });
    });

    // Direct/subgroup buckets toggle normally; Ctrl/Command+Click makes the
    // chosen bucket the sole selection, matching the main bar.
    state.filterShadow.querySelectorAll('[data-pop-playlist]').forEach((btn) => {
      btn.addEventListener('click', (event) => {
        const playlistId = btn.dataset.popPlaylist;
        const parentId = btn.dataset.popParent;
        if (event.ctrlKey || event.metaKey) {
          setIncludeSubscriptionsBucket(parentId, playlistId);
          state.filterPopupPlaylistId = null;
          api.clearDocumentCloseListener(state.filterPopupCloseState);
          renderFilterBar();
          applyFilter();
          state.filterShadow.querySelector(`[data-expand="${parentId}"]`)?.focus();
          return;
        }
        toggleIncludedSubgroup(parentId, playlistId);
        renderFilterBar();
        applyFilter();
        state.filterShadow.querySelector(
          `[data-pop-parent="${parentId}"][data-pop-playlist="${playlistId}"]`
        )?.focus();
      });
    });

    const popup = state.filterShadow.querySelector('.syp-pop');
    if (popup) {
      popup.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') {
          event.preventDefault();
          closeFilterPopup({ restoreFocus: true });
          return;
        }
        const items = Array.from(popup.querySelectorAll('.syp-pop-item'));
        const current = items.indexOf(event.target);
        let next = current;
        if (event.key === 'ArrowDown') next = (current + 1) % items.length;
        else if (event.key === 'ArrowUp') next = (current - 1 + items.length) % items.length;
        else if (event.key === 'Home') next = 0;
        else if (event.key === 'End') next = items.length - 1;
        else return;
        event.preventDefault();
        items[next]?.focus();
      });
      popup.querySelector('.syp-pop-item')?.focus();
      armFilterPopupClose();
      placeFilterPopup();
    } else {
      api.clearDocumentCloseListener(state.filterPopupCloseState);
    }

    state.filterShadow.querySelectorAll('[data-action="toggle-menu"]').forEach((btn) => {
      btn.addEventListener('click', (event) => {
        event.stopPropagation();
        state.filterMenuOpen = !state.filterMenuOpen;
        if (state.filterMenuOpen) closeFilterPopup({ render: false });
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
    const snapshot = getSubscriptionsFilterSnapshot();
    const { cards } = snapshot;

    if (state.subscriptionsFilterMode === constants.FILTER_MODE_ALL) {
      cards.forEach((card) => {
        card.style.display = '';
      });
      return snapshot;
    }

    let allowedHandles = null;
    let excludedHandles = null;
    let includeUncategorized = false;
    let excludeUncategorized = false;
    if (state.subscriptionsFilterMode === constants.FILTER_MODE_INCLUDE) {
      allowedHandles = new Set();
      for (const [parentId, selected] of state.subscriptionsIncludeGroups) {
        if (parentId === constants.UNCATEGORIZED_ID) {
          includeUncategorized = true;
          continue;
        }
        if (selected === null) {
          (state.playlistChannelsRollup.get(parentId) || []).forEach((handle) => allowedHandles.add(handle));
          continue;
        }
        selected.forEach((playlistId) => {
          const handles = playlistId === parentId
            ? directPlaylistHandlesOf(parentId)
            : state.playlistChannels.get(playlistId) || [];
          handles.forEach((handle) => allowedHandles.add(handle));
        });
      }
    } else if (state.subscriptionsFilterMode === constants.FILTER_MODE_EXCLUDE) {
      excludedHandles = new Set();
      state.subduedPlaylistIds.forEach((playlistId) => {
        if (playlistId === constants.UNCATEGORIZED_ID) {
          excludeUncategorized = true;
          return;
        }
        const handles = state.playlistChannelsRollup.get(playlistId);
        if (!handles) return;
        handles.forEach((handle) => excludedHandles.add(handle));
      });
      state.subduedDirectPlaylistIds.forEach((playlistId) => {
        directPlaylistHandlesOf(playlistId).forEach((handle) => excludedHandles.add(handle));
      });
    }

    cards.forEach((card) => {
      const handle = extractHandleFromCard(card);
      let show;
      if (state.subscriptionsFilterMode === constants.FILTER_MODE_EXCLUDE) {
        show = !handle || (
          !excludedHandles.has(handle) &&
          !(excludeUncategorized && !state.allAssignedHandles.has(handle))
        );
      } else {
        show = handle && (
          allowedHandles.has(handle) ||
          (includeUncategorized && !state.allAssignedHandles.has(handle))
        );
      }
      card.style.display = show ? '' : 'none';
    });

    return snapshot;
  }

  function extractHandleFromCard(card) {
    const handleLink = card.querySelector('a[href*="/@"]');
    if (handleLink) {
      const match = handleLink.getAttribute('href').match(/\/@([^/?#]+)/);
      if (match) return '@' + match[1];
    }
    const channelLink = card.querySelector('a[href*="/channel/"]');
    if (channelLink) {
      const match = channelLink.getAttribute('href').match(/\/channel\/([^/?#]+)/);
      if (match) return match[1];
    }
    return null;
  }

  function observeFeed(initialSnapshot = getSubscriptionsFilterSnapshot()) {
    const browse = getActiveSubscriptionsBrowse();
    if (!browse) return false;

    let lastFilteredCount = initialSnapshot.count;
    let lastFirstCard = initialSnapshot.firstCard;
    let lastUnresolvedCount = initialSnapshot.unresolvedCount;
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

        const currentSnapshot = getSubscriptionsFilterSnapshot();
        if (
          currentSnapshot.count !== lastFilteredCount
          || currentSnapshot.firstCard !== lastFirstCard
          || currentSnapshot.unresolvedCount !== lastUnresolvedCount
        ) {
          const filterResult = applyFilter();
          lastFilteredCount = filterResult.count;
          lastFirstCard = filterResult.firstCard;
          lastUnresolvedCount = filterResult.unresolvedCount;
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
      const filterResult = applyFilter();
      scheduleSubscriptionsFilterRetry(state.initGeneration, filterResult.unresolvedCount);
    },
  };
})();
