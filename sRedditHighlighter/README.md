![Project Banner](path/to/image.png)
<!-- Replace with actual banner if available -->

![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)
![Language: JavaScript](https://img.shields.io/badge/Language-JavaScript-F7DF1E.svg)
![Version: 4.0.0](https://img.shields.io/badge/Version-4.0.0-green.svg)

Reddit New Comments Highlighter automatically tracks and highlights any new comments added to a thread since your last visit. It works seamlessly across old Reddit, new Reddit, and the standard redesign.

## Key Features

*   **Smart Highlighting**: Instantly see which comments are new when you return to a discussion.
*   **Broad Compatibility**: Full support for old.reddit.com, new.reddit.com, and the main site.
*   **Automatic Tracking**: Remembers your last visit time for every thread you open.
*   **Clean Integration**: Highlights blend perfectly with the Reddit UI for a natural reading experience.
*   **Persistent Storage**: Uses browser storage to keep your visit history synced across sessions.

## Quick Start

### Install from Chrome Web Store
1. Visit the [Chrome Web Store](https://chrome.google.com/webstore) (Coming Soon).
2. Click **Add to Chrome**.

### Manual Installation
1. Download this repository as a ZIP and extract it.
2. Open Chrome and go to `chrome://extensions/`.
3. Enable **Developer mode**.
4. Click **Load unpacked** and select the extension folder.

## Overview

This extension is built with Manifest V3 and uses content scripts to dynamically inject highlighting logic into Reddit pages. It stores thread metadata locally using the `chrome.storage` API, ensuring that your data never leaves your device and your privacy is protected.

## FAQ

**Q: Does this work on the "Redesign" of Reddit?**
A: Yes, it is designed to work on both the original old Reddit and the newer redesign layouts.

**Q: Can I change the highlight color?**
A: You can check the extension options to see available customization settings for the UI.

**Q: Does it highlight my own new comments?**
A: It highlights any comments that appear after your previous recorded visit time for that specific thread.

**Q: Will it slow down Reddit?**
A: No, the script only runs when you open a comment thread and finishes its work in milliseconds.

**Q: Does it share my Reddit activity?**
A: No. All thread visit data is stored locally in your browser and is never uploaded to any servers.

## License

MIT License
