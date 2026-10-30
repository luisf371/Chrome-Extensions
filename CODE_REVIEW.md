# Code Review: Chrome-Extensions

**Result: 0 CRITICAL, 9 HIGH, 57 MEDIUM and 183 LOW findings across the 9 extensions (249 surviving).**

- Date: 2026-10-30
- HEAD `2bbe9eb` equals `main` and the working tree was clean, so there was no diff. The full source of each extension folder was reviewed (about 40k lines including locales and CSS).
- No files in the repo were changed by the review.
- Of the 249 findings, 216 are bugs, 33 are cleanup-type, and 78 are plausible (P).

## How it ran

- **Finders:** 9 Sonnet agents at high effort, one per extension, ran all 10 angles (A to J) plus `node --check`, the existing tests, and locale, element-id and message-contract checks. They produced 207 candidates.
- **Verifiers:** 9 independent Sonnet agents, one per extension, in place of the recipe's one verifier per candidate, to keep token use down. Each gave every candidate CONFIRMED, PLAUSIBLE or REFUTED with its own severity. Several reproduced bugs in a mock-chrome harness, a node vm, or real Linux Chromium.
- **Sweep:** each verifier then looked for gaps and added 44 new findings.
- **Orchestrator checks:** 2 candidates were refuted. The orchestrator re-read the code for all 9 HIGH findings and for the 6 MEDIUM findings in the top 15, and all held.
- **Existing tests:** sSummarizer's 4 suites pass and sYoutubeOrganizer's 45 tests pass. The other 7 extensions have no tests.

**Legend:** `[C]` = confirmed. `[P]` = plausible (the mechanism is real but the trigger depends on browser, site or server behavior nobody could run). Numbers in parentheses are finding IDs; `S`-prefixed IDs (S1, S2, …) were added by the verifier sweep.

## Summary

| Extension | HIGH | MED | LOW | Headline |
|---|---|---|---|---|
| sBookmarkCleaner | 1 | 8 | 22 | saved scan report overwritten after the service worker idles |
| sExport | 0 | 5 | 14 | restore runs inside a popup that dies; tab order not preserved |
| sGesture | 1 | 8 | 19 | gestures broken on macOS and Linux |
| sNeatBookmarks | 2 | 8 | 31 | search shows nothing if a folder name matches; titles double-escaped |
| sRedditHighlighter | 1 | 5 | 16 | script not injected when navigating from a feed to a thread |
| sSummarizer | 1 | 5 | 23 | Anthropic header missing |
| sTabControl | 3 | 5 | 14 | cold-start state bug; wrong tab placement; duplicate-close misfire |
| sUndoClose | 0 | 6 | 20 | — |
| sYoutubeOrganizer | 0 | 7 | 24 | — |
| **Total** | **9** | **57** | **183** | |

---

## sBookmarkCleaner (1 HIGH, 8 MEDIUM, 22 LOW)

### HIGH

- **[C]** `background.js:53` The message handlers (ignore, recheck, pause, cancel, clear, resume, start) and `onRemoved` don't await `stateReady`. After a service-worker restart they write the empty default `scanState` over the saved report.

### MEDIUM

- **[C]** `report.js:233` `selectedIds` is never pruned. After Clear Report or a filter change, "Delete Selected (N)" deletes bookmarks that are no longer visible, with no undo.
- **[C]** `background.js:437` Every fetch failure is labelled "DNS Error", so an offline scan marks every bookmark broken.
- **[C]** `background.js:429` The HEAD-to-GET retry covers only 403 and 405. Servers that answer HEAD with 404, 501 or a reset connection are reported dead.
- **[C]** `background.js:249` Any non-2xx result (429, 999, 5xx, timeout) counts as broken, with no retry or throttling.
- **[C]** `background.js:23` The async restore replaces `scanState` after handlers such as `startScan` may have run on the defaults.
- **[C]** `background.js:497` `onRemoved` doesn't wait for `stateReady`, so removals that wake an idle worker never reach the saved report.
- **[C]** `background.js:497` (S2) Removing a folder leaves its descendants in the broken and duplicate lists.
- **[C]** `options.js:121` All settings share one 300 ms debounce, so a second change cancels the first save.

### LOW

