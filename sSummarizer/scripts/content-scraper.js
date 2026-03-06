// ===== YOUTUBE EXTRACTION =====
// scripts/content-scraper.js

/**
 * Function to be injected into YouTube pages to extract captions
 * This runs in the context of the YouTube page
 * Based on the Python youtube-transcript-api implementation
 */
async function extractYouTubeCaptions() {

    try {
        // Method 1: Use YouTube Internal API
        const videoId = extractVideoIdFromUrl(window.location.href);
        if (videoId) {
            const transcriptData = await getTranscriptViaInternalAPI(videoId);
            if (transcriptData && transcriptData.length > 100) {
                return transcriptData;
            }
        } else {
            console.log('[YT Extractor] Could not extract video ID from URL.');
        }

        // Method 2: Try to access transcript panel
        const transcriptPanelData = await extractFromTranscriptPanel();
        if (transcriptPanelData && transcriptPanelData.length > 100) {
            return transcriptPanelData;
        }

        // Method 3: Fallback to title and description
        return await fallbackToTitleDescription();

    } catch (error) {
        console.log('[YT Extractor] Error in extractYouTubeCaptions:', error);
        return await fallbackToTitleDescription();
    }
}

/**
 * Extract video ID from YouTube URL
 */
function extractVideoIdFromUrl(url) {
  const patterns = [
    /// orig working
    // /[?&]v=([^&]+)/,
    // /\/embed\/([^?&]+)/,
    // /\/watch\/([^?&]+)/,
    // /youtu\.be\/([^?&]+)/
    // gpt improved
    /[?&]v=([a-zA-Z0-9_-]{11})/,
    /\/embed\/([a-zA-Z0-9_-]{11})/,
    /\/watch\/([a-zA-Z0-9_-]{11})/,
    /youtu\.be\/([a-zA-Z0-9_-]{11})/
  ];
  
  for (const pattern of patterns) {
    const match = url.match(pattern);
    if (match && match[1]) {
      return match[1];
    }
  }
  return null;
}

/**
 * Get transcript using YouTube's internal API (mimicking Python implementation)
 */
