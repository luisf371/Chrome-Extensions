![Project Banner](path/to/image.png)
<!-- Replace with actual banner if available -->

![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)
![Language: JavaScript](https://img.shields.io/badge/Language-JavaScript-F7DF1E.svg)
![Version: 1.0.0](https://img.shields.io/badge/Version-1.0.0-green.svg)

🌍 **Supported Languages:** English, Spanish, French, Japanese, Portuguese (Brazil), Chinese (Simplified)

sGestures is a simple and fast way to control your browser with mouse movements. It adds intuitive gestures and "rocker" clicks to your mouse, making navigation feel natural and efficient.

## Key Features

*   **Mouse Gestures**: Hold the right button and move your mouse to trigger actions like closing tabs or going back.
*   **Rocker Gestures**: Click one mouse button while holding another for quick "Opera-style" navigation.
*   **Visual Trails**: See your movements with a customizable trail that shows you exactly what you're doing.
*   **Action Mapping**: Pick from many actions like Reload, New Tab, Scroll to Top, or Re-open closed tabs.
*   **Modern Design**: A clean, easy-to-use settings page with support for both Light and Dark themes.

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

This extension uses a content script to track mouse movements and a Service Worker to execute commands, fully compatible with Manifest V3. It is designed to be lightweight, ensuring that your browser stays fast while adding powerful new controls.

## FAQ

**Q: What does the 's' in the name mean?**
A: It stands for simple and lightweight application with no bloat, tracking, or ads.

**Q: How do I use a mouse gesture?**
A: Just hold your right mouse button, move the mouse in a direction (like Left to go back), and release.

**Q: What are Rocker Gestures?**
A: These are combinations like holding the right button and clicking the left button to quickly go back in your history.

**Q: Can I change the colors?**
A: Yes, you can change the color and thickness of the gesture trail in the settings.

**Q: Does it work on all websites?**
A: It works on almost all sites, but Chrome blocks extensions on internal pages like `chrome://settings` for safety.

## License

MIT License