- Resume ignored during an in-flight check (4).
- `#fragment` stripped, so Gmail-style hash URLs look like duplicates (9).
- "Timeout" shown as "Unknown Error" (17).
- README claims settings sync but the code uses `storage.local` (20).
- `startSort` failure reported as success (S1).
- Duplicate delete-button state is stale after re-render (S4).
- Cleared timeout saved as 1000 ms instead of the 5 s default (S7).
- An in-flight item after cancel pollutes the new state (5).
- Permanent delete with no undo, and it can select every copy of a duplicate set (11).
- Recheck ignores the timeout setting (16).
- Unneeded `tabs` permission (21).
- Classes with no CSS (22).
- Failed deletes leave phantom rows (S3).
- Pause at the last item leaves an odd state (S5).
- Sequential link checks (13).
- Copy-pasted i18n and theme code (24).
- **P:** GET fallback never drains the body (14).
- **P:** sort moves every child, causing sync churn (15).
- **P:** no `lastError` check in the `report.js` callback (18).
- **P:** scan probes localhost and LAN URLs (23).
- **P:** long recheck persists only at the end (S6).
- **P:** full state rewritten every 20 items (12).

---

## sExport (0 HIGH, 5 MEDIUM, 14 LOW)

### MEDIUM

- **[C]** `popup.js:154` Tabs are bucketed by `groupId` in first-appearance order. A, [B,C], D restores as A, D, B, C (reproduced).
- **[P]** `popup.js:570` Restore runs inside the popup, which Chrome destroys on focus loss, so long restores die partway.
- **[P]** `popup.js:508` The final window focus closes the popup before the result or error status is shown.
- **[P]** `popup.js:189` With "Allow in Incognito", private windows are exported unmarked and restored as normal windows.
- **[P]** `popup.html:26` (S1) The file picker lives inside the popup, which the native chooser may dismiss on macOS and Linux.

### LOW

- Status always says "Restored." even with errors (13).
- Active tab and window state not exported (10).
- Group color not validated (11).
- Non-http(s) tabs silently dropped (14).
- Sequential `tabGroups.query` (17).
- Dead `safeTabTitle` (18).
- **P:** `windowsCreate` not in try/catch (1).
- **P:** Save-As cancel re-prompts through the data: fallback (5).
- **P:** one empty URL rejects the whole file on import (7).
- **P:** `pendingUrl` and title mismatch (8).
- **P:** data: fallback too large for big exports (6).
- **P:** group collapse versus active tab (12).
- **P:** lone-surrogate `URIError`, probably unreachable (15).
- **P:** popup-type windows (16).

---

## sGesture (1 HIGH, 8 MEDIUM, 19 LOW)

### HIGH

- **[C]** `mouseTrack.js:271` On macOS and Linux `contextmenu` fires on right mousedown, before any movement. The handler only prevents it once `moved` or `rocked` is set, so the menu opens at gesture start. Reproduced on Linux Chromium; only Windows works.

### MEDIUM

- **[C]** `mouseTrack.js:171` `lmousedown` sticks after native drag-and-drop. Gestures die until the next left click, and with rocker on, a plain right-click fires Forward.
- **[C]** `mouseTrack.js:116` Back, forward, reload, stop and scroll run in the iframe the gesture started over, not the tab.
- **[C]** `mouseTrack.js:205` An `<a>` with no usable href (empty, `mailto:`, SVG) makes the new-tab gesture do nothing.
- **[C]** `mouseTrack.js:146` Options are read once and there is no `onChanged` listener, so changes don't reach open tabs.
- **[C]** `background.js:48` "Reopen last closed tab" reads only the newest session entry and recreates it by URL instead of calling `sessions.restore`.
- **[C]** `mouseTrack.js:172` (S3) A rocker action that navigates away leaves the old page in bfcache with button flags stuck.
- **[P]** `mouseTrack.js:212` `mousemove` never checks `event.buttons`.
- **[P]** `options.js:179` The 300 ms debounced save is lost when the popup closes.

### LOW

- `console.log` noise on every frame (24).
- English-only strings (25).
- No `match_about_blank`, so srcdoc and about:blank frames get no gestures (S2).
- L-to-R rocker leaves `state.link` stale (12).
- Scroll uses `window.scrollTo` only (13).
- Trail canvas ignores devicePixelRatio (15).
- Command lookup on a plain object, so `'constructor'` resolves (18).
- No injection into tabs that were already open (21).
- Background error responses ignored (23).
- Editable detection misses `plaintext-only`, `role=textbox` and shadow DOM (14).
- Canvas appended even with trails off (16).
- Unused background handlers (19).
- Unused `activeTab` permission (20).
- **P:** no hysteresis in the gesture string (9).
- **P:** defaults persisted only on install (10).
- **P:** bubble-phase listeners defeated by `stopPropagation` (11).
- **P:** cached canvas lost on body replacement (S1).
- **P:** tab commands target the current window, not the sender (17).
- **P:** "Reload All Tabs" hits every window (22).

