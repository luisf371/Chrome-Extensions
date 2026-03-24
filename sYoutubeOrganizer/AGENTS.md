# sYoutubePlaylist Init

## Project Snapshot

`sYoutubePlaylist` is a Manifest V3 Chrome extension that lets users organize YouTube subscriptions into custom playlists. It adds playlist-aware UI directly inside YouTube, filters the subscriptions feed, supports quick-add from video/channel surfaces, and exposes an options page for playlist management, import/export, and a few subscriptions-page preferences.

This repo loads directly from source:

- no bundler
- no framework
- no build step
- mostly plain JavaScript plus Chrome extension APIs

The practical consequence is that most changes are easy to load and test, but browser behavior and live YouTube DOM changes matter more than in a bundled app.

## Quick Commands

```bash
npm test
node --check background.js
node --check content.js
node --check options.js
node --check content/pages/subscriptions.js
```

Manual verification flow:

1. Reload the unpacked extension in `chrome://extensions/`
2. Refresh YouTube
3. Validate the affected page type directly
4. If selectors or timing changed, inspect the live DOM before broadening queries

Primary manual surfaces:

- `/feed/subscriptions`
- `/feed/channels`
- `/watch`
- `/@handle`
- `/channel/<id>`
- the extension options page

## Repo Layout

### Runtime entrypoints

- `manifest.json`
  MV3 wiring, permissions, content-script order, locales, icons, and options page.

- `background.js`
  Service worker and the single write authority for persistent state. All storage mutations should end up here.

- `shared-core.js`
  Shared home for normalization, validation, parsing, and pure mutation helpers. This is the canonical place for data rules.

- `content.js`
  Thin content-script router. It identifies the current YouTube page, cleans up old page behavior, and delegates to the page-specific module.

- `options.html`, `options.css`, `options.js`
  The extension’s management surface for playlists, channel assignments, import/export, and user settings.

### Content-script split

- `content/bridge/page-bridge.js`
  MAIN-world script injected at `document_start`. It exists because YouTube is a SPA and some navigation signals are only reliably observable from the page world.

- `content/core/state.js`
  Shared mutable tab/session state on `globalThis.__SYP_CONTENT__`. Holds active page, observer refs, timers, UI refs, quick-add state, filter state, and derived lookup maps.

- `content/core/helpers.js`
  DOM utilities, wait/retry helpers, visibility checks, HTML escaping, URL parsing, and document close-listener lifecycle helpers.

- `content/core/runtime.js`
  Background messaging, fresh data loading, lookup-map rebuilds, page toast/error handling, and bounded retry behavior.

- `content/features/quick-add.js`
  Shared quick-add UI for channel/video-like surfaces. Owns Shadow DOM rendering, dropdown listeners, inline playlist creation, and state refresh behavior.

- `content/pages/subscriptions.js`
  Playlist filter bar, include/exclude mode logic, section hiding, preference restoration, and feed observation for the subscriptions surface.

- `content/pages/channels-list.js`
  Per-channel quick-add buttons for `/feed/channels`, including lazy-load handling and re-rendering after data changes.

- `content/pages/channel.js`
  Channel-page quick-add mounting and header-surface observation.

- `content/pages/video.js`
  Watch-page quick-add mounting near the current owner/subscribe surface.

### Support and reference files

- `test/shared-core.test.js`
  Current automated coverage for pure shared logic.

- `_locales/`
  Extension strings and translated metadata.

- `icons/`
  Chrome action/store icons.

- `memory.md`
  Running log of important decisions, debugging outcomes, DOM findings, and gotchas. Read this before making risky changes.

- `INIT.md`
  Broader architectural onboarding doc.

- `AGENTS.md`
  Concise contributor guide.

## Architecture Mental Model

Think in four layers:

1. `manifest.json` wires the extension together.
2. `background.js` owns durable writes and message handling.
3. `content/` adapts persistent state to YouTube’s live DOM.
4. `options.*` manages playlists/settings outside YouTube.

If you are unsure where a change belongs, decide whether it is:

- a data rule
- a storage mutation
- a YouTube page behavior
- an options-page behavior

That usually tells you the right file family immediately.

## Data Flow

The important rule is simple: `background.js` owns writes.

- content scripts do not write directly to `chrome.storage.local`
- options UI does not write directly to `chrome.storage.local`
- both send runtime messages and let the background service worker perform validation + mutation

`shared-core.js` exists so the background worker and options page agree on the same rules for:

- playlist IDs
- channel handle/channel ID normalization
- imported data shape
- settings defaults
- mutation behavior

The content side loads fresh state through `content/core/runtime.js`, rebuilds lookup maps after refresh, and keeps tab-local UI state separate from persistent storage.

## Storage Model

Persistent storage is centered on:

```js
{
  playlists: {
    [id]: { id, name, color, order, createdAt }
  },
  channels: {
    [handle]: { channelId, name, lastRegistered }
  },
  channelPlaylists: {
    [handle]: [playlistId, ...]
  },
  settings: {
    theme,
    subscriptionsFilterPreference,
    hideShorts,
    hideMostRelevant
  }
}
```

Key assumptions:

- the model is intentionally flat
- channel identity is normalized before storage
- playlist/channel relationship ownership lives in `channelPlaylists`
- subscriptions filter preference is stored under `settings`, not export/import payloads

Transient tab state lives in `content/core/state.js` and tracks:

- active page
- init generation / init success state
- observers and debounce timers
- quick-add host/shadow/dropdown state
- subscriptions filter mode and selected playlist
- lookup maps derived from the latest background data

## Content-Script Lifecycle

This repo is especially sensitive to YouTube SPA timing.

The expected lifecycle is:

1. `page-bridge.js` observes YouTube navigation signals in MAIN world
2. bridge relays a marked navigation event
3. `content.js` validates the event, debounces it, and increments `initGeneration`
4. current page cleanup runs first
5. router picks a page module based on URL
6. page module waits for the right visible DOM surface and fresh data
7. module injects or refreshes UI

Important established patterns:

- `initGeneration` exists to cancel stale async init work
- `initSucceeded` helps retry when DOM timing or service-worker wake timing caused an earlier failure
- cleanup must clear observers and pending debounce timers, not just remove DOM
- page-scoped selectors are safer than broad `document.querySelector(...)` calls because YouTube often leaves hidden or stale shells in the DOM during SPA transitions

Known debounce timings in the current codebase:

- SPA navigation: `80ms`
- subscriptions feed observer: `100ms`
- channel list observer: `200ms`
- quick-add refresh: `150ms`

## Current YouTube DOM Assumptions

These are current working assumptions from recent live verification and are worth preserving until proven stale.

### Channel pages

- modern channel pages use the newer `yt-page-header-view-model` stack
- the quick-add anchor is `yt-flexible-actions-view-model`
- the channel name is available via `yt-page-header-view-model h1`
- the visible handle may not exist as an `a[href*="/@"]` link in the header, so URL fallback matters

### Watch pages

- relevant surface is `#top-row #owner`
- handle link is typically under `#owner a[href="/@handle"]`
- subscribe button lives inside `#subscribe-button`

### Subscriptions pages

- YouTube may render multiple sections like `Most relevant` and `Latest`
- mount logic should prefer the active subscriptions surface, not any random visible grid elsewhere
- section heading matching should be tolerant of text variation like `Latest videos`

### Channels list page

- `/feed/channels` needs a route check before generic channel-page matching
- handle extraction must support both `/@handle` and `/channel/<id>` links

## Working Rules and Conventions

Use these as practical repo conventions:

- CSS classes use the `syp-` prefix
- message/event constants use the `SYP_` prefix
- shared content state lives on `globalThis.__SYP_CONTENT__`
- prefer `const`/`let`, semicolons, and small focused helpers
- keep page-specific DOM behavior inside `content/pages/*.js`
- keep reusable injected UI in `content/features/`
- keep data validation/normalization in `shared-core.js`

Two especially important habits:

- prefer DOM APIs over interpolating user/imported values into `innerHTML`
- prefer scoped selectors over broad fallbacks when targeting YouTube

## Best Starting Points

- change playlist/import/settings rules:
  `shared-core.js` -> `background.js` -> `options.js`

- fix YouTube injection bug:
  matching `content/pages/<page>.js` -> `content/features/quick-add.js`

- fix routing/init/cleanup:
  `content.js` + `content/core/state.js`

- fix data refresh/runtime messaging:
  `content/core/runtime.js` + `background.js`

- fix options-page rendering or manual add:
  `options.js` + `shared-core.js`

## Testing Reality

`npm test` currently validates shared-core logic only. It is useful, but it does not prove:

- live YouTube selector correctness
- SPA timing behavior
- Chrome MV3 service-worker wake/retry behavior
- Shadow DOM insertion on real YouTube surfaces

That means confidence usually comes from a mix of:

- `npm test`
- `node --check ...` syntax checks
- manual extension reloads
- manual page verification on the exact affected YouTube surfaces
- targeted DOM inspection when YouTube layout changes

When changing pure logic, add or update `test/shared-core.test.js`.
When changing page injection code, prioritize manual verification over assuming old selectors still hold.

## Known Risk Areas

These are the parts most likely to regress:

- YouTube selectors and mount targets in `content/pages/*`
- navigation timing between `page-bridge.js` and `content.js`
- observer cleanup during fast SPA transitions
- storage mutation ordering in `background.js`
- import validation and DOM-safe rendering
- cross-tab refresh behavior for quick-add badges and assignments

## Security and Hardening Notes

- `page-bridge.js` is a trust boundary; navigation relays must remain source-marked and URL-validated.
- Runtime message failures should not silently disappear without a bounded retry/error path.
- Imported data should be normalized and rejected centrally in `shared-core.js` / `background.js`.
- Avoid rendering imported or user-controlled identifiers through raw `innerHTML`.
- Keep write-queue logic narrow: protect the storage read/write section without bloating it with unrelated side effects.

## Practical Summary

If you need the shortest reliable mental model:

`background.js` is the durable source of truth, `shared-core.js` defines the rules for that state, `content/` maps those rules onto YouTube’s changing DOM, and `options.js` is the admin surface users interact with outside YouTube.