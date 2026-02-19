![Project Banner](path/to/image.png)
<!-- Replace with actual banner if available -->

![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)
![Language: JavaScript](https://img.shields.io/badge/Language-JavaScript-F7DF1E.svg)
![Version: 1.0.0](https://img.shields.io/badge/Version-1.0.0-blue.svg)

🌍 **Supported Languages:** English, Spanish, French, Japanese, Portuguese (Brazil), Chinese (Simplified)

sBookmarkCleaner is a fast and simple tool to keep your browser bookmarks healthy and organized. It quickly finds broken links, removes duplicates, and sorts everything alphabetically to save you time.

## Key Features

*   **Broken Link Finder**: Scans all your bookmarks to catch dead or inactive links.
*   **Duplicate Detection**: Finds identical URLs across different folders for easy cleanup.
*   **Smart Sorting**: Organizes your bookmarks alphabetically with optional recursive sorting.
*   **Scan Reports**: Detailed overview of all issues found with easy management options.
*   **Themed UI**: Includes both Light and Dark modes to match your system look.

## Quick Start

### Install from Chrome Web Store
1. Visit the [Chrome Web Store](https://chrome.google.com/webstore) (Coming Soon).
2. Click **Add to Chrome**.

### Manual Installation
1. Download this repository as a ZIP file and extract it.
2. Open Chrome and go to `chrome://extensions/`.
3. Turn on **Developer mode** in the top right.
4. Click **Load unpacked** and select the extension folder.

## Overview

This extension is built on Manifest V3 for better security and performance. It uses a background Service Worker to handle scanning tasks without slowing down your browser. All data remains private on your device, and settings are synced using Chrome's storage API.

## FAQ

**Q: What does the 's' in the name mean?**
A: It stands for simple and lightweight application with no bloat, tracking, or ads.

**Q: Will it delete bookmarks without asking?**
A: No, it only shows you what is broken or duplicated so you can choose what to remove.

**Q: Can I change how fast it scans?**
A: Yes, you can adjust the connection timeout in the settings page to speed up or slow down the process.

**Q: Is it safe for my privacy?**
A: Totally. The extension works entirely on your computer and never sends your bookmarks to any external server.

**Q: Does it sort folders too?**
A: Yes, it can sort both individual bookmarks and the folders themselves depending on your settings.

## License

MIT License
