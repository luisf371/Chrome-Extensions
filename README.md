# sNeater Bookmarks

![sNeater Bookmarks Icon](icon128.png)

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
![Language: JavaScript](https://img.shields.io/badge/Language-JavaScript-F7DF1E.svg)
![Version: 0.9.7.1](https://img.shields.io/badge/Version-0.9.7.1-blue.svg)

🌍 **Supported Languages:** English, Spanish, French, Japanese, Portuguese (Brazil), Chinese (Simplified)

sNeater Bookmarks is a streamlined and highly customizable bookmark manager for Chrome that provides a clean tree-view popup for efficient navigation. This fork modernizes the original Neat Bookmarks with Manifest V3 support, custom themes, and enhanced user controls.

## Key Features

*   **Tree-View Navigation**: Browse your bookmarks in a familiar, organized folder structure.
*   **Instant Search**: Quickly locate bookmarks and folders with a responsive search bar.
*   **In-Place Editing**: Edit titles, URLs, and manage folders directly within the popup interface.
*   **Custom Themes**: Choose from presets like Light, Modern, Dark, Neon, and Vintage, or apply custom CSS.
*   **Batch Opening**: Open all bookmarks in a folder simultaneously with an optional confirmation prompt.
*   **State Persistence**: Automatically remembers your scroll position and open folders across sessions.
*   **Omnibox Integration**: Search your bookmarks directly from the address bar using the `*` keyword.

## Quick Start

To install sNeater Bookmarks in developer mode:

1.  **Download** the repository as a ZIP file and extract it, or clone it using Git.
2.  Open Google Chrome and navigate to `chrome://extensions/`.
3.  Enable **Developer mode** by toggling the switch in the top-right corner.
4.  Click the **Load unpacked** button.
5.  Select the `bookarmk` folder from your local directory.

## Overview

sNeater Bookmarks is built on the Google Chrome Manifest V3 platform, ensuring long-term compatibility and performance. The extension utilizes a Service Worker (`background.js`) for background tasks and efficient event handling.

### Tech Stack
*   **Logic**: Pure JavaScript for bookmark manipulation and tree rendering.
*   **Styling**: Modular CSS with theme support and a unified design system.
*   **Storage**: `chrome.storage.sync` for cross-device preference synchronization.

### Permissions Explanation
*   **bookmarks**: Required to read, create, edit, and delete your bookmarks.
*   **tabs**: Used to open bookmarks in new tabs/windows and manage batch opening.
*   **favicon**: Used to retrieve and display website icons next to your bookmarks.
*   **storage**: Used to save your settings, theme preferences, and UI state.

## FAQ

**Q: How do I access the options and configuration?**
A: Right-click the sNeater Bookmarks icon in your toolbar and select "Options", or click the gear icon located at the bottom of the popup.

**Q: Can I customize the look further than the presets?**
A: Yes! The options page includes a "Custom CSS" field where you can inject your own styles to completely personalize the interface.

**Q: Does this extension track my browsing data?**
A: No. sNeater Bookmarks only interacts with your bookmarks and does not collect or transmit any personal browsing history.

**Q: How do I open a bookmark in a new background tab?**
A: You can Ctrl+Click (or Cmd+Click on Mac) any bookmark, or middle-click it to open it in a new background tab.

**Q: What is the Omnibox keyword?**
A: Type `*` followed by a space in your address bar to search through your bookmarks directly.

## Credits

This project is a fork of [Neat Bookmarks](https://github.com/cheeaun/neat-bookmarks) originally created by **Lim Chee Aun (@cheeaun)**. We thank the original author for the excellent foundation.

## License

This project is licensed under the [MIT License](LICENSE).