async function getTranscriptViaInternalAPI(videoId) {
  try {
    
    // Step 1: Fetch the YouTube watch page HTML
    const watchUrl = `https://www.youtube.com/watch?v=${videoId}`;
    const response = await fetch(watchUrl, {
      headers: {
        'User-Agent': 'com.google.android.youtube/20.10.38 (Linux; U; Android 11) gzip'
      }
    });
    
    if (!response.ok) {
      return null;
    }
    
    const html = await response.text();
    
    // Step 2: Extract INNERTUBE_API_KEY from HTML
    const apiKeyMatch = html.match(/"INNERTUBE_API_KEY"\s*:\s*"([a-zA-Z0-9_-]+)"/);
    if (!apiKeyMatch) {
      return null;
    }
    
    const apiKey = apiKeyMatch[1];
    
    // Step 3: Make request to YouTube InnerTube API
    const innertubeUrl = `https://www.youtube.com/youtubei/v1/player?key=${apiKey}`;
    const innertubeResponse = await fetch(innertubeUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'com.google.android.youtube/20.10.38 (Linux; U; Android 11) gzip'
      },
      body: JSON.stringify({
        context: {
          client: {
            clientName: 'ANDROID',
            clientVersion: '20.10.38'
          }
        },
        videoId: videoId
      })
    });
    
    if (!innertubeResponse.ok) {
      return null;
    }
    
    const innertubeData = await innertubeResponse.json();
    
    // Step 4: Extract captions from response
    const captions = innertubeData?.captions?.playerCaptionsTracklistRenderer;
    if (!captions || !captions.captionTracks) {
      return null;
    }

    // Step 5: Load user preferences and select best caption track
    const { subtitlePriority, preferredLanguage } = await new Promise(resolve =>
      chrome.storage.local.get({ subtitlePriority: 'auto', preferredLanguage: 'en' }, resolve)
    );
    const lang = (preferredLanguage || 'en').toLowerCase();
    const preferAuto = (subtitlePriority || 'auto') === 'auto';
    const tracks = captions.captionTracks;
    const isAuto = (t) => t.kind === 'asr';
    const isLang = (t, code) => (t.languageCode || '').toLowerCase() === code;

    let selectedTrack;
    if (preferAuto) {
      selectedTrack = tracks.find(t => isLang(t, lang) && isAuto(t))
        || tracks.find(t => isLang(t, lang) && !isAuto(t))
        || tracks.find(t => isAuto(t))
        || tracks.find(t => !isAuto(t))
        || (tracks.length > 0 ? tracks[0] : null);
    } else {
      selectedTrack = tracks.find(t => isLang(t, lang) && !isAuto(t))
        || tracks.find(t => isLang(t, lang) && isAuto(t))
        || tracks.find(t => !isAuto(t))
        || tracks.find(t => isAuto(t))
        || (tracks.length > 0 ? tracks[0] : null);
    }
    
    if (!selectedTrack?.baseUrl) {
      return null;
    }
    
    // Step 6: Fetch and parse caption XML
    let captionUrl = selectedTrack.baseUrl;
    // Clean the URL (remove fmt=srv3 as per Python implementation)
    captionUrl = captionUrl.replace('&fmt=srv3', '');

    // If different language but translatable, request translation to preferred language
    if (selectedTrack?.languageCode && selectedTrack.languageCode.toLowerCase() !== lang && selectedTrack?.isTranslatable) {
      captionUrl += `&tlang=${encodeURIComponent(lang)}`;
    }
    
    const captionResponse = await fetch(captionUrl);
    if (!captionResponse.ok) {
      return null;
    }
    
    const xmlText = await captionResponse.text();
    
    // Step 7: Parse XML and extract text
    return await parseYouTubeCaptionXML(xmlText);
    
  } catch (error) {
    console.log('[YT Extractor] Error in getTranscriptViaInternalAPI:', error);
    return null;
  }
}
/**
 * Formats seconds into [HH:MM:SS] format.
 * @param {number} totalSeconds - The total seconds to format.
 * @returns {string} The formatted timestamp string.
 */
function formatTimestamp(totalSeconds) {
    const floorSeconds = Math.floor(totalSeconds);
    const hours = Math.floor(floorSeconds / 3600);
    const minutes = Math.floor((floorSeconds % 3600) / 60);
    const seconds = floorSeconds % 60;

    // Pad with leading zeros if necessary
    const pad = (num) => String(num).padStart(2, '0');

    return `[${pad(hours)}:${pad(minutes)}:${pad(seconds)}]`;
}

/**
 * Parse YouTube caption XML (mimicking Python ElementTree parsing)
 */