---

## sNeatBookmarks (2 HIGH, 8 MEDIUM, 31 LOW)

### HIGH

- **[C]** `neat.js:359` `bookmarks.search` also returns matching folders, which have no url. `htmlspecialchars(undefined)` throws, so the results list never renders. Chromium source confirms folders are returned, and the omnibox has the same flaw.
- **[C]** `neat.js:164` Tree titles are escaped at `:129` and again at `:114`, so apostrophes and ampersands show as entity text.

### MEDIUM

- **[C]** `neat.js:115` `javascript:` bookmarks get href `#`, and the click handler then navigates the active tab to the popup page.
- **[C]** `neat.js:1003` ArrowDown on the last search result throws a TypeError.
- **[C]** `neat.js:1539` Escape or a click outside saves the edit instead of cancelling it.
- **[C]** `options.js:280` Zoom is saved unvalidated, while the CSS exists only for 90 to 150 in steps of 10.
- **[C]** `neat.js:506` The edit-form submit never calls `preventDefault`, so the popup reloads.
- **[C]** `neat.js:1341` Drag auto-scroll uses a non-existent `scrollByLines`. It throws every 100 ms and triggers the error alert.
- **[P]** `background.js:129` The custom icon is restored only when the worker script runs, with no `onStartup` listener.
- **[P]** `options.js:329` The `dontLoad` guard is attached after an await, so the first icon upload is ignored.

### LOW

- Delete confirmation names the folder with "+" text (3).
- Zoom stale after Ctrl+0 (9).
- Folder toggle ignores `metaKey` (12).
- "+" on a collapsed loaded folder doesn't update the DOM (13).
- Body `contextmenu` prevents default on inputs (24).
- ArrowLeft on a search result can throw (S1).
- Literal "&times;" in options (S2).
- Moved row keeps stale `data-parentid` (8).
- One-shot `noOpenBookmark` flag (10).
- "+" focus falls back to the first folder (14).
- Keyboard Delete has no confirm or undo (15).
- Folder delete warning counts direct children only (16).
- `zoom(0)` resets zoom (19).
- `windows.create` without error handling (21).
- Editing a bookmarklet URL blanks it (22).
- `focusID` timer wipes newer focus (23).
- Omnibox double regex-escape (28).
- Collapsed children stay tabbable (31).
- Closed dialogs tabbable with stale handlers (S3).
- Native context menu also shows (S5).
- Enter in search may open a stale result (20).
- Reset doesn't await `clear` and its prompts are English-only (30).
- Settings saved per keystroke (33).
- Copy-pasted URL-list logic (35).
- Whole tree fetched at startup (34).
- **P:** `bookmarks.move` has no rejection handler (7).
- **P:** stale search responses (17).
- **P:** omnibox ignores disposition (29).
- **P:** drag coordinates versus zoom (32).
- **P:** undeclared `_id` in a latent branch (S4).
- **P:** popup height on stacked monitors (S6).

---

## sRedditHighlighter (1 HIGH, 5 MEDIUM, 16 LOW)

### HIGH

- **[P]** `manifest.json:22` The content script matches only thread URLs, and Chrome injects only on document loads. A client-side navigation from a feed to a thread never loads it. The code's own comment says Reddit uses `pushState`, but whether the feed-to-thread click is client-side needs a live check.

### MEDIUM

- **[C]** `src/content.js:260` `threadPersisted` is set on the first tab-hide and reset only in `init` and `teardown`. Later reading is never recorded, so the next baseline is stale.
- **[C]** `background.js:67` `saveThreadData` is a non-atomic read-modify-write of the whole map, so closing several tabs at once loses updates.
- **[C]** `src/content.js:190` The j/n/k/p handler ignores modifiers and shadow-DOM inputs, so Ctrl+P is hijacked.
- **[P]** `src/content.js:361` After SPA navigation `init` runs before the new comment tree mounts, so the observer may never attach.
- **[P]** `src/content.js:236` The observer is attached once to the current tree element. If the tree is absent or replaced it watches nothing.

