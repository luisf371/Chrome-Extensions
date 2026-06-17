/**
 * Reddit New Comments Highlighter - Content Script
 * Unified support for Old Reddit and New Reddit (Shreddit)
 */

(function() {
  'use strict';

  const PROCESSED_ATTR = 'data-rnch-processed';
  const HIGHLIGHT_CLASS = 'rnch-new-comment';

  // Mirrors background.js DEFAULT_SETTINGS; used as a fallback when the
  // service worker is mid-restart and a GET_SETTINGS message rejects.
  const DEFAULT_SETTINGS = {
    maxHistory: 10000,
    highlightColor: '#FFFDCC',
    darkModeColor: '#3d3d00',
    useSystemTheme: false,
    useDarkTheme: false,
    autoChangeTheme: false,
    themeStartTime: '18:00',
    themeEndTime: '08:00',
  };

  // Per-thread state. Reset on teardown() so SPA navigation between threads
  // starts clean instead of leaking the previous thread's observer/handlers.
  let settings = null;
  let threadId = null;
  let threadData = null;
  let newCommentCount = 0;
  let observer = null;
  let currentHighlightIndex = -1;
  let highlightedElements = [];
  let initialized = false;
  let threadPersisted = false;

  const RedditVersion = {
    OLD: 'old',
    NEW: 'new',
    UNKNOWN: 'unknown'
  };

  function detectRedditVersion() {
    if (document.querySelector('shreddit-app')) return RedditVersion.NEW;
    if (document.querySelector('.comments-page, .commentarea')) return RedditVersion.OLD;
    return RedditVersion.UNKNOWN;
  }

  function extractThreadId() {
    const match = window.location.pathname.match(/\/comments\/([a-z0-9]+)/i);
    return match ? match[1] : null;
  }

  function getHighlightColor() {
    if (settings.autoChangeTheme) {
      const now = new Date();
      const [startH, startM] = settings.themeStartTime.split(':').map(Number);
      const [endH, endM] = settings.themeEndTime.split(':').map(Number);
      const currentMinutes = now.getHours() * 60 + now.getMinutes();
      const startMinutes = startH * 60 + startM;
      const endMinutes = endH * 60 + endM;

      const isDarkTime = startMinutes > endMinutes
        ? (currentMinutes >= startMinutes || currentMinutes <= endMinutes)
        : (currentMinutes >= startMinutes && currentMinutes <= endMinutes);

      return isDarkTime ? settings.darkModeColor : settings.highlightColor;
    }

    if (settings.useSystemTheme) {
      return window.matchMedia('(prefers-color-scheme: dark)').matches
        ? settings.darkModeColor
        : settings.highlightColor;
    }

    return settings.useDarkTheme ? settings.darkModeColor : settings.highlightColor;
  }

  function injectHighlightStyles() {
    const existingStyle = document.getElementById('rnch-styles');
    if (existingStyle) existingStyle.remove();

    const color = getHighlightColor();
    const style = document.createElement('style');
    style.id = 'rnch-styles';
    style.textContent = `
      .${HIGHLIGHT_CLASS} {
        background-color: ${color} !important;
        transition: background-color 0.3s ease;
      }
      .${HIGHLIGHT_CLASS}.rnch-focused {
        outline: 2px solid #0079d3;
        outline-offset: 2px;
      }
      shreddit-comment.${HIGHLIGHT_CLASS}::part(comment) {
        background-color: ${color} !important;
      }
    `;
    document.head.appendChild(style);
  }

  function getCommentTimestamp(element, version) {
    // NOTE: This reads the timestamp from the displayed time element. On Old
    // Reddit `time[datetime]` is the comment-creation time, and on New Reddit
    // `faceplate-timeago[ts]` is likewise the creation timestamp (the "edited"
    // indicator is rendered as a separate element), so edited comments are not
    // mis-flagged as new. If no timestamp can be read the comment is left
    // un-highlighted (it cannot be compared against the last-visit boundary).
    if (version === RedditVersion.OLD) {
      const timeEl = element.querySelector('time[datetime]');
      return timeEl ? new Date(timeEl.getAttribute('datetime')).getTime() : null;
    }

    if (version === RedditVersion.NEW) {
      const timeEl = element.querySelector('faceplate-timeago[ts], time[datetime]');
      if (timeEl) {
        const ts = timeEl.getAttribute('ts') || timeEl.getAttribute('datetime');
        return ts ? new Date(ts).getTime() : null;
      }
    }

    return null;
  }

  function getCommentElements(version) {
    if (version === RedditVersion.OLD) {
      return document.querySelectorAll(`.thing.comment:not([${PROCESSED_ATTR}])`);
    }

    if (version === RedditVersion.NEW) {
      return document.querySelectorAll(`shreddit-comment:not([${PROCESSED_ATTR}])`);
    }

    return [];
  }

  function getHighlightTarget(element, version) {
    if (version === RedditVersion.OLD) {
      return element.querySelector('.entry') || element;
    }
    return element;
  }

  // Keep keyboard navigation following document order even when comments are
  // discovered out of order (e.g. a collapsed mid-thread branch is expanded
  // after initial load and its replies are appended later).
  function sortHighlightedElements() {
    highlightedElements.sort((a, b) => {
      const pos = a.compareDocumentPosition(b);
      if (pos & Node.DOCUMENT_POSITION_FOLLOWING) return -1;
      if (pos & Node.DOCUMENT_POSITION_PRECEDING) return 1;
      return 0;
    });
  }

  function highlightComments(version) {
    if (!threadData?.lastVisit) return;

    const comments = getCommentElements(version);
    let count = 0;

    comments.forEach(comment => {
      comment.setAttribute(PROCESSED_ATTR, 'true');

      const timestamp = getCommentTimestamp(comment, version);
      if (timestamp && timestamp > threadData.lastVisit) {
        const target = getHighlightTarget(comment, version);
        target.classList.add(HIGHLIGHT_CLASS);
        highlightedElements.push(target);
        count++;
      }
    });

    if (count > 0) {
      sortHighlightedElements();
      newCommentCount += count;
      updateBadge();
    }
  }

  function updateBadge() {
    chrome.runtime.sendMessage({
      type: 'UPDATE_BADGE',
      count: newCommentCount
    }).catch(() => {});
  }

  // --- Per-thread listeners (named so they can be removed on teardown) -------

  function handleKeydown(e) {
    if (e.target.matches('input, textarea, [contenteditable]')) return;
    if (highlightedElements.length === 0) return;

    let newIndex = currentHighlightIndex;

    if (e.key === 'j' || e.key === 'n') {
      newIndex = Math.min(currentHighlightIndex + 1, highlightedElements.length - 1);
    } else if (e.key === 'k' || e.key === 'p') {
      newIndex = Math.max(currentHighlightIndex - 1, 0);
    } else {
      return;
    }

    e.preventDefault();

    if (currentHighlightIndex >= 0 && highlightedElements[currentHighlightIndex]) {
      highlightedElements[currentHighlightIndex].classList.remove('rnch-focused');
    }

    currentHighlightIndex = newIndex;
    const target = highlightedElements[currentHighlightIndex];

    if (target) {
      target.classList.add('rnch-focused');
      target.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }

  const colorSchemeMedia = window.matchMedia('(prefers-color-scheme: dark)');

  function handleColorSchemeChange() {
    if (settings && settings.useSystemTheme) injectHighlightStyles();
  }

  function setupKeyboardNavigation() {
    document.addEventListener('keydown', handleKeydown);
  }

  function setupMutationObserver(version) {
    if (observer) observer.disconnect();

    const targetSelector = version === RedditVersion.NEW
      ? 'shreddit-comment-tree, [slot="comments"]'
      : '.commentarea, .nestedlisting';

    const target = document.querySelector(targetSelector);
    if (!target) return;

    let debounceTimer = null;

    observer = new MutationObserver(() => {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => highlightComments(version), 100);
    });

    observer.observe(target, {
      childList: true,
      subtree: true
    });
  }

  // --- Persistence / lifecycle ----------------------------------------------

  // Persist the last-visit boundary on page-LEAVE rather than at page-open, so
  // comments that lazy-load below the fold after init are still newer than the
  // stored boundary on the user's *next* visit (background.js stamps a fresh
  // lastVisit = Date.now() on save). Guarded so it runs at most once per thread.
  function persistThreadData() {
    if (!threadId || threadPersisted) return;
    threadPersisted = true;
    chrome.runtime.sendMessage({
      type: 'SAVE_THREAD_DATA',
      threadId,
      data: {}
    }).catch(() => {});
  }

  function teardown() {
    // Save the boundary for the thread we are leaving before resetting state.
    persistThreadData();

    if (observer) {
      observer.disconnect();
      observer = null;
    }
    document.removeEventListener('keydown', handleKeydown);

    // Clear any highlight/focus markers and processed flags so a re-init for a
    // new SPA-loaded thread starts from a clean DOM.
    document.querySelectorAll(`.${HIGHLIGHT_CLASS}`).forEach(el => {
      el.classList.remove(HIGHLIGHT_CLASS, 'rnch-focused');
    });
    document.querySelectorAll(`[${PROCESSED_ATTR}]`).forEach(el => {
      el.removeAttribute(PROCESSED_ATTR);
    });

    const style = document.getElementById('rnch-styles');
    if (style) style.remove();

    highlightedElements = [];
    currentHighlightIndex = -1;
    newCommentCount = 0;
    threadData = null;
    threadId = null;
    threadPersisted = false;
    initialized = false;
    updateBadge();
  }

  async function init() {
    if (initialized) return;

    const version = detectRedditVersion();
    if (version === RedditVersion.UNKNOWN) return;

    const id = extractThreadId();
    if (!id) return;

    threadId = id;
    threadPersisted = false;
    initialized = true;

    try {
      settings = await chrome.runtime.sendMessage({ type: 'GET_SETTINGS' });
    } catch (e) {
      settings = { ...DEFAULT_SETTINGS };
    }
    if (!settings) settings = { ...DEFAULT_SETTINGS };

    try {
      threadData = await chrome.runtime.sendMessage({
        type: 'GET_THREAD_DATA',
        threadId
      });
    } catch (e) {
      threadData = null;
    }

    injectHighlightStyles();
    highlightComments(version);
    setupMutationObserver(version);
    setupKeyboardNavigation();
    // NOTE: the last-visit boundary is intentionally persisted on page-leave
    // (see persistThreadData / pagehide / visibilitychange), not here.
  }

  // --- SPA navigation handling ----------------------------------------------
  // New Reddit (Shreddit) navigates thread -> thread via history.pushState with
  // no full document load. Without this, the second thread is never tracked and
  // the first thread's observer + keydown listener would leak.

  let lastUrl = window.location.href;

  function handleUrlChange() {
    if (window.location.href === lastUrl) return;
    lastUrl = window.location.href;

    const newId = extractThreadId();
    // Same comments thread (e.g. just a permalink to a child comment): keep the
    // current session running rather than tearing it down.
    if (newId && newId === threadId) return;

    teardown();
    // The new view's comment tree may not be in the DOM yet after a pushState
    // navigation; retry a few times until comments mount, then init once.
    let attempts = 0;
    const maxAttempts = 20;
    const tryInit = () => {
      if (initialized) return;
      if (detectRedditVersion() !== RedditVersion.UNKNOWN && extractThreadId()) {
        init();
        return;
      }
      if (++attempts < maxAttempts) setTimeout(tryInit, 250);
    };
    tryInit();
  }

  function installNavigationHooks() {
    const origPushState = history.pushState;
    const origReplaceState = history.replaceState;

    history.pushState = function(...args) {
      const ret = origPushState.apply(this, args);
      handleUrlChange();
      return ret;
    };
    history.replaceState = function(...args) {
      const ret = origReplaceState.apply(this, args);
      handleUrlChange();
      return ret;
    };
    window.addEventListener('popstate', handleUrlChange);
  }

  // --- Settings sync: push options changes into already-open tabs ------------

  function handleStorageChanged(changes, area) {
    if (area !== 'local' || !changes.settings) return;
    settings = { ...DEFAULT_SETTINGS, ...(changes.settings.newValue || {}) };
    if (initialized) injectHighlightStyles();
  }

  // --- One-time, page-lifetime listeners (registered once, never duplicated) -

  function installGlobalListeners() {
    colorSchemeMedia.addEventListener('change', handleColorSchemeChange);
    chrome.storage.onChanged.addListener(handleStorageChanged);

    // Persist the read boundary when the user leaves/hides the page. pagehide
    // covers tab close / full navigation; visibilitychange->hidden is the
    // reliable signal on mobile and bfcache cases.
    window.addEventListener('pagehide', persistThreadData);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') persistThreadData();
    });

    installNavigationHooks();
  }

  // --- Bootstrap -------------------------------------------------------------

  installGlobalListeners();

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
