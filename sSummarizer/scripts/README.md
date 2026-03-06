# Analysis of Content Extraction Logic

The extension employs specialized extraction strategies tailored to different platforms to provide the AI with the highest quality context. The core logic is contained within `scripts/content-scraper.js`.

## 1. YouTube Extraction Logic
The YouTube extractor (`extractYouTubeCaptions`) mimics the professional-grade `youtube-transcript-api` (Python) to retrieve transcripts efficiently.

### Method 1: YouTube Internal API (Primary)
*   **Logic**:
    1.  Fetches the video's watch page HTML in the background using a mobile user agent.
    2.  Extracts the `INNERTUBE_API_KEY` directly from the page source.
    3.  Calls YouTube's internal `youtubei/v1/player` endpoint to retrieve the `playerCaptionsTracklistRenderer`.
    4.  **Intelligent Selection**: Selects the best track based on user preferences:
        *   **Language**: Defaults to user-defined preferred language (e.g., 'en').
        *   **Priority**: Prioritizes manual vs. auto-generated captions based on user settings.
        *   **Translation**: If the preferred language isn't available, it automatically requests a server-side translation via the `&tlang=` parameter.
    5.  **Parsing**: Fetches the raw XML transcript and cleans it (stripping HTML, decoding entities, and removing control characters).
*   **Timestamp Support**: If enabled, injects `[HH:MM:SS]` markers into the text for chronological context.

### Method 2: UI Scraping (Fallback)
*   **Trigger**: Runs only if Method 1 fails (e.g., API structure change).
*   **Logic**:
    1.  Programmatically locates and clicks the "Show transcript" button in the YouTube interface.
    2.  Waits for the side panel to render.
    3.  Scrapes visible text segments from the DOM using specific selectors like `ytd-transcript-segment-renderer`.

### Method 3: Metadata Fallback
*   **Trigger**: Runs if no transcript is available.
*   **Logic**: Extracts the **Video Title** and **Description** (truncated to 1000 characters) to provide minimal context.

---

## 2. Reddit Thread Extraction Logic
The Reddit extractor (`extractRedditThread`) is designed to capture complex discussions while avoiding the "noise" of modern web layouts.

*   **Layout Support**: Native support for both **Modern (Shreddit)** and **Legacy (Classic)** Reddit interfaces.
*   **Dynamic Sorting**:
    *   If the user selects a sort (e.g., Top, New, Controversial) that differs from the current view, the script performs a background `fetch` of the sorted page to get the correct data.
*   **Recursive Threading**:
    *   Uses a recursive tree-walking algorithm (`extractCommentTree`) to capture nested replies.
    *   **Indentation Styling**: Replies are formatted with specific indentation (e.g., `    > Reply`) to help the AI understand the flow of conversation.
*   **Limits**:
    *   Respects user-defined constraints for **Max Comments** and **Max Depth** (e.g., only go 3 levels deep) to prevent token overflow.

---

## 3. General Web Page Extraction Logic
For all other websites, the extension uses a universal scraping method.

*   **Method**: `getPageContent()`
*   **Logic**: Returns `document.body.innerText`.
*   **Behavior**: Captures all visible text. While this includes sidebar and footer text, modern LLMs are highly proficient at identifying the core article content within this larger block.
