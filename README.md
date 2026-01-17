![SimpleUndoClose Icon](icon-128.png)

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Language: JavaScript](https://img.shields.io/badge/Language-JavaScript-blue.svg)](https://developer.mozilla.org/en-US/docs/Web/JavaScript)
[![Version: 1.3.11](https://img.shields.io/badge/Version-1.3.11-green.svg)](https://github.com/your-repo/SimpleUndoClose)

🌍 **Supported Languages:** English, Spanish, French, Japanese, Portuguese, Chinese

SimpleUndoClose is a lightweight and efficient Chrome extension designed to help you recover accidentally closed tabs with a single click or keystroke. It provides a clean, searchable interface and customizable settings to ensure your browsing flow remains uninterrupted.

## Key Features

*   **Quick Restore Popup**: View and restore a list of your recently closed tabs instantly.
*   **Powerful Search**: Quickly find a specific closed tab by typing in the popup search bar.
*   **Keyboard Shortcuts**: Use `Alt+Z` (`Ctrl+Z` on Mac) to undo your last closed tab without opening the menu.
*   **Customizable Experience**: Toggle the tab count badge, adjust history limits, choose themes, and modify popup width.
*   **Privacy Focused**: Your data stays local; the extension only interacts with your browser's history to facilitate restoration.

## Quick Start

To install SimpleUndoClose for development or manual use:

1.  Download or clone this repository to your local machine.
2.  Open Google Chrome and navigate to `chrome://extensions/`.
3.  Enable **Developer mode** using the toggle in the top right corner.
4.  Click **Load unpacked** and select the `SimpleUndoClose` directory.
5.  The extension is now ready to use! Pin it to your toolbar for easy access.

## Usage

### Popup Interface
Click the extension icon in your toolbar to open the list of recently closed tabs. You can:
*   Click any item to restore it.
*   Use the search bar at the top to filter results.
*   Access settings via the options icon.

### Keyboard Shortcuts
*   **Windows/Linux**: `Alt+Z`
*   **macOS**: `Command+Ctrl+Z` (or as configured in `chrome://extensions/shortcuts`)

## Configuration

You can customize the extension by right-clicking the icon and selecting **Options**. Available settings include:
*   **Badge Display**: Show/hide the number of closed tabs on the icon.
*   **Search Mode**: Choose between different search algorithms.
*   **History Limit**: Set how many closed tabs the extension should remember.
*   **Themes**: Switch between light and dark modes.
*   **Popup Width**: Adjust the UI to fit your preference.

## Permissions Explanation

This extension requires the following permissions to function:
*   `tabs`: To open and manage restored tabs.
*   `favicon`: To display the icons of closed websites in the list.
*   `storage`: To save your custom settings and preferences.
*   `history`: To retrieve the list of recently closed tabs from your browser.

## Technical Overview

SimpleUndoClose is built on **Manifest V3**, utilizing a modern service worker architecture for background tasks.
*   **Service Worker (`bg.js`)**: Handles keyboard commands and manages the extension's lifecycle.
*   **Shared Logic (`common.js`)**: Contains reusable functions for storage and tab management.
*   **Popup (`popup.html`/`popup.js`)**: The main user interface, optimized for speed and accessibility.
*   **Options (`options.html`/`options.js`)**: A clean configuration page for user preferences.

## FAQ

**Q: How do I undo a tab using only my keyboard?**  
A: Use `Alt+Z` (or `Ctrl+Z` on Mac) to instantly restore the last closed tab.

**Q: Can I change the number of tabs remembered by the extension?**  
A: Yes, you can adjust the history limit in the extension's options page.

**Q: Does this extension track my browsing history?**  
A: No, it only uses the `history` permission locally to retrieve recently closed tabs and `storage` to save your preferences.

**Q: Why is the icon badge showing a number?**  
A: The badge indicates the number of recently closed tabs available to be restored. This can be disabled in the settings.

**Q: How do I search for a specific closed tab?**  
A: Open the popup and start typing in the search bar to filter through your recently closed tabs.

## Credits

This project is a fork of **Sexy Undo Close Tab** by J K, which was originally based on **Undo Close Tab**.
*   **Sexy Undo Close Tab** (J K) - Original extension core.
*   **Android Design** - Icons used in the options page.

## License

This project is open-source. Please respect the original authors' work and the lineage of the Undo Close Tab extensions.