### LOW

- Typed hex ignored on save (13).
- Focus index not remapped after re-sort (S1).
- No context-invalidated handling (8).
- System-theme versus auto-switch precedence (S3).
- Theme evaluated once, and an empty time gives NaN (15).
- Whole threads map rewritten per lookup (7).
- `CodexReview.md` is a sGesture review, misplaced here (S2).
- Permanent 500 ms poll (16).
- **P:** comments marked processed before their timestamp is readable (10).
- **P:** permalink views bump the baseline (S5).
- **P:** a failed GET is treated as a first visit (9).
- **P:** the `new.reddit.com` legacy-DOM claim (11).
- **P:** `confirm()` inside the embedded options page (12).
- **P:** colors interpolated into CSS unvalidated (14).
- **P:** `init` not guarded against concurrent teardown (18).
- **P:** whole-subtree scroll and outline on Shreddit (S4).

---

## sSummarizer (1 HIGH, 5 MEDIUM, 23 LOW)

The renderer and key handling held up. XSS probes on `javascript:` links and `<img onerror>` failed, and keys appear only in headers, never in logs or URLs.

### HIGH

- **[P]** `background.js:288` (also `options.js:235`) Anthropic requests omit `anthropic-dangerous-direct-browser-access`, which appears nowhere in the repo. Extension fetches carry an `Origin` header, so the API likely rejects them. One real call with a valid key would confirm.

### MEDIUM

- **[C]** `background.js:830` YouTube routing matches only `/watch`, so Shorts never reach the transcript extractor.
- **[C]** `background.js:807` Restricted pages (Web Store, `about:`, PDF) fail silently with no notice.
- **[C]** `scripts/content-scraper.js:364` (S6) With no transcript it silently summarizes title plus description only.
- **[P]** `background.js:27` A flat 30 s idle limit also covers time-to-first-byte, so reasoning models time out. This is a regression from #47.
- **[P]** `content.js:1288` Enter submits without an IME `isComposing` check, and ja and zh_CN locales ship.

### LOW

- Slash-command prefix auto-select (6).
- Each list item becomes its own `<ol>` (14).
- 5 locales miss 4 keys (19).
- English text overwrites localized options labels (S1).
- A paragraph swallows a following code fence (S2).
- Clearing a slash command deletes it immediately (S5).
- Empty completion reported as success (8).
- Gemini model id not URL-encoded (9).
- Anthropic `max_tokens` fixed at 4096 (10).
- No per-tab in-flight guard (12).
- Mid-stream "network error" misclassified (13).
- Short transcript discarded (16).
- Bare `fetch` matcher in `isNetworkError` (S4).
- Full HTML re-parsed every 50 ms (20).
- Slash commands saved per keystroke (21).
- GLM adapter copy-paste (22).
- Always-true ternaries (23).
- **P:** extraction errors sent as page content (7).
- **P:** "Summarize selection" skips the default slash command (11).
- **P:** a failed turn stays in history (15).
- **P:** Test Connection request shape wrong for Azure o-series (18) and GLM (S3).
- **P:** unreachable non-streaming fallbacks (17).

---

## sTabControl (3 HIGH, 5 MEDIUM, 14 LOW)

### HIGH

- **[C]** `background.js:146` (S1) `rebuildStateFromWindows` overwrites the restored `activeTabId` with the live active tab on every worker start. After 30 s idle, closing the active tab skips the custom activation (mock shows 0 `tabs.update` cold versus correct warm).
- **[C]** `background.js:196` Left and right placement queries the active tab after Chrome has activated the new foreground tab, so it uses the new tab as the reference.
- **[C]** `background.js:451` Duplicate prevention (opt-in, default off) fires on every top-frame commit, including link clicks and Back. In the default modes (teleport, close_new) it closes the tab the user is in.

### MEDIUM

- **[C]** `background.js:274` `activeTabIndex` goes stale, so after-close left or right activation picks the wrong neighbour.
- **[C]** `background.js:173` The internal-page check uses `tab.url`, which is empty on `onCreated`, so Ctrl+T is switched away from in background mode.
- **[C]** `options.js:138` The 300 ms debounced save is lost when the popup closes.
- **[P]** `background.js:174` Background mode may compare against an already-overwritten `activeTabId`.
- **[P]** `background.js:166` Placement rules also run on session-restored tabs and reverse their order.

### LOW

