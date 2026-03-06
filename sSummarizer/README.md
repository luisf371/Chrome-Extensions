![Project Banner](./images/ss-banner.png)
<!-- Main project branding banner -->

![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg) ![Language: JavaScript](https://img.shields.io/badge/Language-JavaScript-F7DF1E.svg) ![Version: 1.4](https://img.shields.io/badge/Version-1.0.3-green.svg)

🌍 **Supported Languages:** English, Spanish, French, Japanese, Portuguese (Brazil), Chinese (Simplified)

## The Problem with the Modern Web

The web is noisy. You click an article, 4,000 words. YouTubers include sponsor and filler content. Check a Reddit thread, 200+ nested comments.

sSummarizer cuts through the noise. One click turns any page into a clean, readable summary.

## Overview

sSummarizer is a lightweight, browser-native extension that runs entirely on your device. It uses a custom content extractor to identify the main body of text, video transcripts, or nested comment structures, then sends that context directly to your chosen AI provider for an accurate, high-quality summary.

## Key Features

*   **Multi-Platform Support**: Summarize web pages, news articles, YouTube videos, and Reddit threads.
*   **AI Provider Choice**: Connect directly to your favorite AI models like OpenAI, Claude, Gemini, OpenRouter, or Perplexity.
*   **Custom Slash Commands**: Create and save personalized shortcuts like `/tldr` or `/faq` that customize how the AI responds.
*   **Quick Slash Selection**: Choose from your saved commands to instantly generate the summary in your preferred style.
*   **Interactive Chat**:  Keep the conversation going by asking follow-up questions!
*   **Streaming Support**: Watch the summary write itself in real-time
*   **Context Menu**: Highlight any text on a page, right-click, and easily summarize just that specific part.

## Quick Start

### Install from Chrome Web Store
1. Visit the [Chrome Web Store](https://chrome.google.com/webstore) (Coming Soon).
2. Click **Add to Chrome**.

### Manual Installation
```bash
# 1. Download this repository as a ZIP and extract it.
# 2. Open Chrome and navigate to:
chrome://extensions/
```
1. Enable **Developer mode** in the top right corner.
2. Click **Load unpacked** and select the extracted `sSummarizer` folder.
3. Open the extension **Options** and add your AI API key to get started.

## FAQ

**Q: What does the 's' in the name mean?**
A: It stands for simple. No bloat, no tracking, no ads—just a lightweight tool that does one thing well.

**Q: Do I need my own API key?**
A: Yes. We don't markup AI costs or act as a middleman. Grab a key from OpenAI, Anthropic, OpenRouter, or Gemini and you're set. Many providers offer free tiers.

**Q: Does it work on YouTube?**
A: Yes! It automatically pulls the transcript from the current video and summarizes based on your prompt.

**Q: Can I change the summary style?**
A: Yes. Edit the global "System Prompt" in settings or use custom Slash Commands to instruct the AI exactly how to write your summary.

**Q: Is my browsing data private?**
A: Absolutely. Content goes directly to your AI provider. We never see it, store it, or sell it.

**Q: Can I ask follow-up questions after generating a summary?**
A: Yes! After the initial summary completes, you can continue the chat to ask follow-up questions, request deeper explanations, or clarify specific parts of the text.

## Permissions

sSummarizer minimally requests only the following browser permissions to function properly:
*   **activeTab**: To read the page you're currently viewing when you activate the extension
*   **scripting**: To inject our content extractor for complex sites like YouTube/Reddit
*   **storage**: To securely save your API keys and custom slash commands locally
*   **contextMenus**: To add "Summarize selection" to your right-click menu

## Privacy

sSummarizer is designed with a strict privacy-first approach. It only accesses webpage content dynamically when you explicitly activate it to generate a summary. The carefully extracted text is then sent directly and securely to your configured AI provider's API. Our extension does not collect, store, transmit, or monetize your personal data, detailed browsing history, or API keys to any third-party servers.

## License

MIT License

## From the Maker

If this saves you time, consider starring the repo or checking out my other extensions at tekky.cc.