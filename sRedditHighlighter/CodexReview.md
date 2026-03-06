# Title + Context
- **Title:** sGesture static review
- **Repo:** `D:\Chrome Extensions\sGesture`
- **Branch/Commit:** not provided (state of workspace as of February 22, 2026)
- **Review Date:** February 22, 2026

## Executive Summary
- Security severity count: 1 High, 0 Medium, 0 Low.
- Synthetic gestures can be spoofed via script-dispatched mouse events because the content script and service worker never check `event.isTrusted`; this lets malicious pages close/reload tabs without user interaction (see F1).
- The extension injects `mouseTrack.js` into every host and frame (`manifest.json` lines 10-21), enlarging the attack surface and touching sensitive pages even when the gesture UI is not needed (see F2).
- Background command handlers still list unused responses such as `colorCode`, `width`, `gests`, `rocker`, `trail`, and `ping`, adding maintenance burden for no payoff (see F3).
- The options page doubles as the popup/toolbar UI but there are no automated tests or CI configured, so changes to `options.js` or `mouseTrack.js` are only validated in manual sessions.
- All persistent state lives in `chrome.storage.local` without schema validation or migration guards; corrupted or unexpected values flow from options into the gesture logic unhindered.
- Increasing test coverage (uniting the gesture parser, storage sync, and background commands) would raise confidence before releasing updates.

## Scorecard
| Area | Rating | Notes |
| --- | --- | --- |
| Security | C | High-risk tab-management commands (`background.js:1-136`) can be triggered by synthetic gestures because the handler never validates `event.isTrusted`; see F1. |
| Reliability | B | Canvas drawing and gesture listeners run on every frame via `<all_urls>`/`all_frames`, which can break or slow sensitive pages; see F2. |
| Maintainability | B | The service worker defines unused commands (`colorCode`, `width`, `gests`, `rocker`, `trail`, `ping`); trimming them cleans the code base; see F3. |
| Testing | F | No automated tests or CI artifacts in the repo. |
| Dependencies | A | No third-party libraries or node/npm dependencies. |
| DevOps | D | No CI/CD or release automation is present. |

## Findings Index
| ID | Severity | Category | Title | Area | Files | Confidence | Status |
| --- | --- | --- | --- | --- | --- | --- | --- |
| F1 | High | Security | Synthetic gestures can be spoofed to close/reload tabs | Gesture listener + background commands | `mouseTrack.js:60-239`, `background.js:1-136` | High | New |
| F2 | Medium | Security | `<all_urls>` + `all_frames` injects the gesture script everywhere | Manifest + content script | `manifest.json:7-35`, `mouseTrack.js:27-235` | Medium | New |
| F3 | Low | Maintainability | Unused background command handlers inflate service worker surface | Background service worker | `background.js:1-117`, `mouseTrack.js:88-106` | High | New |

## Detailed Findings
### F1 – Synthetic gestures can be spoofed by scriptable events
- **What:** The extension executes destructive tab-management commands (new tab, close tabs, reload, etc.) whenever the gesture parser sends a `sendChromeMessage`. The parser relies solely on low-level mouse events to decide which command to send.
- **Where:** `mouseTrack.js` registers `mousedown`, `mousemove`, `mouseup`, and `contextmenu` handlers with no `event.isTrusted` gating (`mouseTrack.js:157-250`), and the background service worker immediately executes whichever `commands[request.msg]` matches, including `closeall`, `reloadall`, and `closetab` (`background.js:1-136`).
- **Why:** Because `event.isTrusted` is never tested, a visited page can synthetically dispatch the same mouse events that the gesture parser listens for. The synthetic sequence replicates the right-button movement that triggers `exeFunc`, which then calls `sendChromeMessage` and fires the tab-management command.
- **How to reproduce:** On any site, run a script such as `document.dispatchEvent(new MouseEvent('mousedown', { button: 2, clientX: 100, clientY: 100 })); document.dispatchEvent(new MouseEvent('mousemove', { button: 2, clientX: 200, clientY: 100 })); document.dispatchEvent(new MouseEvent('mouseup', { button: 2 }));` (maybe add repeated `mousemove` events to generate a gesture). Because the listeners do not check `isTrusted`, the extension treats these as valid gestures and the service worker closes/reloads tabs via `sendChromeMessage`.
- **Recommended fix:** Ignore events where `event.isTrusted` is `false` before mutating `state` or calling `exeFunc`. Consider adding a confirmation, rate limit, or user gesture check before running destructive commands via `chrome.tabs.remove`/`reload`.
- **Fix complexity:** Medium – just add boolean guards to the event listeners, but ensure synthetic-event detection does not break legitimate developer tools interactions.
- **Risk of change:** Low – the fix only rejects non-user-generated events; real gestures are still processed.
- **Suggested tests:** Automate a test that dispatches synthetic mouse events and asserts that `sendChromeMessage` is not called (mock the messaging layer). Add a regression test that verifies trusted events still trigger gestures.

