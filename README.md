# sBookmarkCleaner

![Project Banner](icons/icon128.png)
<!-- Replace with actual banner if available -->

![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)
![Language: JavaScript](https://img.shields.io/badge/Language-JavaScript-F7DF1E.svg)
![Version: 1.0.0](https://img.shields.io/badge/Version-1.0.0-blue.svg)

🌍 **Supported Languages:** English, Spanish, French, Japanese, Portuguese (Brazil), Chinese (Simplified)

sBookmarkCleaner is a comprehensive Chrome extension designed to keep your bookmark collection organized and healthy. It streamlines the process of finding broken links, removing duplicates, and sorting your bookmarks for a better browsing experience.

## Key Features

*   **Find Broken Links**: Scan your bookmarks to identify links that are no longer active, with customizable timeout settings.
*   **Identify Duplicates**: Easily find and manage duplicate bookmark entries to declutter your folders.
*   **Sort Bookmarks**: Organize your bookmarks alphabetically, with options for parent-only or recursive sorting across all folders.
*   **Detailed Scan Reports**: View comprehensive reports for broken and duplicate items, allowing you to delete, ignore, or recheck them.
*   **Dark/Light Themes**: Customizable appearance with built-in theme support to match your system preferences.

## Quick Start

1.  **Download/Clone** this repository to your local machine.
2.  Open Chrome and navigate to `chrome://extensions/`.
3.  Enable **Developer mode** using the toggle in the top right corner.
4.  Click **Load unpacked** and select the `sBookmarkCleaner` directory.
5.  Click the extension icon in your toolbar to start cleaning!

## Usage

### Find Broken Links
1. Click **Find Broken Links** in the popup.
2. The extension will check each bookmark's status.
3. Once complete, view the **Scan Report** to manage broken entries.

### Find Duplicates
1. Click **Find Duplicates** in the popup.
2. The extension identifies bookmarks with identical URLs.
3. Review the duplicates in the report and select which ones to remove.

### Sort Bookmarks
1. Click **Sort Bookmarks** to instantly organize your collection.
2. Configure sorting preferences (Parent-only vs. Recursive) in the **Options** page.

## Configuration

Access the **Settings** (Options page) by right-clicking the extension icon and selecting "Options" to customize:
*   **Theme**: Toggle between Light and Dark modes.
*   **Connection Timeout**: Set how long the scanner waits for a website to respond (default: 5s).
*   **Auto-Sort**: Automatically sort bookmarks before every scan.
*   **Sort Scope**: Choose between sorting only parent folders or a full recursive sort of all contents.

## Permissions Explanation

This extension requires the following permissions to function correctly:
*   `bookmarks`: To read, sort, and remove bookmarks from your collection.
*   `tabs`: To open scan reports and recheck links in new tabs.
*   `storage`: To save your settings, scan results, and preferences.
*   `alarms`: To handle background tasks during long scans.
*   `<all_urls>` (Host Permission): Required to check the HTTP status of your bookmarked links to determine if they are broken.

## Overview

sBookmarkCleaner is built using Chrome Extension Manifest V3, ensuring modern security and performance standards. The technical stack includes:
*   **Core**: JavaScript (Service Workers for background scanning)
*   **UI**: HTML5, CSS3 (Custom styles with theme support)
*   **i18n**: Internationalization support for multiple languages.

## FAQ

**Q: Does the extension automatically delete my bookmarks?**
A: No. sBookmarkCleaner identifies issues and presents them in a report. You have full control over which bookmarks to delete or keep.

**Q: Why does the broken link scan take a long time?**
A: The scan speed depends on the number of bookmarks and the timeout setting. You can lower the timeout in Settings to speed it up, though this may increase false positives for slow sites.

**Q: Can I restore a bookmark after deleting it?**
A: Standard Chrome bookmark deletion is permanent. We recommend exporting a backup of your bookmarks before performing a major cleanup.

**Q: What is the "Recursive" sorting option?**
A: "Parent Folders Only" sorts just the top-level folders. "Recursive" sorts every folder and every individual bookmark inside them alphabetically.

**Q: Is my data sent to any server?**
A: No. All scanning and processing happen locally on your machine. The extension only makes standard HTTP requests to check if your bookmarked URLs are still active.

## Credits

This project is part of the "s" extension series, focusing on lightweight and efficient utility tools for Chrome users.

## License

MIT License

