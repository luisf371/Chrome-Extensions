/**
 * sRedditHighlighter - Content Script
 * Unified support for Old Reddit and New Reddit (Shreddit)
 */

(function() {
  'use strict';

  const PROCESSED_ATTR = 'data-srh-processed';
  const HIGHLIGHT_CLASS = 'srh-new-comment';

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
  let focusedElement = null;
  let highlightedElements = [];
  let initialized = false;
  let firstInit = true;
  let initGeneration = 0;
  let appliedColor = null;

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

  // "HH:MM" -> minutes since midnight; falls back to the default time when the
  // stored value is empty or malformed (otherwise the comparisons become NaN).
  function parseMinutes(value, fallback) {
    const match = /^(\d{1,2}):(\d{2})$/.exec(value || '');
    if (!match) return parseMinutes(fallback);
    return Number(match[1]) * 60 + Number(match[2]);
  }

  // Only plain hex colors are allowed into the injected stylesheet.
  function safeColor(value, fallback) {
    return /^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(value) ? value : fallback;
  }

  function getHighlightColor() {
    const lightColor = safeColor(settings.highlightColor, DEFAULT_SETTINGS.highlightColor);
    const darkColor = safeColor(settings.darkModeColor, DEFAULT_SETTINGS.darkModeColor);

    if (settings.autoChangeTheme) {
      const now = new Date();
      const currentMinutes = now.getHours() * 60 + now.getMinutes();
      const startMinutes = parseMinutes(settings.themeStartTime, DEFAULT_SETTINGS.themeStartTime);
      const endMinutes = parseMinutes(settings.themeEndTime, DEFAULT_SETTINGS.themeEndTime);

      const isDarkTime = startMinutes > endMinutes
        ? (currentMinutes >= startMinutes || currentMinutes <= endMinutes)
        : (currentMinutes >= startMinutes && currentMinutes <= endMinutes);

      return isDarkTime ? darkColor : lightColor;
    }

    if (settings.useSystemTheme) {
      return window.matchMedia('(prefers-color-scheme: dark)').matches
        ? darkColor
        : lightColor;
    }

    return settings.useDarkTheme ? darkColor : lightColor;
  }

  function injectHighlightStyles() {
    const existingStyle = document.getElementById('srh-styles');
    if (existingStyle) existingStyle.remove();

    const color = getHighlightColor();
    appliedColor = color;
    const style = document.createElement('style');
    style.id = 'srh-styles';
    style.textContent = `
      .${HIGHLIGHT_CLASS} {
        background-color: ${color} !important;
        transition: background-color 0.3s ease;
      }
      .${HIGHLIGHT_CLASS}.srh-focused {
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
      // A comment with no timestamp of its own would otherwise pick up the
      // time of a nested reply.
      if (timeEl && timeEl.closest('.thing.comment') !== element) return null;
      return timeEl ? new Date(timeEl.getAttribute('datetime')).getTime() : null;
    }

    if (version === RedditVersion.NEW) {
      const timeEl = element.querySelector('faceplate-timeago[ts], time[datetime]');
      if (timeEl && timeEl.closest('shreddit-comment') === element) {
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

  // After SPA navigation the previous thread's comments can still be in the DOM
  // for a moment; their permalink points at another thread.
  function belongsToCurrentThread(comment, version) {
    if (version !== RedditVersion.NEW) return true;
    const permalink = comment.getAttribute('permalink');
    if (!permalink) return true;
    const match = permalink.match(/\/comments\/([a-z0-9]+)/i);
    return !match || match[1].toLowerCase() === String(threadId).toLowerCase();
  }

  function highlightComments(version) {
    if (!threadData?.lastVisit) return;

    const comments = getCommentElements(version);
    let count = 0;

    comments.forEach(comment => {
      if (!belongsToCurrentThread(comment, version)) return;

      // Leave the comment unprocessed when its time is not readable yet, so a
      // later pass can try again.
      const timestamp = getCommentTimestamp(comment, version);
      if (!Number.isFinite(timestamp)) return;

      comment.setAttribute(PROCESSED_ATTR, 'true');
      if (timestamp > threadData.lastVisit) {
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

  // sendMessage throws synchronously once the extension has been reloaded or
  // updated (orphaned content script), so a bare .catch() is not enough.
  function updateBadge() {
    try {
      chrome.runtime.sendMessage({
        type: 'UPDATE_BADGE',
        count: newCommentCount
      }).catch(() => {});
    } catch (e) {
      // Extension context invalidated.
    }
  }

  // Focuses the next (step 1) or previous (step -1) new comment, wrapping at
  // either end. Comments removed by a re-render (sort change) or hidden inside a
  // collapsed thread are skipped, since scrolling to them does nothing.
  function goToNewComment(step) {
    const items = highlightedElements.filter(el => el.isConnected && el.getClientRects().length > 0);
    if (items.length === 0) return false;

    let index = items.indexOf(focusedElement);
    if (index === -1) {
      // Nothing focused yet: start from where the reader has scrolled to.
      const firstBelow = items.findIndex(el => el.getBoundingClientRect().top >= 0);
      if (step > 0) index = firstBelow === -1 ? 0 : firstBelow;
      else index = (firstBelow === -1 ? items.length : firstBelow) - 1;
      if (index < 0) index = items.length - 1;
    } else {
      index = (index + step + items.length) % items.length;
    }

    if (focusedElement) focusedElement.classList.remove('srh-focused');
    focusedElement = items[index];
    focusedElement.classList.add('srh-focused');
    focusedElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
    return true;
  }

  function handleMessage(message) {
    if (message?.type === 'NEXT_NEW_COMMENT') goToNewComment(1);
  }

  // --- Per-thread listeners (named so they can be removed on teardown) -------

  function handleKeydown(e) {
    // Leave shortcuts such as Ctrl+P / Cmd+K / Shift+W alone.
    if (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return;
    // e.target is retargeted to the host element for fields inside shadow DOM;
    // composedPath()[0] is the real element.
    const origin = e.composedPath()[0] || e.target;
    if (origin.isContentEditable || (origin.matches && origin.matches('input, textarea, select, [contenteditable]'))) return;
    if (e.target.matches('input, textarea, select, [contenteditable]')) return;

    // w/q are unbound in Reddit Enhancement Suite. Its window capture listener
    // is registered at document_start, so it always runs before this one: on
    // n (its Comment Navigator toggle) it moves focus into a <select>, and every
    // later key press then goes to that field instead.
    // toLowerCase() so Caps Lock does not disable the keys.
    const key = e.key.toLowerCase();
    let step;
    if (key === 'w') step = 1;
    else if (key === 'q') step = -1;
    else return;

    if (!goToNewComment(step)) return;
    // Capture phase on window: stops the page's own handlers (and any that
    // were registered after this one) from also acting on the key press.
    e.preventDefault();
    e.stopImmediatePropagation();
  }

  const colorSchemeMedia = window.matchMedia('(prefers-color-scheme: dark)');

  function handleColorSchemeChange() {
    if (settings && settings.useSystemTheme) injectHighlightStyles();
  }

  function setupKeyboardNavigation() {
    window.addEventListener('keydown', handleKeydown, true);
  }

  function setupMutationObserver(version) {
    if (observer) observer.disconnect();

    // Watch the whole body: the comment tree can be mounted late or replaced
    // (sort change, SPA navigation), which would orphan an observer bound to
    // one tree element. Mutations are debounced and already-processed comments
    // are skipped, so this stays cheap.
    const target = document.body;
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

  // Each visit (page load, refresh or SPA navigation into the thread) saves its
  // start time as the checkpoint the next visit compares against. Leaving or
  // switching tabs saves nothing, so a refresh always shows what was posted
  // since the previous load.
  function saveCheckpoint(visitStart) {
    try {
      chrome.runtime.sendMessage({
        type: 'SAVE_THREAD_DATA',
        threadId,
        data: { lastVisit: visitStart }
      }).catch(() => {});
    } catch (e) {
      // Extension context invalidated.
    }
  }

  // Called when the extension was reloaded/updated while this page stayed open:
  // chrome.* no longer works, so stop everything this script started.
  function retireOrphanedScript() {
    clearInterval(navUrlPollTimer);
    clearInterval(colorRefreshTimer);
    if (observer) {
      observer.disconnect();
      observer = null;
    }
    window.removeEventListener('keydown', handleKeydown, true);
    window.removeEventListener('popstate', handleUrlChange);
    colorSchemeMedia.removeEventListener('change', handleColorSchemeChange);
  }

  function isExtensionContextValid() {
    try {
      return !!(chrome.runtime && chrome.runtime.id);
    } catch (e) {
      return false;
    }
  }

  function teardown() {
    if (observer) {
      observer.disconnect();
      observer = null;
    }
    window.removeEventListener('keydown', handleKeydown, true);

    // Clear any highlight/focus markers and processed flags so a re-init for a
    // new SPA-loaded thread starts from a clean DOM.
    document.querySelectorAll(`.${HIGHLIGHT_CLASS}`).forEach(el => {
      el.classList.remove(HIGHLIGHT_CLASS, 'srh-focused');
    });
    document.querySelectorAll(`[${PROCESSED_ATTR}]`).forEach(el => {
      el.removeAttribute(PROCESSED_ATTR);
    });

    const style = document.getElementById('srh-styles');
    if (style) style.remove();

    highlightedElements = [];
    focusedElement = null;
    newCommentCount = 0;
    threadData = null;
    threadId = null;
    initialized = false;
    // Invalidate any init() still waiting on a message round-trip.
    initGeneration++;
    updateBadge();
  }

  async function init() {
    if (initialized) return;

    // On the first run the visit started at navigation start (before the HTML
    // was fetched), so a reply posted while the page loaded is not skipped.
    // After an SPA navigation timeOrigin is stale, so use the current time.
    const visitStart = firstInit ? Math.floor(performance.timeOrigin) : Date.now();
    firstInit = false;

    const version = detectRedditVersion();
    if (version === RedditVersion.UNKNOWN) return;

    const id = extractThreadId();
    if (!id) return;

    threadId = id;
    initialized = true;
    const generation = initGeneration;

    let loadedSettings;
    try {
      loadedSettings = await chrome.runtime.sendMessage({ type: 'GET_SETTINGS' });
    } catch (e) {
      loadedSettings = null;
    }
    // teardown() ran (and maybe a new init) while we were waiting: drop this one.
    if (generation !== initGeneration) return;
    settings = loadedSettings || { ...DEFAULT_SETTINGS };

    let loadedThreadData;
    let loadFailed = false;
    try {
      loadedThreadData = await chrome.runtime.sendMessage({
        type: 'GET_THREAD_DATA',
        threadId
      });
    } catch (e) {
      loadedThreadData = null;
      loadFailed = true;
    }
    if (generation !== initGeneration) return;
    threadData = loadedThreadData;
    // If the previous checkpoint could not be read, saving would overwrite it.
    if (!loadFailed) saveCheckpoint(visitStart);

    injectHighlightStyles();
    highlightComments(version);
    setupMutationObserver(version);
    setupKeyboardNavigation();
  }

  // --- SPA navigation handling ----------------------------------------------
  // New Reddit (Shreddit) navigates thread -> thread via history.pushState with
  // no full document load. Without this, the second thread is never tracked and
  // the first thread's observer + keydown listener would leak.

  let lastUrl = window.location.href;
  let navUrlPollTimer = null;

  function handleUrlChange() {
    if (!isExtensionContextValid()) {
      retireOrphanedScript();
      return;
    }
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

  let colorRefreshTimer = null;

  function installNavigationHooks() {
    window.addEventListener('popstate', handleUrlChange);
    // Content scripts run in an isolated world, so overriding history.pushState
    // here would only patch our own copy — New Reddit (Shreddit) calls its own
    // reference and our hook would never fire. Poll for URL changes instead;
    // handleUrlChange() is guarded by lastUrl, so this is cheap when idle.
    if (navUrlPollTimer === null) {
      navUrlPollTimer = setInterval(handleUrlChange, 500);
    }
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
    // Toolbar icon click (background.js).
    chrome.runtime.onMessage.addListener(handleMessage);

    // The time-based theme can flip while the page stays open.
    colorRefreshTimer = setInterval(() => {
      if (!isExtensionContextValid()) {
        retireOrphanedScript();
        return;
      }
      if (initialized && settings && settings.autoChangeTheme && getHighlightColor() !== appliedColor) {
        injectHighlightStyles();
      }
    }, 60000);

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
