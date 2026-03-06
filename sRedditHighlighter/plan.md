# Reddit New Comments Highlighter - MV3 Modernization Plan

## Deep Analysis Summary

### Current State
- **Manifest Version**: 3
- **Reddit Support**: Old Reddit + New Reddit (Shreddit)
- **Storage**: chrome.storage.local

---

## Critical Issues Found

| Issue | Severity | Impact |
|-------|----------|--------|
| **Kango Framework (defunct)** | CRITICAL | 20+ files of dead cross-browser abstraction. kangoextensions.com is gone. |
| **MV2 Manifest** | CRITICAL | Chrome will deprecate MV2 entirely in 2025 |
| **jQuery 2.1.4** | HIGH | 85KB of dead weight for 5 DOM operations |
| **Old Reddit only** | HIGH | Doesn't work on modern "Shreddit" Reddit (web components) |
| **Storage mismatch** | HIGH | Options use `localStorage`, background uses Kango storage = settings don't sync |
| **Overly broad permissions** | HIGH | `http://*/*, https://*/*` when only Reddit is needed |
| **'unsafe-eval' CSP** | HIGH | Security risk, banned in MV3 |
| **No dynamic loading support** | MEDIUM | Breaks on infinite scroll, "load more" clicks |

---

## Files to DELETE (Dead Code)

```
kango/                    # 15 files - entire defunct framework
  - api.js
  - backgroundscript_engine.js
  - browser.js
  - console.js
  - core.js
  - extension_info.js
  - i18n.js
  - initialize.js
  - invoke.js
  - invoke_async.js
  - io.js
  - lang.js
  - loader.js
  - message_target.js
  - messaging.js
  - storage.js
  - storage_sync.js
  - timer.js
  - userscript_engine.js
  - utils.js
  - xhr.js

kango-ui/                 # 5 files - UI abstractions
  - browser_button.js
  - context_menu.js
  - notifications.js
  - options.js
  - kango_api.js

background.html           # MV3 uses service workers, not background pages
includes/content_init.js  # Kango loader wrapper
includes/content.js       # Uses Kango messaging, will be replaced
content.js                # Root duplicate, uses Kango invokeAsync
jquery-2.1.4.js           # 85KB - replaced by native DOM APIs
bootstrap.css             # Bootstrap 2 from 2012 - replaced by modern CSS
extension_info.json       # Kango metadata file
readme.txt                # Outdated ("Built using Kango")
```

---

## New Architecture

### File Structure
```
manifest.json             # MV3 with minimal permissions
background.js             # Service worker (~60 lines)
src/
  content.js              # Unified content script (old + new Reddit)
  storage.js              # Shared storage utilities with defaults
  options.js              # Modern options with chrome.storage.local
  options.html            # Clean semantic HTML5
  options.css             # Modern CSS (CSS custom properties, no framework)
icons/                    # (preserved - icon48.png, icon128.png, button.png)
plan.md                   # This file
```

### Key Improvements

#### 1. Manifest V3 Compliance
- Service worker instead of background page
- Minimal permissions: only `storage` and Reddit host permissions
- No `unsafe-eval`, no remote code execution
- Proper `host_permissions` separation

#### 2. Modern Reddit Support (Shreddit)
- Detect Reddit version via `shreddit-app` element
- Use `::part()` selectors for Shadow DOM styling
- MutationObserver on `shreddit-comment-tree` for dynamic loading
- ResizeObserver fallback for lazy-loaded comments

#### 3. Storage Modernization
- Single source of truth: `chrome.storage.local`
- Async/await everywhere
- Proper defaults with `??` nullish coalescing
- Comment history stored per-thread with automatic pruning

#### 4. Performance
- No jQuery (native `querySelectorAll`, `closest`, etc.)
- Debounced observers to prevent excessive processing
- CSS-based highlighting (no inline styles per element)
- Batch DOM reads/writes

#### 5. UX Improvements
- Badge showing new comment count
- Keyboard navigation between new comments (j/k keys)
- Auto dark/light theme based on system preference
- Toast notification on page load showing count

---

## Implementation Phases

### Phase 1: Core Infrastructure
- [x] Analyze codebase
- [ ] Create MV3 manifest.json
- [ ] Create service worker (background.js)
- [ ] Create storage utilities (src/storage.js)

### Phase 2: Content Script
- [ ] Detect Reddit version (old vs new)
- [ ] Port highlighting logic
- [ ] Add MutationObserver for dynamic content
- [ ] Add keyboard navigation

### Phase 3: Options Page
- [ ] Modern HTML5 structure
- [ ] CSS with custom properties
- [ ] chrome.storage integration
- [ ] Live preview of highlight color

### Phase 4: Cleanup
- [ ] Delete all Kango files
- [ ] Delete jQuery
- [ ] Delete Bootstrap CSS
- [ ] Delete old content scripts

### Phase 5: Testing
- [ ] Test on old.reddit.com
- [ ] Test on www.reddit.com (Shreddit)
- [ ] Test options sync
- [ ] Test dynamic comment loading

---

## Technical Details

### Reddit Version Detection
```javascript
const isNewReddit = () => document.querySelector('shreddit-app') !== null;
const isOldReddit = () => document.querySelector('.comments-page') !== null;
```

### Comment Selectors
| Reddit Version | Comment Container | Timestamp |
|----------------|-------------------|-----------|
| Old Reddit | `.thing.comment .entry` | `time[datetime]` |
| New Reddit | `shreddit-comment` | `faceplate-timeago[ts]` |

### Storage Schema
```javascript
{
  // Settings
  "settings": {
    "maxHistory": 10000,
    "highlightColor": "#FFFDCC",
    "darkModeColor": "#444444",
    "useSystemTheme": true,
    "keyboardNav": true
  },
  // Per-thread data
  "threads": {
    "abc123": { "lastVisit": 1706000000000 },
    // ... up to maxHistory entries
  }
}
```

### Message Passing
```javascript
// Content -> Background: Update badge
chrome.runtime.sendMessage({ type: 'UPDATE_BADGE', count: 5 });

// Background -> Content: Settings changed
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === 'SETTINGS_UPDATED') reapplyHighlights();
});
```

---

## Dependencies

### Removed
- Kango framework (all files)
- jQuery 2.1.4
- Bootstrap 2 CSS

### Added
- None (pure vanilla JS + Chrome APIs)

### Browser Compatibility
- Chrome 120+ (MV3 required)
- Edge 120+ (Chromium-based)
- Firefox: Would need separate MV2 version (out of scope)

---

## Risk Assessment

| Risk | Mitigation |
|------|------------|
| New Reddit DOM changes frequently | Use stable selectors (`shreddit-*`), add version detection |
| Service worker may be terminated | Store state immediately, use `chrome.storage.session` for ephemeral data |

---

## Success Criteria

1. Extension loads without errors on both old and new Reddit
2. New comments are highlighted correctly
3. "Load more comments" triggers re-highlighting
4. Options save and apply without page reload
5. Badge shows accurate new comment count
6. Total extension size < 50KB (down from ~500KB)
7. No console errors or warnings
8. Passes Chrome Web Store MV3 requirements
