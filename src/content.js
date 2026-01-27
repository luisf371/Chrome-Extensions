/**
 * Reddit New Comments Highlighter - Content Script
 * Unified support for Old Reddit and New Reddit (Shreddit)
 */

(async function() {
  'use strict';

  const PROCESSED_ATTR = 'data-rnch-processed';
  const HIGHLIGHT_CLASS = 'rnch-new-comment';
  
  let settings = null;
  let threadId = null;
  let threadData = null;
  let newCommentCount = 0;
  let observer = null;
  let currentHighlightIndex = -1;
  let highlightedElements = [];

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

  function setupKeyboardNavigation() {
    document.addEventListener('keydown', (e) => {
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
    });
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

  async function migrateOldData() {
    const migrated = await chrome.storage.local.get('_migrated');
    if (migrated._migrated) return;
    
    try {
      const oldList = localStorage.getItem('cc-list');
      if (!oldList) {
        await chrome.storage.local.set({ _migrated: true });
        return;
      }
      
      const threads = {};
      const threadIds = oldList.split(',').filter(Boolean);
      
      for (const id of threadIds.slice(0, 1000)) {
        const data = localStorage.getItem(`cc-${id}`);
        if (data) {
          const [timestamp, count] = data.split(',');
          threads[id] = {
            lastVisit: parseInt(timestamp, 10),
            commentCount: parseInt(count, 10) || 0
          };
        }
      }
      
      if (Object.keys(threads).length > 0) {
        const existing = await chrome.storage.local.get('threads');
        await chrome.storage.local.set({ 
          threads: { ...threads, ...existing.threads },
          _migrated: true 
        });
        console.log(`[RNCH] Migrated ${Object.keys(threads).length} threads from old storage`);
      }
    } catch (e) {
      console.error('[RNCH] Migration failed:', e);
      await chrome.storage.local.set({ _migrated: true });
    }
  }

  async function init() {
    const version = detectRedditVersion();
    if (version === RedditVersion.UNKNOWN) return;
    
    threadId = extractThreadId();
    if (!threadId) return;
    
    await migrateOldData();
    
    settings = await chrome.runtime.sendMessage({ type: 'GET_SETTINGS' });
    threadData = await chrome.runtime.sendMessage({ 
      type: 'GET_THREAD_DATA', 
      threadId 
    });
    
    injectHighlightStyles();
    highlightComments(version);
    setupMutationObserver(version);
    setupKeyboardNavigation();
    
    const commentCount = version === RedditVersion.OLD
      ? document.querySelectorAll('.thing.comment').length
      : document.querySelectorAll('shreddit-comment').length;
    
    await chrome.runtime.sendMessage({
      type: 'SAVE_THREAD_DATA',
      threadId,
      data: { commentCount }
    });
    
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
      if (settings.useSystemTheme) injectHighlightStyles();
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
