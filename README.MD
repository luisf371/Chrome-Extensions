![sGestures Icon](icon-128.png)

![License](https://img.shields.io/badge/license-MIT-blue.svg)
![Language](https://img.shields.io/badge/language-JavaScript-yellow.svg)
![Version](https://img.shields.io/badge/version-1.0.0-green.svg)

🌍 **Supported Languages:** English, Spanish, French, Japanese, Portuguese (Brazil), Chinese (Simplified)

sGestures is a lightweight, bloat-free Chrome extension that brings intuitive mouse gestures to your browser. It allows you to execute common navigation tasks through simple mouse movements and rocker combinations without the overhead of complex configurations.

## Key Features

*   **Mouse Gestures**: Execute actions by moving the mouse in four directions (Up, Down, Left, Right) while holding the right button.
*   **Rocker Gestures**: Perform quick actions by clicking one mouse button while holding the other.
*   **Visual Feedback**: Customizable gesture trails with adjustable color and width.
*   **Comprehensive Actions**: Map gestures to New Tab, Close Tab, Reload, Back/Forward, Scroll to Top/Bottom, and more.
*   **Dark/Light Themes**: A clean options interface that respects your system's theme preferences.

## Quick Start

To install sGestures manually:

1.  Download or clone this repository.
2.  Open Chrome and navigate to `chrome://extensions/`.
3.  Enable **Developer mode** in the top right corner.
4.  Click **Load unpacked** and select the `sGesture` directory.

## Usage

### Mouse Gestures
1.  **Hold** the right mouse button.
2.  **Move** the mouse in a specific direction (e.g., move Left to go back).
3.  **Release** the button to trigger the action.

### Rocker Gestures
1.  **Hold** one mouse button (e.g., Right).
2.  **Click** the other mouse button (e.g., Left).
3.  **Release** to trigger the action.

**Default Rocker Mappings:**
| Combination | Default Action |
|-------------|----------------|
| Right + Left (hold Right, click Left) | History Back |
| Left + Right (hold Left, click Right) | History Forward |

*Rocker actions are fully customizable in the Options page.*

## Overview

sGestures is built on **Manifest Version 3**, ensuring modern security and performance standards. It utilizes a `mouseTrack.js` content script to intercept movements on web pages and communicates with a `background.js` service worker to execute tab-level actions. Configuration is handled via the `chrome.storage` API and managed through a sleek `options.html` page.

## Configuration

You can customize sGestures by right-clicking the extension icon and selecting **Options**.

*   **Actions**: Rebind each direction or rocker combination to your preferred command.
*   **Appearance**: Change the gesture trail color and thickness.
*   **Exclusions**: (Optional) Manage where the extension should or shouldn't run.

## Permissions Explanation

sGestures requests the following permissions:

*   **tabs**: To open, close, and navigate between your browser tabs.
*   **storage**: To save your custom gesture mappings and visual preferences.
*   **activeTab**: To interact with the current page when a gesture is performed.
*   **sessions**: To restore recently closed tabs via gestures.

## FAQ

**Q: How do I perform a gesture?**
A: Hold the right mouse button and move the mouse in a direction, then release.

**Q: What are rocker gestures?**
A: Rocker gestures let you navigate by holding one mouse button and clicking the other. By default: Hold Right + Click Left = Back, Hold Left + Click Right = Forward. These follow the Opera browser convention and are fully customizable.

**Q: Can I change the color of the gesture trail?**
A: Yes, the trail color and width can be fully customized in the settings.

**Q: Why doesn't it work on some pages?**
A: Chrome restricts extensions from running on internal `chrome://` pages and the Chrome Web Store for security reasons.

**Q: Is sGestures privacy-friendly?**
A: Absolutely. All processing happens locally on your machine, and no data is ever sent to external servers.

## Credits

sGestures is part of the "s" extension series. Thanks to the contributors and the open-source community for their support and resources.

## License

This project is licensed under the **MIT License**.
