![Project Banner](path/to/image.png)
<!-- Replace with actual banner if available -->

![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)
![Language: JavaScript](https://img.shields.io/badge/Language-JavaScript-F7DF1E.svg)
![Version: 1.0.0](https://img.shields.io/badge/Version-1.0.0-green.svg)

🌍 **Supported Languages:** English, Spanish, French, Japanese, Portuguese (Brazil), Chinese (Simplified)

sTabControl gives you total mastery over how your browser handles new and closed tabs. It prevents annoying duplicate tabs and lets you decide exactly where every new tab should appear.

## Key Features

*   **Duplicate Prevention**: Automatically detects if you already have a site open and "teleports" you back to the old tab.
*   **Custom Positioning**: Force new tabs to always open at the start, end, or right next to your current tab.
*   **Focus Control**: Choose which tab gets focused after you close one (like going back to the last used tab).
*   **Background Loading**: Fine-tune whether new tabs should open in the foreground or stay in the background.
*   **Simple & Fast**: A lightweight engine that works in the background without any complicated menus.

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

This extension utilizes the `chrome.tabs` and `chrome.storage` APIs within a Manifest V3 framework. It monitors tab creation and removal to apply your custom logic instantly, ensuring a more predictable and organized browsing experience.

## FAQ

**Q: What does the 's' in the name mean?**
A: It stands for simple and lightweight application with no bloat, tracking, or ads.

**Q: What is "Teleporting" a duplicate tab?**
A: Instead of opening a second copy of a website, the extension will find your existing tab, move it to your new position, and focus it.

**Q: Can I still force a duplicate if I need one?**
A: Yes, the "Duplicate Tab" action in Chrome is still allowed, so you only block unwanted duplicates from links.

**Q: Does it work with tab groups?**
A: It works alongside tab groups, helping you manage where those tabs land within your existing layout.

**Q: Will it slow down my browser?**
A: No, it is designed with performance in mind and only runs tiny bits of code when you open or close a tab.

## License

MIT License