async function parseYouTubeCaptionXML(xmlText) {
  try {
    
    if (!xmlText || !xmlText.trim()) {
      return null;
    }
    
    // Parse XML using DOMParser
    const parser = new DOMParser();
    const xmlDoc = parser.parseFromString(xmlText, 'application/xml');
    
    // Check for parsing errors
    const parserError = xmlDoc.querySelector('parsererror');
    if (parserError) {
      console.log('[YT Extractor] XML parsing error:', parserError.textContent);
      return null;
    }
    
    // Extract text elements (equivalent to Python's ElementTree.fromstring(raw_data))
    const textElements = xmlDoc.querySelectorAll('text');
    
    if (textElements.length === 0) {
      return null;
    }
    
    // Convert to transcript snippets (mimicking Python's list comprehension)
    const snippets = [];
    for (const element of textElements) {
      const textContent = element.textContent;
      if (textContent) {
        // Clean HTML tags and decode entities (mimicking Python's re.sub and unescape)
        const cleanText = textContent
          .replace(/<[^>]*>/g, '') // Remove HTML tags
          .replace(/&amp;/g, '&')
          .replace(/&lt;/g, '<')
          .replace(/&gt;/g, '>')
          .replace(/&quot;/g, '"')
          .replace(/&#39;/g, "'")
          .replace(/&nbsp;/g, ' ')
          // Remove control characters that might break some JSON parsers or confuse LLMs
          .replace(/[\u0000-\u0008\u000B-\u001F\u007F-\u009F]/g, "")
          .trim();
        
        if (cleanText) {
          snippets.push({
            text: cleanText,
            start: parseFloat(element.getAttribute('start') || '0'),
            duration: parseFloat(element.getAttribute('dur') || '0')
          });
        }
      }
    }
    
    if (snippets.length === 0) {
      return null;
    }
    
    // Get timestamp setting
    const { includeTimestamps } = await new Promise(resolve => 
        chrome.storage.local.get({ includeTimestamps: false }, resolve)
    );

    // Sort by start time and join text
    snippets.sort((a, b) => a.start - b.start);

            let fullTranscript;
    if (includeTimestamps) {
        fullTranscript = snippets.map(s => `${formatTimestamp(s.start)} ${s.text}`).join(' ');
    } else {
        fullTranscript = snippets.map(s => s.text).join(' ');
    }

//    // Append timestamp info
//    const subtitleInfo = `
//
//- - - - - - - - - - - - - -
//Input contains timestamps: ${includeTimestamps}`;
//    fullTranscript += subtitleInfo;

    return fullTranscript;
    
  } catch (error) {
    console.log('[YT Extractor] Error parsing caption XML:', error);
    return null;
  }
}

/**
 * Extract from transcript panel (if available)
 */
async function extractFromTranscriptPanel() {
  try {
    // Try to find and click transcript button
    const transcriptButton = document.querySelector('button[aria-label*="transcript" i], button[aria-label*="Show transcript" i]');
    if (transcriptButton && !transcriptButton.getAttribute('aria-pressed')) {
      transcriptButton.click();
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
    
    const transcriptSelectors = [
      'ytd-transcript-segment-renderer .segment-text',
      '[data-testid="transcript-segment"]',
      '.ytd-transcript-segment-renderer',
      'ytd-transcript-body-renderer .segment-text'
    ];
    
    for (const selector of transcriptSelectors) {
      const transcriptItems = document.querySelectorAll(selector);
      if (transcriptItems.length > 0) {
        const text = Array.from(transcriptItems).map(item => item.textContent?.trim()).filter(Boolean).join(' ');
        
        if (text.length > 100) {
          return text;
        }
      }
    }
    
    return null;
    
  } catch (error) {
    console.log('[YT Extractor] Error in extractFromTranscriptPanel:', error);
    return null;
  }
}

/**
 * Fallback to title and description
 */
async function fallbackToTitleDescription() {
  try {
    const title = await extractVideoTitle();
    const description = await extractVideoDescription();
    
    if (title) {
      const shortDesc = description ? (description.length > 1000 ? description.substring(0, 1000) + '...' : description) : "";
      return `Video Title: ${title}\n\nDescription: ${shortDesc}`;
    }
    
    return null;
    
  } catch (error) {
    console.error('[YT Extractor] Error in fallbackToTitleDescription:', error);
    return null;
  }
}

// Extract video title with multiple selectors
async function extractVideoTitle() {
  const titleSelectors = [
    'h1.ytd-video-primary-info-renderer',
    'h1.ytd-videoPrimaryInfoRenderer',
    '#title h1',
    '.ytd-video-primary-info-renderer h1',
    'h1[class*="title"]',
    '.title.style-scope.ytd-video-primary-info-renderer'
  ];
  
  for (const selector of titleSelectors) {
    const element = document.querySelector(selector);
    if (element?.textContent?.trim()) {
      return element.textContent.trim();
    }
  }
  
  return null;
}

// Extract video description with multiple selectors
async function extractVideoDescription() {
  const descSelectors = [
    '#description-text',
    '.ytd-video-secondary-info-renderer #description',
    '.ytd-expandable-video-description-body-renderer',
    '#meta-contents #description',
    '.description .content',
    'ytd-video-secondary-info-renderer #description'
  ];
  
  for (const selector of descSelectors) {
    const element = document.querySelector(selector);
    if (element?.textContent?.trim()) {
      return element.textContent.trim();
    }
  }
  
  return null;
}

// ===== COMMON / GENERIC PAGE EXTRACTION =====
function getPageContent() {
  return document.body.innerText;
}

// ===== REDDIT THREAD EXTRACTION =====
// ————————————————————————————————————————————————————————————————————————————————
// REDDIT EXTRACTOR
// ————————————————————————————————————————————————————————————————————————————————

function getNormalizedNodeText(node) {
  if (!node) return '';
  return (node.textContent || '')
    .replace(/\r/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]+\n/g, '\n')
    .trim();
}

/**
 * Extract content from a Reddit thread, supporting both 'Shreddit' (modern) and Legacy layouts.
 * Cleans noise (ads, timestamps, sidebars) and limits comment depth/count.
 */
async function extractRedditThread() {

  // Load user settings for limits and sort
  const { redditMaxComments, redditDepth, redditSort } = await new Promise(resolve =>
    chrome.storage.local.get({ redditMaxComments: 100, redditDepth: 3, redditSort: 'current' }, resolve)
  );
  
  const parsedMaxComments = Number.parseInt(redditMaxComments, 10);
  const parsedDepth = Number.parseInt(redditDepth, 10);
  const maxComments = Number.isFinite(parsedMaxComments) ? parsedMaxComments : 100;
  const depthLimit = Number.isFinite(parsedDepth) ? parsedDepth : 3;
  const sortType = redditSort || 'current';

  try {
    // Handle Sort Logic
    let doc = document;
    let isFetched = false;

    if (sortType !== 'current') {
        const url = new URL(window.location.href);
        const currentSort = url.searchParams.get('sort');
        
        // If current URL already matches requested sort, or if we are on a permalink (single thread often ignores sort unless it's specific),
        // But usually ?sort= works on threads too.
        // If current sort != requested, fetch.
        if (currentSort !== sortType) {
             url.searchParams.set('sort', sortType);
             url.searchParams.set('limit', '500'); // Request more comments
             try {
                 const response = await fetch(url.toString());
                 if (response.ok) {
                     const html = await response.text();
                     const parser = new DOMParser();
                     doc = parser.parseFromString(html, 'text/html');
                     isFetched = true;
                 } else {
                     console.warn('[Reddit Extractor] Failed to fetch sorted page, using current.');
                 }
             } catch (e) {
                 console.warn('[Reddit Extractor] Error fetching sorted page, using current:', e);
             }
        }
    }

    // 1. Extract Title
    let title = '';
    // Modern (Shreddit)
    const shredditTitle = doc.querySelector('h1[slot="title"], shreddit-title');
    // Legacy/Standard - Ensure we don't pick up sidebar h1s? usually sidebar h1 is unlikely to be just h1.
    const standardTitle = doc.querySelector('.Post h1, h1.title, .thing.link .title a.title');
    // Fallback to generic h1 if specific ones fail, but avoid sidebars
    title = (shredditTitle || standardTitle || doc.querySelector('h1'))?.textContent?.trim() || 'Untitled Reddit Post';

    // 2. Extract OP Body
    let opBody = '';
    
    // Modern: often in a specific slot or div with data-click-id
    // Selector refinement: target specific shreddit-post
    const shredditBody = doc.querySelector('shreddit-post [slot="text-body"], #post-content-body');
    
    // Legacy Refined: explicitly avoid .side / .sidebar
    // The main post is usually in #siteTable > .thing > .entry > .usertext-body
    const legacyBody = doc.querySelector('#siteTable .thing.link .usertext-body .md, .Post-body');
    
    // Fallback, but careful
    const fallbackBody = doc.querySelector('[data-click-id="text-body"]');
    
    opBody = getNormalizedNodeText(shredditBody || legacyBody || fallbackBody) || '(No text content / Image or Link post)';

    // 3. Extract Comments
    let commentsText = [];
    
    // Strategy: Try Shreddit (Web Components) first, then fallback
    const shredditComments = doc.querySelectorAll('shreddit-comment');
    
    if (shredditComments.length > 0) {
        
        const allComments = Array.from(shredditComments);
        // Filter for top-level comments. 
        // In fetched HTML, attributes might be reliable.
        const topLevelComments = allComments.filter(c => c.getAttribute('depth') === '0' || !c.parentElement.closest('shreddit-comment'));
        
        // Take top N threads
        const threadsToProcess = topLevelComments.slice(0, maxComments);

        for (const thread of threadsToProcess) {
            const threadText = extractCommentTree(thread, 0, depthLimit);
            if (threadText) commentsText.push(threadText);
        }

    } else {
        
        // Legacy Top Levels are usually direct children of the nestedlisting, OR have data-level=0
        // We must avoid .child comments
        const topLevelContainers = doc.querySelectorAll('.sitetable.nestedlisting > .thing.comment, .Comment[data-level="0"]');
        
        // If fetched via API/HTML, sometimes structure differs (new reddit vs old reddit view depends on user agent/cookies)
        // But assuming we get one or the other.
        
        const targets = topLevelContainers.length > 0 ? topLevelContainers : doc.querySelectorAll('.Comment:not(.child)'); 
        const sliced = Array.from(targets).slice(0, maxComments);

        for (const commentNode of sliced) {
            const threadText = extractLegacyCommentTree(commentNode, 0, depthLimit);
            if (threadText) commentsText.push(threadText);
        }

    }

    const formattedOutput = `REDDIT THREAD: ${title}

ORIGINAL POST:
${opBody}

TOP COMMENTS (${commentsText.length} threads extracted, Sort: ${sortType}):
${commentsText.join('\n\n')}
`;

    return formattedOutput;

  } catch (e) {
    console.error('[Reddit Extractor] Error:', e);
    return `Error extracting Reddit thread: ${e.message}`;
  }
}

// Helper for Shreddit recursive extraction
function extractCommentTree(commentNode, currentDepth, maxDepth) {
    const author = commentNode.getAttribute('author') || 'User';
    // Body is often in a slot="comment" or specific div
    const bodyNode = commentNode.querySelector('[slot="comment"]') || commentNode.querySelector('div[id^="-post-rtjson-content"]');
    const body = getNormalizedNodeText(bodyNode);
    
    if (!body) return null;
    
    let text = `${'    '.repeat(currentDepth)}${currentDepth > 0 ? '>'.repeat(currentDepth) + ' ' : ''}User ${author}: ${body.replace(/\n/g, ' ')}`;
    
    if (currentDepth < maxDepth) {
        // Find direct children comments
        // Shreddit nests comments in a div slot="children" or directly inside
        const directChildren = Array.from(commentNode.querySelectorAll(':scope > [slot="children"] > shreddit-comment, :scope > shreddit-comment'));
        
        // Limit replies per level to avoid explosion (e.g. top 3 replies)
        const replies = directChildren.map(child => extractCommentTree(child, currentDepth + 1, maxDepth)).filter(Boolean);
        
        if (replies.length > 0) {
            text += '\n' + replies.join('\n');
        }
    }
    
    return text;
}

/**
 * Recursive extractor for Legacy Reddit comments
 */
function extractLegacyCommentTree(commentNode, currentDepth, maxDepth) {
    const author = commentNode.querySelector('.author, [data-testid="comment_author"]')?.textContent?.trim() || 'User';
    const body = getNormalizedNodeText(commentNode.querySelector('.usertext-body, [data-testid="comment_body"]'));
    
    if (!body) return null;
    
    let text = `${'    '.repeat(currentDepth)}${currentDepth > 0 ? '>'.repeat(currentDepth) + ' ' : ''}User ${author}: ${body.replace(/\n/g, ' ')}`;
    
    if (currentDepth < maxDepth) {
        // Legacy nesting: :scope > .child > .sitetable > .thing.comment
        const directChildren = Array.from(commentNode.querySelectorAll(':scope > .child > .sitetable > .thing.comment'));
        const replies = directChildren.map(child => extractLegacyCommentTree(child, currentDepth + 1, maxDepth)).filter(Boolean);
        if (replies.length > 0) {
            text += '\n' + replies.join('\n');
        }
    }
    
    return text;
}