### F2 – `<all_urls>` + `all_frames` injects the gesture script everywhere
- **What:** The manifest grants both `host_permissions` and a content script match of `<all_urls>` with `all_frames: true` (`manifest.json:10-21`), so `mouseTrack.js` runs even inside cross-origin iframes and privileged pages.
- **Where:** `manifest.json:10-21` and `mouseTrack.js:27-235`.
- **Why:** This broad injection is unnecessary for the gesture UI and increases exposure: the script now touches every iframe, including sensitive contexts where `document.body` might be restricted. A future malicious iframe can exploit F1 to trigger commands on behalf of the user.
- **How to reproduce:** Install the extension and visit a page with an embedded cross-origin iframe (e.g., `https://example.com` containing a `https://mozilla.org` iframe); open DevTools and observe that the gesture canvas is injected inside every frame because of `all_frames: true`.
- **Recommended fix:** Narrow the `matches` patterns to only the contexts you actually expect users to gesture in (for example `https://*/*` and `http://*/*`) and remove `all_frames` if gestures are only needed in the top-level frame. Consider moving to optional host permissions (`permissions` set to `storage, tabs, sessions` with host access invoked via `chrome.permissions.request` when the user enables the extension on a site).
- **Fix complexity:** Medium – manifests need updating and you must ensure the remaining frames still cover intended workflows.
- **Risk of change:** Low to moderate – restricts the extension’s ability to inject in weird frames but keeps functionality on the top frame.
- **Suggested tests:** Manually verify the gesture UI still works on the core paths post-change; add an automated smoke test that asserts the content script is not injected on restricted hosts.

### F3 – Unused background command handlers inflate the surface area
- **What:** The `commands` object in `background.js` defines `colorCode`, `width`, `gests`, `rocker`, `trail`, and `ping` handlers (`background.js:14-117`), but no other code ever calls `sendChromeMessage` with those identifiers.
- **Where:** `background.js:14-117` and the actual `sendChromeMessage` call sites in `mouseTrack.js:87-106` show that only `newtab`, `closetab`, `lasttab`, `reloadall`, `closeall`, `nexttab`, `prevtab`, and `closeback` are used.
- **Why:** Dead code increases maintenance cost and expands the attack surface (each handler is another entry point that must be reasoned about). It also confuses reviewers about whether the extension should expose those commands.
- **How to reproduce:** Search for string literals such as `"colorCode"` or `"gid"` in the repository—only `background.js` contains them, there are no `sendChromeMessage("colorCode")` call sites, so the handler can never run.
- **Recommended fix:** Remove unused handlers from the `commands` map, or add the corresponding UI/code paths if the functionality is still required. Keep the service worker focused on the commands that are actually invoiced by the gesture parser.
- **Fix complexity:** Low.
- **Risk of change:** Low; removing unused methods won’t affect runtime behavior.
- **Suggested tests:** None required beyond ensuring there are no references left; a lint rule (unused function detection) would catch the regression.

## Deprecated/Outdated Patterns
- `options_page` is used instead of the newer `options_ui` entry (`manifest.json:18-35`); migrating will provide auto-open/`open_in_tab` control and better future compatibility.
- Using `default_popup` that reuses `options.html` and `options.js` keeps configuration and the popup tightly coupled, which makes the UI harder to evolve independently.

## Dead Code and Cleanup Opportunities
| Opportunity | Description | Evidence |
| --- | --- | --- |
| Background command handlers (`colorCode`, `width`, `gests`, `rocker`, `trail`, `ping`) | These handlers are never invoked; only `newtab`, `closetab`, `lasttab`, `reloadall`, `closeall`, `nexttab`, `prevtab`, and `closeback` are sent from the gesture parser. | Definitions: `background.js:14-117`; actual calls: `mouseTrack.js:87-106`. Removing them trims the service worker footprint. |

## Security Posture Notes
- **Auth/Authz:** Background commands execute regardless of `sender` or user context; the only guard is the gesture parser (no trust model) so an attacker who can animate the page can trigger them.
- **Secrets:** No sensitive secrets are stored, and only `chrome.storage.local` is used for user options.
- **Input validation:** The gesture listeners never check `event.isTrusted`, which allows synthetic events to masquerade as user gestures; `sessions[0].tab.url` is re-opened without sanitizing schemes beyond what Chrome already blocks.
- **Dependency/supply chain:** There are no third-party dependencies; the repo ships only its own JS/CSS/manifest assets.

## Most Critical to Fix
- Address F1 first: add `event.isTrusted` checks (or another authenticity barrier) before translating mouse activity into background commands so a visited page cannot close or reload the user’s tabs without an explicit, trusted gesture.

## Next Steps
1. **7-day:** Harden the gesture listeners (`mouseTrack.js:157-239`) by rejecting untrusted events and add telemetry/logging around rejected gestures so regressions can be spotted during manual QA.
2. **14-day:** Narrow the content-script matches and host permissions (`manifest.json:10-21`) to the contexts where gestures are needed; document the optional permission flow in README/CHANGELOG so reviewers know why hosts were restricted.
3. **30-day:** Introduce lightweight automated checks (unit tests or linting for the gesture parser and options storage) and add a CI workflow so regressions to `options.js`/`mouseTrack.js` are caught before release.