- PRIVACY.md says theme is stored in sync storage but the code uses local (13).
- README badge shows 1.0.0 with a placeholder banner (14).
- No pinned, audible or grouped exclusions in dedupe (6).
- Duplicate focus ignores background-opened duplicates (7).
- A self-removed duplicate stays in state (10).
- "Saved" toast ignores `lastError` (12).
- `handleStartupError` swallows errors (15).
- `handleTabAttached` indexes MRU order with a strip position (S2).
- `onCommitted` unfiltered before `waitForReady` (S3).
- English-only tooltip (S4).
- `windowState` re-serialised per event (16).
- `DEFAULT_SETTINGS` duplicated (17).
- **P:** `onReplaced` unhandled (8).
- **P:** `extDescription` over 132 characters in fr and es (S5).

---

## sUndoClose (0 HIGH, 6 MEDIUM, 20 LOW)

### MEDIUM

- **[C]** `options.js:140` Saving writes a stale in-memory `settings`, reverting a theme toggled since the page opened.
- **[C]** `options.js:154` `longPressDelay` is saved unvalidated, and an empty value makes every mousedown enter multi-select.
- **[P]** `popup.js:482` `cleanInvalidTabs` snapshots tabs outside the lock and drops just-closed tabs.
- **[P]** `bg.js:84` No incognito handling, so private tab URLs are persisted and shown in the normal popup.
- **[P]** `bg.js:323` At startup, persisted TabList entries are turned into closed tabs and tab ids can collide with live ones.
- **[P]** `popup.js:748` (S3) "New window" restores from a popup that the focus change can destroy mid-loop.

### LOW

- `pageNo` not clamped, leaving a blank page (4).
- "Open in new window" leaves an extra blank tab (8).
- Debounced `updateIcon` leaves promises hanging (10).
- README describes a different design (17).
- English-only labels (20).
- A click in multi-select resets the long-press (S1).
- `updateIcon` skipped when `saveHistory` is off (11).
- `regExistingTabs` is http(s)-only (13).
- Global keydown hijacks arrows in the search box (15).
- `multiReplace` index mismatch on accent-stripped text (16).
- Options defaults disagree with `bg.js` (18).
- All `ClosedTab-*` loaded on every close (21).
- `onUpdated` takes the lock per `changeInfo` (22).
- Duplicated restorable-URL regex (23).
- **P:** entry deleted before `tabs.create` is attempted (7).
- **P:** `updateIcon` uses `window` in the service worker (9).
- **P:** fresh install overwrites synced settings (12).
- **P:** navigating to a non-restorable URL leaves a stale entry (14).
- **P:** Clear differs between options and popup (19).
- **P:** the delete-"x" mousedown arms the long-press (S2).

---

## sYoutubeOrganizer (0 HIGH, 7 MEDIUM, 24 LOW)

### MEDIUM

- **[C]** `content/features/quick-add.js:325` `escapeHtml` leaves `"` unescaped but is used inside quoted `aria-label` attributes (also `subscriptions.js:782` and `:1127`). A playlist name, typed or imported, injects attributes.
- **[C]** `content.js:98` The 500 ms poll tears down and re-inits forever when `init` never succeeds, for example after the extension context is invalidated.
- **[C]** `content/pages/subscriptions.js:701` Hide Shorts and Hide Most Relevant match English headings only.
- **[P]** `content/pages/subscriptions.js:1448` The observer drops callbacks that land in its 500 ms cooldown without rescheduling them.
- **[P]** `content/core/helpers.js:22` Non-ASCII handles are percent-encoded and then rejected by `normalizeStoredHandle`.
- **[P]** `content/features/quick-add.js:590` (S1) The inline name input doesn't stop key propagation, so typing can fire YouTube hotkeys.
- **[P]** `content/pages/channels-list.js:268` (S2) The observer container is picked with an unscoped query.

### LOW

