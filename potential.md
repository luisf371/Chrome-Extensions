# Potential Features for sTabControl (Manifest V3)

## 1. Smart Prevent Duplicate Tabs
**Description:** Detects if a URL is already open in the current window. If found, it focuses the existing tab and closes the newly opened one. Crucially, it distinguishes between a user clicking a link (deduplicate) and explicitly selecting "Duplicate Tab" from the context menu (allow).

**Implementation Plan:**
1.  **Permissions:** Add `"webNavigation"` to `manifest.json` (required to detect transition types).
2.  **Settings:**
    *   Add a checkbox in `options.html`: "Prevent duplicate tabs".
    *   Add a sub-option or tooltip explaining that "Duplicate Tab" actions are still allowed.
3.  **Background Logic (`background.js`):**
    *   Listen to `chrome.webNavigation.onCommitted`.
    *   Check if the committed URL exists in another tab within the same `windowId`.
    *   **Smart Check:** Verify `transitionQualifiers` or `transitionType`.
        *   If `transitionType` is `"reload"` (often used by Chrome for "Duplicate"), allow the new tab.
        *   Otherwise (e.g., `"link"`, `"typed"`), focus the *existing* tab and remove the *new* tab.

## 2. Auto-Group Tabs by Domain
**Description:** Automatically organizes new tabs into Chrome Tab Groups based on their domain (e.g., all "github.com" tabs in a "GitHub" group).

**Implementation Plan:**
1.  **Permissions:** Add `"tabGroups"` to `manifest.json`.
2.  **Settings:** Add a toggle in `options.html`: "Auto-group tabs by domain".
3.  **Background Logic (`background.js`):**
    *   Listen to `chrome.tabs.onUpdated` (wait for status: 'complete').
    *   Extract the hostname from the tab's URL.
    *   Use `chrome.tabGroups.query` to see if a group with that title (or associated tabs) exists.
    *   If yes, add the tab to that group. If no, create a new group with the hostname as the title.

## 3. Close Tabs to Left/Right
**Description:** Adds context menu options to close all tabs situated to the left or right of the current tab.

**Implementation Plan:**
1.  **Permissions:** Add `"contextMenus"` to `manifest.json`.
2.  **Background Logic (`background.js`):**
    *   Call `chrome.contextMenus.create` on startup for "Close tabs to the Left" and "Close tabs to the Right".
    *   On click:
        *   Get the current tab's `index` and `windowId`.
        *   `chrome.tabs.query({ currentWindow: true })`.
        *   Filter tabs where `index < currentTabIndex` (for Left) or `index > currentTabIndex` (for Right).
        *   Pass the IDs of the filtered tabs to `chrome.tabs.remove()`.

## 4. Custom Auto-Discard (Memory Saver)
**Description:** Automatically suspends tabs that have been inactive for a specific custom duration (e.g., 10 minutes), offering more granular control than Chrome's native Memory Saver.

**Implementation Plan:**
1.  **Permissions:** Add `"alarms"` to `manifest.json`.
2.  **Settings:** Add input in `options.html` for "Discard after X minutes".
3.  **Background Logic (`background.js`):**
    *   Create a recurring alarm (e.g., every 1 minute).
    *   In the alarm handler, iterate through all tabs.
    *   Compare `Date.now()` with the tab's `lastAccessed` property.
    *   If the difference exceeds the user's setting, call `chrome.tabs.discard(tabId)`.
