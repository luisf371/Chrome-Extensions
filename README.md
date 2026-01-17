![sTabControl Icon](icon128.png)

# sTabControl

![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)
![Language: JavaScript](https://img.shields.io/badge/Language-JavaScript-F7DF1E.svg)
![Manifest Version: 3](https://img.shields.io/badge/Manifest-V3-blue.svg)

🌍 **Supported Languages:** English, Spanish, French, Japanese, Portuguese (Brazil), Chinese (Simplified)

## Introduction
sTabControl is a lightweight and powerful Chrome extension designed to give you complete control over your browser's tab behaviors. By automating tab positioning and focus transitions, it ensures a seamless and organized browsing experience tailored to your workflow.

## Key Features
- **Intelligent Positioning**: Automatically place new tabs at the beginning, end, or relative to your current tab.
- **Smart Focus Transition**: Define exactly which tab gains focus after you close the current one.
- **Background Loading**: Choose whether to open new tabs in the foreground or keep them in the background.
- **Duplicate Prevention**: Intelligently prevent multiple tabs of the same URL while still allowing manual "Duplicate Tab" actions.
- **Personalized UI**: Toggle between Dark and Light themes to match your system or preference.

## Installation
Since this extension is in development, you can install it manually:

1. Download or clone this repository to your local machine.
2. Open Chrome and navigate to `chrome://extensions/`.
3. Enable **Developer mode** using the toggle in the top right corner.
4. Click **Load unpacked** and select the `sTabControl` directory.

## Usage
Once installed, sTabControl works automatically in the background. To customize your experience:

1. Click the **sTabControl** icon in your extension toolbar.
2. Select **Open Settings** to access the configuration page.
3. Choose your preferred behaviors for tab creation and closure.
4. Toggle the **Theme** button to switch between Light and Dark modes.
5. Settings are saved automatically upon selection.

## Configuration & Overview
The extension utilizes a `service_worker` (`background.js`) to monitor tab events via the Chrome API. It provides the following configuration options:

| Option | Available Values |
| :--- | :--- |
| **New Tab Position** | First, Next Left, Next Right, Last, Default |
| **After Closing Go To** | Last used tab, Left tab, Right tab, Default |
| **Open Method** | Foreground, Background |
| **Duplicate Control** | Enable/Disable duplicate prevention |

## Permissions Explanation
To provide advanced tab management, sTabControl requires the following permissions:
- `tabs`: Essential for reordering, focusing, and managing tab properties.
- `storage`: Used to save and sync your configuration preferences across devices.
- `webNavigation`: Necessary for detecting URL changes to effectively prevent duplicate tabs.

## FAQ
**Q: Does "Prevent duplicate tabs" stop me from manually duplicating a tab?**
A: No. The extension includes a smart allowance for the "Duplicate Tab" action, so you can still manually clone tabs when needed.

**Q: Will this slow down my browser?**
A: Not at all. sTabControl uses a Manifest V3 Service Worker that only runs when tab events occur, consuming minimal resources.

**Q: Can I set different rules for different websites?**
A: Currently, settings are applied globally to all tabs for a consistent experience.

**Q: Does it support dark mode?**
A: Yes, there is a theme toggle on the settings page to switch between Light and Dark modes.

**Q: Why does it need webNavigation permission?**
A: It uses this to check if a URL you are navigating to is already open in another tab, helping to prevent duplicates.

## Credits
sTabControl is an original extension developed as part of the **"s" series** collection of utility extensions.

## License
[MIT License](LICENSE)