- Regression test is only a tripwire (2).
- Bridge message forgeable because it has no nonce (14).
- AGENTS.md drift (22).
- English-only UI (23).
- Closed-row render clears the shared outside-click listener (S3).
- `/watch` substring routing (S4).
- Import can't be aborted once a file is chosen (S8).
- Manual add overwrites the channel name with the handle (8).
- `onChanged` dropped while an editor is open (12).
- Export and import drops `subscribed` (13).
- Merge import overwrites `parentId` (S5).
- Toolbar action has no popup or handler (S6).
- Options writes storage directly, against an AGENTS.md rule (18, convention).
- Dead wrapper functions (21).
- `REGISTER_CHANNEL` resent per row (15).
- Whole-document observer on the channel page (16).
- Every mutation rewrites 4 keys and broadcasts (17).
- Normalization sits in a content module, against an AGENTS.md rule (19, convention).
- **P:** stale bell selectors remain in `SUBSCRIBED_SIGNAL_SELECTOR` after fix 29741bf (1).
- **P:** add-row blur race (S7).
- **P:** `withTimeout` doesn't cancel the mutation (9).
- **P:** non-idempotent messages retried (10).
- **P:** stale `subscribeBtn` (11).
- **P:** message-type prefix convention (20).

---

## Repo-level items

Checked directly by the orchestrator, not from the agents.

- `README.md` omits sYoutubeOrganizer. The folder name has 0 mentions.
- `sBookmarkCleaner/icons/` contains a stray `icon - Copy.svg` and `placeholder.txt`.
- sExport declares no icons.
- CI (`.github/workflows/ssummarizer.yml`) covers only sSummarizer. sYoutubeOrganizer's 45 tests are not run in CI.
- Every file referenced from the 9 manifests exists.

## Caveats

- Only sGesture-1 was reproduced in a real browser (Linux Chromium).
- The other browser-dependent claims come from code tracing, mock harnesses, or Chromium source.
- The two PLAUSIBLE HIGH findings (sSummarizer-1 and sRedditHighlighter-1) need one live check each.
- The full machine-readable list (all 249 findings with scenarios and verdicts) was written to the session scratchpad as `findings/merged.json`. It is not part of the repo.

---

## Top 15 findings, most severe first

Paths are relative to the repo root, and severity is tagged at the start of each summary.

### 1. `sGesture/mouseTrack.js:271` — HIGH

contextmenu is only suppressed once the gesture has moved/rocked, but on macOS/Linux the event fires on right mousedown, so the native menu opens at gesture start.

**Failure scenario:** Right mousedown on Linux/macOS fires contextmenu while state.moved is still false (reset at line 198), so it is not prevented; the menu opens and captures the mouseup and gestures cannot be completed (reproduced on Linux Chromium). Only Windows works.

### 2. `sNeatBookmarks/neat.js:359` — HIGH

Search results are not filtered to bookmarks: bookmarks.search also returns matching folders (no url) and generateBookmarkHTML calls Utils.htmlspecialchars(undefined), which throws.

**Failure scenario:** Searching a term that matches any folder title throws a TypeError inside .then, swallowed by .catch(console.error), so the results list never renders and the matching bookmarks are not shown. The omnibox handler (background.js:90) has the same shape.

### 3. `sBookmarkCleaner/background.js:53` — HIGH

Message handlers (ignore/recheck/pause/cancel/clear/resume/start) and bookmarks.onRemoved use scanState without awaiting stateReady, so after the service worker idles they run on the empty default state and persist it over the saved report.

**Failure scenario:** Report page open >30 s (service worker killed); user clicks Ignore or Recheck: the waking message runs before the async storage.get restore, ignoreBookmarks/pauseScan write the empty default scanState to storage and the saved scan report is lost.

### 4. `sTabControl/background.js:146` — HIGH

rebuildStateFromWindows (run on every service-worker start) overwrites the restored per-window activeTabId/activeTabIndex with the live active tab, which for the waking event already reflects the post-event state.

**Failure scenario:** After >30 s idle with default tabsActivate='last_used', Ctrl+W on the active tab wakes the worker; restore loads activeTabId=D, rebuild replaces it with Chrome's new active tab, handleTabRemoved sees wasActive=false (line 240) and skips the custom activation. The 'background' open-method revert is skipped on a cold onCreated too.

### 5. `sTabControl/background.js:196` — HIGH

'left'/'right' placement queries the active tab after Chrome has already activated a foreground new tab, so the reference tab is the new tab itself.

**Failure scenario:** With tabsBehaviour='left'/'right', Ctrl+T, the '+' button or a foreground target=_blank link: query({active:true}) returns the new tab, so 'left' is a no-op and 'right' is off by one or stays at the end; 'next to current tab' never applies.

### 6. `sTabControl/background.js:451` — HIGH

With duplicate prevention enabled (opt-in), de-duplication fires on every top-frame commit (link click, back/forward, redirect) in an existing tab, and the default modes close the tab the user is working in.

**Failure scenario:** Tab B shows search results; the user clicks a result whose URL is open in tab A: teleport/close_new removes tab B (with its history and form state) and jumps to A; Back in a tab to a URL open elsewhere does the same. Only reload and from_address_bar are exempt (lines 451-452).

### 7. `sNeatBookmarks/neat.js:164` — HIGH

Tree bookmark titles are HTML-escaped twice (neat.js:129, then generateBookmarkHTML at :114), so apostrophes, ampersands, quotes and angle brackets show as entity text.

**Failure scenario:** A bookmark titled "Tom's & Jerry <3" renders in the tree as "Tom&#39;s &amp; Jerry &lt;3"; folders, search results and post-edit rendering escape once and look correct.

### 8. `sSummarizer/background.js:288` — HIGH (plausible)

Anthropic requests never set the anthropic-dangerous-direct-browser-access header (also options.js:235 Test Connection), which api.anthropic.com requires for browser/extension-origin requests.

**Failure scenario:** User selects Anthropic and clicks the toolbar icon: the service-worker POST carries Origin chrome-extension://&lt;id&gt; and, if the API enforces its CORS rule, is rejected, making the Anthropic provider unusable. One real call with a valid key would confirm.

### 9. `sRedditHighlighter/manifest.json:22` — HIGH (plausible)

The content script only matches thread URLs and Chrome injects content scripts only on document loads, so a client-side (pushState) navigation from a feed/subreddit page to a thread on new Reddit never loads it.

**Failure scenario:** User opens www.reddit.com/r/foo and clicks a thread: if Reddit routes client-side there is no document load, content.js never runs and nothing is highlighted until a reload; the in-script SPA handling only helps when the script was already loaded.

### 10. `sBookmarkCleaner/report.js:233` — MEDIUM

selectedIds is never pruned when the list is re-rendered, so Delete/Recheck/Ignore act on rows that are no longer visible.

**Failure scenario:** Select 5 broken rows, then Clear Report or change the status filter: the table empties or filters but 'Delete Selected (5)' stays enabled; confirming permanently deletes 5 live bookmarks the user can no longer see, with no undo.

### 11. `sBookmarkCleaner/background.js:437` — MEDIUM

Every fetch failure (offline, TLS error, refused, blocked) is labelled 'DNS Error' with no connectivity check, so an offline scan marks every bookmark broken.

**Failure scenario:** Wi-Fi or VPN drops mid-scan: every remaining http(s) bookmark is added to the broken list and the scan completes normally with a valid timestamp; Select all + Delete then removes working bookmarks.

### 12. `sRedditHighlighter/src/content.js:260` — MEDIUM

threadPersisted is set on the first visibilitychange-hidden/pagehide and only reset in init()/teardown(), so later reading in the same page session is never recorded.

**Failure scenario:** User opens a thread, switches tabs for a second (lastVisit saved at T1), returns and reads new comments for an hour, then leaves: the persist is a no-op, so the next visit's baseline is T1 and already-read comments are highlighted as new again.

### 13. `sExport/popup.js:154` — MEDIUM

Export buckets tabs by groupId in first-appearance order, so ungrouped tabs that follow a tab group are merged into the earlier ungrouped bucket and the restored tab order differs from the original.

**Failure scenario:** Tabs A (ungrouped), [G: B, C], D (ungrouped) are written as GROUP -1 {A, D} then GROUP G {B, C}; restore opens A, D, B, C (reproduced).

### 14. `sYoutubeOrganizer/content/features/quick-add.js:325` — MEDIUM

api.escapeHtml (textContent -> innerHTML) does not escape double quotes but is used inside double-quoted aria-label attributes (also subscriptions.js:782 and :1127), so a playlist name can inject attributes.

**Failure scenario:** A playlist named `x" style="position:fixed;inset:0;z-index:2147483647` (typed, or arriving through an imported JSON file) injects arbitrary attributes into the shadow-DOM markup on youtube.com; even a benign name like `My "best" list` breaks the attribute.

### 15. `sGesture/mouseTrack.js:171` — MEDIUM

lmousedown is set on mousedown and cleared only on mouseup; native drag-and-drop swallows mouseup and there is no dragend/blur/buttons reset, so the flag sticks.

**Failure scenario:** After dragging a link or image, right-button gestures are ignored (mousemove requires !lmousedown) until the next left click; with rocker enabled a plain right-click then fires the L->R rocker action (e.g. Forward).
