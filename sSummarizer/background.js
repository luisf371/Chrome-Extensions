// background.js - Chrome Extension Service Worker
// Handles URL content extraction and API communication for summarization

importScripts('shared/azure-utils.js');

// Handle expected AbortErrors from cancelled API requests
self.addEventListener('unhandledrejection', event => {
  if (event.reason && event.reason.name === 'AbortError') {
    // This is expected when we cancel API requests - suppress the error
    event.preventDefault();
  }
});

// Maps unique request IDs to tab IDs for tracking multiple concurrent requests
let tabIdMap = new Map();
// Maps unique request IDs to AbortControllers for stopping API requests
let abortControllers = new Map();
// Set of cancelled request IDs to prevent late execution
let cancelledRequests = new Set();
// Accumulate full responses for history tracking
let responseAccumulators = new Map();
// Track heartbeat ports from content scripts while streams are active
let heartbeatPorts = new Set();
let streamStates = new Map();

// Configuration constants
const CONFIG = {
  REQUEST_TIMEOUT: 30000, // 30 seconds timeout for API requests
  CONTEXT_MENU_ID: "summarize-selection",
  OPENROUTER_RETRY_BACKOFF_MS: 1500
};

// DEFAULT_AZURE_API_VERSION, normalizeAzureResourceName, buildAzureApiUrl
// are provided by shared/azure-utils.js (loaded via importScripts above).

const ZAI_CODING_BASE_URL = 'https://api.z.ai/api/coding/paas/v4';
const ZAI_CODING_CHAT_COMPLETIONS_URL = ZAI_CODING_BASE_URL + '/chat/completions';

async function sendUiRecoveryMessages(tabId, uniqueId, infoMessage = '[Info] Request stopped by user.') {
  if (!tabId) return;
  try {
    await sendMessageSafely(tabId, { action: 'hideLoading', uniqueId });
    if (infoMessage) {
      await sendMessageSafely(tabId, {
        action: 'appendToFloatingWindow',
        content: infoMessage,
        uniqueId
      });
    }
    await sendMessageSafely(tabId, {
      action: 'chatUnlock',
      uniqueId,
      placeholderKey: 'placeholderFollowUp'
    });
  } catch (error) {
    console.log('[Background] UI recovery messaging failed:', error?.message || error);
  }
}

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== 'sSummarizer-stream-heartbeat') {
    return;
  }

  heartbeatPorts.add(port);

  port.onMessage.addListener((message) => {
    if (message?.type === 'heartbeat') {
      try {
        port.postMessage({
          type: 'heartbeatAck',
          uniqueId: message.uniqueId,
          ts: Date.now()
        });
      } catch (e) {
      }
    }
  });

  port.onDisconnect.addListener(() => {
    heartbeatPorts.delete(port);
  });
});

// ===== PROVIDER ADAPTERS =====
// Adapter objects for different API providers (OpenAI, Anthropic, Gemini)
// Each adapter provides: buildHeaders, transformRequest, parseStreamChunk, isStreamEnd

const OpenAIAdapter = {
  buildHeaders(apiKey) {
    return {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey.trim()}`
    };
  },

  transformRequest(messages, model, systemPrompt) {
    // OpenAI format: system message in messages array
    const formattedMessages = [];
    if (systemPrompt) {
      formattedMessages.push({ role: 'system', content: systemPrompt });
    }
    formattedMessages.push(...messages);
    return {
      model: model?.trim() || 'gpt-5.2',
      messages: formattedMessages,
      stream: true
    };
  },

  parseStreamChunk(jsonData) {
    // OpenAI: choices[0].delta.content for streaming
    if (jsonData.choices?.[0]?.delta?.content) {
      return jsonData.choices[0].delta.content;
    }
    // Non-streaming fallback
    if (jsonData.choices?.[0]?.message?.content && !jsonData.choices?.[0]?.delta) {
      return jsonData.choices[0].message.content;
    }
    return null;
  },

  parseReasoning(jsonData) {
    const reasoning = jsonData.choices?.[0]?.delta?.reasoning
      ?? jsonData.choices?.[0]?.delta?.reasoning_content
      ?? jsonData.choices?.[0]?.message?.reasoning
      ?? jsonData.choices?.[0]?.message?.reasoning_content;
    return typeof reasoning === 'string' && reasoning.length > 0 ? reasoning : null;
  },

  parseReasoningDetails(jsonData) {
    const reasoningDetails = jsonData.choices?.[0]?.delta?.reasoning_details
      ?? jsonData.choices?.[0]?.message?.reasoning_details;
    return Array.isArray(reasoningDetails) && reasoningDetails.length > 0 ? reasoningDetails : null;
  },

  isStreamEnd(data) {
    // OpenAI uses [DONE] signal (handled in processBuffer) or any non-null finish_reason
    return data === '[DONE]' || Boolean(data?.choices?.[0]?.finish_reason);
  }
};

const GLMAdapter = {
  buildHeaders(apiKey) {
    return {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey.trim()}`
    };
  },

  transformRequest(messages, model, systemPrompt) {
    const formattedMessages = [];
    if (systemPrompt) {
      formattedMessages.push({ role: 'system', content: systemPrompt });
    }
    formattedMessages.push(...messages);
    return {
      model: model?.trim() || 'glm-5',
      messages: formattedMessages,
      stream: true,
      thinking: { type: 'disabled' }
    };
  },

  parseStreamChunk(jsonData) {
    if (jsonData.choices?.[0]?.delta?.content) {
      return jsonData.choices[0].delta.content;
    }
    if (jsonData.choices?.[0]?.message?.content && !jsonData.choices?.[0]?.delta) {
      return jsonData.choices[0].message.content;
    }
    return null;
  },

  isStreamEnd(data) {
    return data === '[DONE]' || Boolean(data?.choices?.[0]?.finish_reason);
  }
};

const AnthropicAdapter = {
  buildHeaders(apiKey) {
    return {
      'Content-Type': 'application/json',
      'x-api-key': apiKey.trim(),
      'anthropic-version': '2023-06-01'
    };
  },

  transformRequest(messages, model, systemPrompt) {
    // Anthropic: system is a separate top-level field, not in messages
    // Messages must alternate user/assistant, no system role in messages
    const filteredMessages = messages.filter(m => m.role !== 'system');
    return {
      model: model?.trim() || 'claude-sonnet-4-6',
      system: systemPrompt || undefined,
      messages: filteredMessages,
      max_tokens: 4096,
      stream: true
    };
  },

  parseStreamChunk(jsonData) {
    // Anthropic: content_block_delta with delta.text
    if (jsonData.type === 'content_block_delta' && jsonData.delta?.text) {
      return jsonData.delta.text;
    }
    return null;
  },

  isStreamEnd(data) {
    // Anthropic: message_stop event or stop_reason
    return data?.type === 'message_stop' || data?.stop_reason;
  }
};

const AzureAdapter = {
  buildHeaders(apiKey) {
    return {
      'Content-Type': 'application/json',
      'api-key': apiKey.trim()
    };
  },

  transformRequest(messages, model, systemPrompt) {
    const formattedMessages = [];
    if (systemPrompt) {
      formattedMessages.push({ role: 'system', content: systemPrompt });
    }
    formattedMessages.push(...messages);

    const request = {
      messages: formattedMessages,
      stream: true
    };

    if (model?.trim()) {
      request.model = model.trim();
    }
    return request;
  },

  // Azure OpenAI uses the same SSE wire format as OpenAI — delegate shared parsing.
  parseStreamChunk(jsonData) { return OpenAIAdapter.parseStreamChunk(jsonData); },
  isStreamEnd(data) { return OpenAIAdapter.isStreamEnd(data); }
};

const GeminiAdapter = {
  buildHeaders(apiKey) {
    // Gemini uses x-goog-api-key header authentication
    return {
      'Content-Type': 'application/json',
      'x-goog-api-key': apiKey.trim()
    };
  },

  transformRequest(messages, model, systemPrompt) {
    // Gemini: uses contents array with parts structure
    // System prompt goes in systemInstruction field
    const contents = messages.map(msg => ({
      role: msg.role === 'assistant' ? 'model' : msg.role,
      parts: [{ text: msg.content }]
    }));

    const request = {
      contents: contents
    };

    if (systemPrompt) {
      request.systemInstruction = {
        parts: [{ text: systemPrompt }]
      };
    }

    return request;
  },

  parseStreamChunk(jsonData) {
    // Gemini: candidates[0].content.parts[0].text
    if (jsonData.candidates?.[0]?.content?.parts?.[0]?.text) {
      return jsonData.candidates[0].content.parts[0].text;
    }
    return null;
  },

  isStreamEnd(data) {
    // Gemini: finishReason in candidates
    return Boolean(data?.candidates?.[0]?.finishReason);
  }
};

function getAdapter(provider) {
  // Route based on provider name
  const providerLower = (provider || '').toLowerCase();

  if (providerLower.includes('anthropic') || providerLower.includes('claude')) {
    return AnthropicAdapter;
  }

  if (providerLower.includes('azure')) {
    return AzureAdapter;
  }

  if (providerLower.includes('gemini') || providerLower.includes('google')) {
    return GeminiAdapter;
  }

  if (providerLower.includes('glm')) {
    return GLMAdapter;
  }

  // Default to OpenAI (works for OpenAI, Azure, Groq, and other OpenAI-compatible APIs)
  return OpenAIAdapter;
}

function createStreamState(overrides = {}) {
  return {
    sawTerminal: false,
    sawDone: false,
    errorMessage: null,
    reasoning: '',
    reasoning_details: [],
    requestDiagnostics: null,
    recentEvents: [],
    resumeDeduper: null,
    ...overrides
  };
}

function getAssistantMessagePayload(uniqueId, fullResponse) {
  const streamState = streamStates.get(uniqueId);
  const assistantMessage = {
    role: 'assistant',
    content: fullResponse
  };

  if (streamState?.reasoning) {
    assistantMessage.reasoning = streamState.reasoning;
  }

  if (Array.isArray(streamState?.reasoning_details) && streamState.reasoning_details.length > 0) {
    assistantMessage.reasoning_details = streamState.reasoning_details;
  }

  return assistantMessage;
}

function clearStreamState(uniqueId) {
  streamStates.delete(uniqueId);
}

function truncateForLog(value, maxLength = 400) {
  if (typeof value !== 'string') {
    return value;
  }
  return value.length > maxLength ? `${value.slice(0, maxLength)}...` : value;
}

function summarizeMessageForDiagnostics(message) {
  const content = message?.content;
  return {
    role: message?.role || 'unknown',
    contentType: Array.isArray(content) ? 'array' : typeof content,
    contentLength: typeof content === 'string' ? content.length : Array.isArray(content) ? content.length : 0,
    hasReasoning: typeof message?.reasoning === 'string' && message.reasoning.length > 0,
    reasoningLength: typeof message?.reasoning === 'string' ? message.reasoning.length : 0,
    reasoningDetailsCount: Array.isArray(message?.reasoning_details) ? message.reasoning_details.length : 0,
    toolCallCount: Array.isArray(message?.tool_calls) ? message.tool_calls.length : 0
  };
}

function buildRequestDiagnostics({ uniqueId, providerKind, model, fetchUrl, requestBody, messages, openrouterDisableReasoning, isFollowUp, retryAttempt }) {
  return {
    uniqueId,
    providerKind,
    model: model?.trim() || null,
    fetchUrl,
    isFollowUp,
    retryAttempt,
    openrouterDisableReasoning: Boolean(openrouterDisableReasoning),
    requestBodyKeys: Object.keys(requestBody || {}),
    reasoningConfig: requestBody?.reasoning || null,
    messageCount: Array.isArray(messages) ? messages.length : 0,
    messageSummary: Array.isArray(messages) ? messages.map(summarizeMessageForDiagnostics) : []
  };
}

function appendStreamDiagnostic(uniqueId, entry) {
  const streamState = streamStates.get(uniqueId);
  if (!streamState) {
    return;
  }
  streamState.recentEvents.push({
    at: Date.now(),
    ...entry
  });
  if (streamState.recentEvents.length > 8) {
    streamState.recentEvents.shift();
  }
}

function logOpenRouterDiagnostics(label, details) {
  console.log(`[OpenRouter Diagnostics] ${label}`, details);
}

function cloneReasoningDetails(reasoningDetails) {
  return Array.isArray(reasoningDetails) ? reasoningDetails.map((detail) => ({ ...detail })) : [];
}

function buildContinuationRetryPrompt() {
  return 'Continue exactly from where you stopped. Do not restart, summarize, or repeat prior text unless needed to finish the interrupted sentence. Continue the existing answer only.';
}

function getPartialAssistantMessage(uniqueId) {
  const fullResponse = responseAccumulators.get(uniqueId) || '';
  return getAssistantMessagePayload(uniqueId, fullResponse);
}

function shouldRetryProviderOverload(errorResult, providerKind, retryAttempt, uniqueId) {
  const accumulatedResponse = responseAccumulators.get(uniqueId) || '';
  return (
    providerKind === 'openrouter' &&
    retryAttempt < 1 &&
    errorResult?.errorCode === 503 &&
    errorResult?.errorMetadata?.error_type === 'provider_overloaded' &&
    accumulatedResponse.trim().length > 0
  );
}

function applyResumeOverlapDedupe(uniqueId, chunk) {
  if (!chunk) {
    return chunk;
  }

  const streamState = streamStates.get(uniqueId);
  const resumeDeduper = streamState?.resumeDeduper;
  if (!resumeDeduper?.active) {
    return chunk;
  }

  resumeDeduper.pending += chunk;
  const { existingText, pending } = resumeDeduper;
  const maxOverlap = Math.min(existingText.length, pending.length);
  let overlapLength = 0;

  for (let i = maxOverlap; i > 0; i--) {
    if (existingText.endsWith(pending.slice(0, i))) {
      overlapLength = i;
      break;
    }
  }

  if (pending.length === overlapLength) {
    return '';
  }

  const dedupedChunk = pending.slice(overlapLength);
  resumeDeduper.active = false;
  resumeDeduper.pending = '';
  return dedupedChunk;
}

// ===== END PROVIDER ADAPTERS =====

// Initialize context menu on install/update
chrome.runtime.onInstalled.addListener(() => {
  setupContextMenu();
});

// Initialize context menu on startup
chrome.runtime.onStartup.addListener(() => {
  setupContextMenu();
});

// Update context menu when settings change
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && (changes.enableContextMenu || changes.slashCommands)) {
    setupContextMenu();
  }
});

// Handle context menu clicks
chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === CONFIG.CONTEXT_MENU_ID && info.selectionText) {
    // Existing: Summarize selection with default prompt
    handleIconClick(tab, info.selectionText).catch(err => {
      console.log('[Background] Context menu handler error:', err);
    });
  } else if (typeof info.menuItemId === 'string' && info.menuItemId.startsWith('slash-cmd-')) {
    // New: Slash command clicked from extension icon menu
    const index = parseInt(info.menuItemId.replace('slash-cmd-', ''), 10);

    chrome.storage.local.get(['slashCommands'], (result) => {
      const cmd = result.slashCommands?.[index];
      if (cmd) {
        handleIconClick(tab, null, cmd.prompt, cmd.command).catch(err => {
          console.log('[Background] Slash command handler error:', err);
        });
      } else {
        console.log('[Background] Slash command not found at index:', index);
      }
    });
  }
});

async function setupContextMenu() {
  const { enableContextMenu, slashCommands } = await chrome.storage.local.get(['enableContextMenu', 'slashCommands']);

  // Default to true if not set (undefined)
  const isEnabled = enableContextMenu ?? true;
  const commands = slashCommands || [];

  // Remove existing to avoid duplicates, then recreate
  await chrome.contextMenus.removeAll();

  chrome.contextMenus.create({
    id: "quick-commands-parent",
    title: chrome.i18n.getMessage('menuQuickCommands') || "Quick /slash Selection",
    contexts: ["action"]
  });

  if (commands.length > 0) {
    commands.forEach((cmd, index) => {
      chrome.contextMenus.create({
        id: `slash-cmd-${index}`,
        parentId: "quick-commands-parent",
        title: `/${cmd.command}`,
        contexts: ["action"]
      });
    });
  } else {
    chrome.contextMenus.create({
      id: "configure-commands",
      parentId: "quick-commands-parent",
      title: chrome.i18n.getMessage('menuConfigureCommands') || "Configure commands...",
      contexts: ["action"],
      enabled: false
    });
  }

  if (isEnabled) {
    chrome.contextMenus.create({
      id: CONFIG.CONTEXT_MENU_ID,
      title: chrome.i18n.getMessage('menuSummarizeSelection') || "Summarize selection",
      contexts: ["selection"]
    });
  }
}

// Add message listener for stopping API requests and handling follow-ups
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'stopApiRequest') {
    stopApiRequest(request.uniqueId, sender?.tab?.id).finally(() => {
      sendResponse({ success: true });
    });
    return true;
  } else if (request.action === 'submitFollowUp') {
    // Re-establish tab mapping if lost (e.g. due to Service Worker restart)
    if (sender.tab && sender.tab.id) {
      tabIdMap.set(request.uniqueId, sender.tab.id);
    }

    // Handle follow-up question
    makeApiCall(request.messages, request.uniqueId);
    sendResponse({ success: true });
  }
});

// Wrap click logic in its own async function so we can catch errors
chrome.action.onClicked.addListener((tab) => {
  handleIconClick(tab).catch(err => {
    console.log('[Background] handleIconClick error:', err);
  });
});

async function handleIconClick(tab, directTextContent = null, customPrompt = null, commandName = null) {
  // Validate tab and URL
  if (!tab || !tab.id || !tab.url) {
    console.log('[Background] Invalid tab object:', tab);
    return;
  }

  // Check if URL is processable
  if (tab.url.startsWith('chrome://') || tab.url.startsWith('chrome-extension://') || tab.url.startsWith('moz-extension://')) {
    return;
  }

  const uniqueId = Date.now() + Math.floor(Math.random() * 1000); // More unique ID (integer only)
  tabIdMap.set(uniqueId, tab.id);

  // Inject content.js FIRST before sending any messages
  try {
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ['content.js']
    });
  } catch (e) {
    console.log('[Background] Failed to inject content.js:', e.message);
    tabIdMap.delete(uniqueId);
    return;
  }

  try {
    await sendMessageSafely(tab.id, { action: 'createFloatingWindow', uniqueId, showLoading: true });
  } catch (error) {
    console.log('[Background] Failed to initialize UI:', error);
    tabIdMap.delete(uniqueId);
    return;
  }

  // If we have direct text (e.g. from context menu selection), skip scraping
  if (directTextContent) {
    makeApiCall(directTextContent, uniqueId, customPrompt, commandName);
    return;
  }

  // Determine which extractor to run
  let extractorFn;
  let errorContext;

  if (tab.url.includes('youtube.com/watch')) {
    const match = tab.url.match(/[?&]v=([^&]+)/);
    if (!match?.[1]) {
      handleApiError(uniqueId, 'Could not extract video ID from the URL.');
      return;
    }
    extractorFn = () => extractYouTubeCaptions();
    errorContext = 'YouTube video';
  } else if (tab.url.match(/reddit\.com\/r\/.*\/comments\//)) {
    extractorFn = () => extractRedditThread();
    errorContext = 'Reddit thread';
  } else {
    extractorFn = () => getPageContent();
    errorContext = 'page';
  }

  try {
    // Inject scraper, then run the extractor
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ['scripts/content-scraper.js']
    });

    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: extractorFn
    });

    const content = results?.[0]?.result;
    if (content && content.trim().length > 0) {
      makeApiCall(content, uniqueId, customPrompt, commandName);
    } else {
      handleApiError(uniqueId, `Could not extract content from this ${errorContext}.`);
    }
  } catch (err) {
    console.log('[Background] Content extraction error:', err.message);
    handleApiError(uniqueId, `Failed to extract ${errorContext} content: ${err.message}`);
  }
}

/**
 * Helper function to safely send messages to content script
 */
async function sendMessageSafely(tabId, message) {
  return new Promise((resolve, reject) => {
    chrome.tabs.sendMessage(tabId, message, (response) => {
      if (chrome.runtime.lastError) {
        // Only reject if it's a real error, not just "no response"
        if (chrome.runtime.lastError.message.includes('port closed') ||
          chrome.runtime.lastError.message.includes('Receiving end does not exist')) {
          reject(new Error(chrome.runtime.lastError.message));
        } else {
          resolve(null);
        }
      } else {
        resolve(response);
      }
    });
  });
}

// Note: YouTube transcript fetching is now handled entirely by the content script
// using the same approach as the Python youtube-transcript-api implementation

async function makeApiCall(inputData, uniqueId, customUserPrompt = null, commandName = null, retryOptions = {}) {
  const {
    preserveAccumulator = false,
    preservedOriginalContext = null,
    retryAttempt = 0,
    inheritedReasoning = '',
    inheritedReasoningDetails = [],
    resumeFromText = ''
  } = retryOptions;
  // Check if the request was explicitly cancelled
  if (cancelledRequests.has(uniqueId)) {
    cancelledRequests.delete(uniqueId);
    responseAccumulators.delete(uniqueId);
    return;
  }

  // Check if the window/request was already closed/cancelled
  const tabId = tabIdMap.get(uniqueId);
  if (!tabId) {
    cancelledRequests.delete(uniqueId);
    responseAccumulators.delete(uniqueId);
    return;
  }

  const {
    apiUrl,
    model,
    systemPrompt,
    timestampPrompt,
    apiKey,
    enableDebugMode,
    includeTimestamps,
    apiProvider,
    azureResource,
    azureDeployment,
    azureApiVersion,
    openrouterDisableReasoning
  } = await chrome.storage.local.get(
    ['apiUrl', 'model', 'systemPrompt', 'timestampPrompt', 'apiKey', 'enableDebugMode', 'includeTimestamps', 'apiProvider', 'azureResource', 'azureDeployment', 'azureApiVersion', 'openrouterDisableReasoning']
  );

  const adapter = getAdapter(apiProvider);
  const providerKind = (apiProvider || '').toLowerCase();
  let resolvedApiUrl;

  if (providerKind === 'azure') {
    resolvedApiUrl = buildAzureApiUrl({ apiUrl, azureResource, azureDeployment, azureApiVersion });
  } else if (providerKind === 'glm') {
    resolvedApiUrl = ZAI_CODING_CHAT_COMPLETIONS_URL;
  } else {
    resolvedApiUrl = (apiUrl || '').trim();
  }

  // Universal Debug Mode Check - intercept BEFORE any processing/truncation
  if (enableDebugMode) {
    const tab = tabIdMap.get(uniqueId);
    if (tab) {
      let debugContent = '';
      let rawInput = inputData;

      if (typeof inputData === 'string') {
        debugContent = inputData;
      } else if (Array.isArray(inputData)) {
        // For follow-ups, show the latest user message or full history
        debugContent = JSON.stringify(inputData, null, 2);
        rawInput = null; // Don't treat as original context string
      }

      let effectiveSystemPrompt = systemPrompt?.trim() || 'You are a helpful assistant that summarizes content concisely.';
      if (includeTimestamps && timestampPrompt) {
        effectiveSystemPrompt += '\n\n' + timestampPrompt.trim();
      }

      let payloadContent = debugContent;
      if (customUserPrompt && typeof inputData === 'string') {
        payloadContent = `[Custom Prompt]: ${customUserPrompt}\n\n[Extracted Content]:\n${debugContent}`;
      }

      await sendMessageSafely(tab, { action: 'hideLoading', uniqueId });

      const label = commandName ? `/${commandName}` : (customUserPrompt ? 'Custom Prompt' : 'Default Summary');

      await sendMessageSafely(tab, {
        action: 'appendToFloatingWindow',
        content: `**[DEBUG MODE]**\n\n**Action:** ${label}\n**Model:** ${model}\n**Target URL:** ${resolvedApiUrl}\n**System Prompt:**\n${effectiveSystemPrompt}\n\n**Content Payload (${payloadContent.length} chars):**\n\n${payloadContent}\n`,
        uniqueId
      });

      // Unlock chat if it was an initial request
      if (typeof inputData === 'string') {
        await sendMessageSafely(tab, {
          action: 'streamEnd',
          uniqueId,
          fullResponse: "[Debug Mode: No API Call Made]",
          originalContext: inputData
        });
      } else {
        await sendMessageSafely(tab, {
          action: 'chatUnlock',
          uniqueId,
          placeholderKey: 'placeholderFollowUp'
        });
      }
    }
    return;
  }

  // Determine if this is an initial request (string) or follow-up (array)
  let messages = [];
  let originalContext = preservedOriginalContext; // Only set for initial request

  let effectiveSystemPrompt = systemPrompt?.trim() || 'You are a helpful assistant that summarizes content concisely.';

  if (typeof inputData === 'string') {
    // Initial Summary Request
    const text = inputData;
    if (!text) {
      console.log('[API] Invalid text input');
      await handleApiError(uniqueId, 'Invalid text content');
      return;
    }

    const processedText = text.trim();

    // If this is a Quick Command, the custom prompt completely replaces the Default System Prompt
    if (customUserPrompt) {
      effectiveSystemPrompt = customUserPrompt;
    }

    // Retain the visual combination for the chat history, but the API gets them fully isolated
    const finalContent = customUserPrompt ? `${customUserPrompt}\n\n---\n\n${processedText}` : processedText;
    originalContext = finalContent;

    // If a custom user prompt (from a slash command) is provided, show it in the UI
    if (customUserPrompt) {
      const tab = tabIdMap.get(uniqueId);
      if (tab) {
        // Use slash command name if available, otherwise first line of prompt
        const label = commandName ? `/${commandName}` : customUserPrompt.split('\n')[0].substring(0, 50);
        const formattedPrompt = `\n**YOU:** ${label}${commandName ? '' : '...'}\n\n---\n`;
        sendMessageSafely(tab, {
          action: 'appendToFloatingWindow',
          content: formattedPrompt,
          uniqueId
        });
      }
    }

    messages = [
      { role: 'user', content: processedText }
    ];
  } else if (Array.isArray(inputData)) {
    // Follow-up Request
    // System prompt injection is handled by the provider adapters natively
    messages = [
      ...inputData
    ];
  } else {
    console.log('[API] Invalid input data type');
    return;
  }

  // Append timestamp instructions AFTER any custom prompt override
  if (includeTimestamps && timestampPrompt) {
    effectiveSystemPrompt += '\n\n' + timestampPrompt.trim();
  }

  // Validate configuration
  if (!resolvedApiUrl || !apiKey) {
    console.log('[API] API URL or API Key not set');
    await handleApiError(uniqueId, 'API URL or API Key not set. Please configure in extension options by right-clicking the extension icon.');
    return;
  }

  // Validate URL format and enforce HTTPS
  try {
    const parsedUrl = new URL(resolvedApiUrl);
    if (parsedUrl.protocol !== 'https:') {
      console.log('[API] Non-HTTPS API URL rejected:', resolvedApiUrl);
      await handleApiError(uniqueId, 'API URL must use HTTPS. Please reconfigure in extension options.');
      return;
    }
  } catch (e) {
    console.log('[API] Invalid API URL format:', resolvedApiUrl);
    await handleApiError(uniqueId, 'Invalid API URL format. Please check your configuration.');
    return;
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), CONFIG.REQUEST_TIMEOUT);

  // Store the abort controller for potential cancellation
  abortControllers.set(uniqueId, { controller, timeoutId, reader: null });

  // Initialize response accumulator
  if (!preserveAccumulator || !responseAccumulators.has(uniqueId)) {
    responseAccumulators.set(uniqueId, '');
  }
  streamStates.set(uniqueId, createStreamState({
    reasoning: inheritedReasoning,
    reasoning_details: cloneReasoningDetails(inheritedReasoningDetails),
    resumeDeduper: resumeFromText
      ? {
        active: true,
        existingText: resumeFromText,
        pending: ''
      }
      : null
  }));

  try {
    const requestBody = adapter.transformRequest(messages, model, effectiveSystemPrompt);

    if (providerKind === 'openrouter' && openrouterDisableReasoning) {
      requestBody.reasoning = { effort: 'none' };
    }

    let fetchUrl = resolvedApiUrl;
    const shouldForceGeminiUrl = providerKind === 'gemini';
    if (shouldForceGeminiUrl) {
      const geminiModel = model?.trim() || 'gemini-pro';
      fetchUrl = `https://generativelanguage.googleapis.com/v1beta/models/${geminiModel}:streamGenerateContent?alt=sse`;
    }

    const streamState = streamStates.get(uniqueId);
    if (streamState) {
      streamState.requestDiagnostics = buildRequestDiagnostics({
        uniqueId,
        providerKind,
        model,
        fetchUrl,
        requestBody,
        messages,
        openrouterDisableReasoning,
        isFollowUp: Array.isArray(inputData),
        retryAttempt
      });
    }

    if (providerKind === 'openrouter' && streamState?.requestDiagnostics) {
      logOpenRouterDiagnostics('request-start', streamState.requestDiagnostics);
    }

    const response = await fetch(fetchUrl, {
      method: 'POST',
      headers: adapter.buildHeaders(apiKey),
      body: JSON.stringify(requestBody),
      signal: controller.signal
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      const errorText = await response.text();
      console.log('[API] Error response body:', errorText);
      if (providerKind === 'openrouter') {
        logOpenRouterDiagnostics('http-error', {
          request: streamStates.get(uniqueId)?.requestDiagnostics || null,
          status: response.status,
          statusText: response.statusText,
          errorText: truncateForLog(errorText, 800)
        });
      }
      abortControllers.delete(uniqueId);
      throw new Error(`HTTP ${response.status}: ${response.statusText} - ${errorText.substring(0, 200)}`);
    }

    const tab = tabIdMap.get(uniqueId);
    if (!tab) {
      console.log('[API] No tab found for uniqueId:', uniqueId);
      abortControllers.delete(uniqueId);
      return;
    }

    if (!response.body) {
      throw new Error('Response body is not available for streaming');
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let buffer = '';

    // Store the reader so we can cancel it if needed
    const abortInfo = abortControllers.get(uniqueId);
    if (abortInfo) {
      abortInfo.reader = reader;
    }

    try {
      while (true) {
        // Check if request was aborted before reading next chunk
        const currentAbortInfo = abortControllers.get(uniqueId);
        if (!currentAbortInfo) {
          try { reader.cancel(); } catch (e) { /* already closed */ }
          break;
        }

        const { done, value } = await reader.read();
        if (done) {
          let processResult = null;
          if (buffer.length > 0) {
            processResult = processBuffer(buffer + '\n', uniqueId, adapter);
            buffer = processResult.buffer;
          }

          if (processResult?.errorMessage) {
            if (shouldRetryProviderOverload(processResult, providerKind, retryAttempt, uniqueId)) {
              const accumulatedResponse = responseAccumulators.get(uniqueId) || '';
              const currentStreamState = streamStates.get(uniqueId);
              const retryMessages = [
                ...messages,
                getPartialAssistantMessage(uniqueId),
                { role: 'user', content: buildContinuationRetryPrompt() }
              ];
              if (providerKind === 'openrouter') {
                logOpenRouterDiagnostics('auto-retry-continuation', {
                  request: currentStreamState?.requestDiagnostics || null,
                  recentEvents: currentStreamState?.recentEvents || [],
                  retryAttempt: retryAttempt + 1,
                  accumulatedResponseLength: accumulatedResponse.length
                });
              }
              clearStreamState(uniqueId);
              abortControllers.delete(uniqueId);
              cancelledRequests.delete(uniqueId);
              await new Promise((resolve) => setTimeout(resolve, CONFIG.OPENROUTER_RETRY_BACKOFF_MS));
              return makeApiCall(retryMessages, uniqueId, null, null, {
                preserveAccumulator: true,
                preservedOriginalContext: originalContext,
                retryAttempt: retryAttempt + 1,
                inheritedReasoning: currentStreamState?.reasoning || '',
                inheritedReasoningDetails: currentStreamState?.reasoning_details || [],
                resumeFromText: accumulatedResponse
              });
            }
            if (providerKind === 'openrouter') {
              logOpenRouterDiagnostics('stream-error-before-eof', {
                request: streamStates.get(uniqueId)?.requestDiagnostics || null,
                recentEvents: streamStates.get(uniqueId)?.recentEvents || [],
                errorMessage: processResult.errorMessage
              });
            }
            await handleApiError(uniqueId, processResult.errorMessage);
            clearStreamState(uniqueId);
            abortControllers.delete(uniqueId);
            cancelledRequests.delete(uniqueId);
            break;
          }

          const streamState = streamStates.get(uniqueId);
          if (!streamState?.sawTerminal) {
            if (providerKind === 'openrouter') {
              logOpenRouterDiagnostics('eof-without-terminal-marker', {
                request: streamState?.requestDiagnostics || null,
                recentEvents: streamState?.recentEvents || [],
                accumulatedResponseLength: (responseAccumulators.get(uniqueId) || '').length
              });
            }
            await sendUiRecoveryMessages(
              tab,
              uniqueId,
              '[Info] Stream interrupted before the provider sent a completion marker. You can ask a follow-up to continue.'
            );
            clearStreamState(uniqueId);
            abortControllers.delete(uniqueId);
            cancelledRequests.delete(uniqueId);
            responseAccumulators.delete(uniqueId);
            break;
          }

          const fullResponse = responseAccumulators.get(uniqueId) || '';
          await sendMessageSafely(tab, {
            action: 'streamEnd',
            uniqueId,
            fullResponse,
            originalContext,
            assistantMessage: getAssistantMessagePayload(uniqueId, fullResponse)
          });

          await sendMessageSafely(tab, { action: 'hideLoading', uniqueId });
          clearStreamState(uniqueId);
          abortControllers.delete(uniqueId);
          cancelledRequests.delete(uniqueId);
          responseAccumulators.delete(uniqueId);
          break;
        }
        buffer += decoder.decode(value, { stream: true });
        const processResult = processBuffer(buffer, uniqueId, adapter);
        buffer = processResult.buffer;

        if (processResult.shouldStop) {
          try { reader.cancel(); } catch (e) { /* already closed */ }

          if (processResult.stopReason === 'cancelled') {
            clearStreamState(uniqueId);
            break;
          }

          if (processResult.errorMessage) {
            if (shouldRetryProviderOverload(processResult, providerKind, retryAttempt, uniqueId)) {
              const accumulatedResponse = responseAccumulators.get(uniqueId) || '';
              const currentStreamState = streamStates.get(uniqueId);
              const retryMessages = [
                ...messages,
                getPartialAssistantMessage(uniqueId),
                { role: 'user', content: buildContinuationRetryPrompt() }
              ];
              if (providerKind === 'openrouter') {
                logOpenRouterDiagnostics('auto-retry-continuation', {
                  request: currentStreamState?.requestDiagnostics || null,
                  recentEvents: currentStreamState?.recentEvents || [],
                  retryAttempt: retryAttempt + 1,
                  accumulatedResponseLength: accumulatedResponse.length
                });
              }
              clearStreamState(uniqueId);
              abortControllers.delete(uniqueId);
              cancelledRequests.delete(uniqueId);
              await new Promise((resolve) => setTimeout(resolve, CONFIG.OPENROUTER_RETRY_BACKOFF_MS));
              return makeApiCall(retryMessages, uniqueId, null, null, {
                preserveAccumulator: true,
                preservedOriginalContext: originalContext,
                retryAttempt: retryAttempt + 1,
                inheritedReasoning: currentStreamState?.reasoning || '',
                inheritedReasoningDetails: currentStreamState?.reasoning_details || [],
                resumeFromText: accumulatedResponse
              });
            }
            if (providerKind === 'openrouter') {
              logOpenRouterDiagnostics('stream-error-mid-read', {
                request: streamStates.get(uniqueId)?.requestDiagnostics || null,
                recentEvents: streamStates.get(uniqueId)?.recentEvents || [],
                errorMessage: processResult.errorMessage
              });
            }
            await handleApiError(uniqueId, processResult.errorMessage);
          } else {
            if (providerKind === 'openrouter') {
              logOpenRouterDiagnostics('stream-stop-without-error', {
                request: streamStates.get(uniqueId)?.requestDiagnostics || null,
                recentEvents: streamStates.get(uniqueId)?.recentEvents || [],
                accumulatedResponseLength: (responseAccumulators.get(uniqueId) || '').length
              });
            }
            await sendUiRecoveryMessages(
              tab,
              uniqueId,
              '[Info] Stream interrupted before the provider sent a completion marker. You can ask a follow-up to continue.'
            );
            responseAccumulators.delete(uniqueId);
          }

          clearStreamState(uniqueId);
          abortControllers.delete(uniqueId);
          cancelledRequests.delete(uniqueId);
          break;
        }
      }
    } catch (error) {
      if (error.name === 'AbortError') {
        if (!cancelledRequests.has(uniqueId)) {
          if (providerKind === 'openrouter') {
            logOpenRouterDiagnostics('abort-error-during-stream', {
              request: streamStates.get(uniqueId)?.requestDiagnostics || null,
              recentEvents: streamStates.get(uniqueId)?.recentEvents || [],
              errorMessage: error.message
            });
          }
          await sendUiRecoveryMessages(
            tab,
            uniqueId,
            '[Info] Stream interrupted while waiting for more output. You can ask a follow-up to continue.'
          );
          responseAccumulators.delete(uniqueId);
        }
      } else {
        console.log('[API] Stream reading error:', error);
        if (providerKind === 'openrouter') {
          logOpenRouterDiagnostics('reader-exception', {
            request: streamStates.get(uniqueId)?.requestDiagnostics || null,
            recentEvents: streamStates.get(uniqueId)?.recentEvents || [],
            errorMessage: error.message,
            stack: truncateForLog(error.stack || '', 1200)
          });
        }
        await handleApiError(uniqueId, `Stream error: ${error.message}`);
      }
      clearStreamState(uniqueId);
      abortControllers.delete(uniqueId);
      cancelledRequests.delete(uniqueId);
    }
  } catch (err) {
    clearTimeout(timeoutId);
    if (providerKind === 'openrouter') {
      logOpenRouterDiagnostics('request-exception', {
        request: streamStates.get(uniqueId)?.requestDiagnostics || null,
        recentEvents: streamStates.get(uniqueId)?.recentEvents || [],
        errorMessage: err.message,
        stack: truncateForLog(err.stack || '', 1200)
      });
    }
    abortControllers.delete(uniqueId);
    clearStreamState(uniqueId);
    responseAccumulators.delete(uniqueId);
    console.log('[API] call error:', err);

    let errorMessage = 'API request failed';
    if (err.name === 'AbortError') {
      errorMessage = 'Request timed out. Please try again.';
    } else if (err.message.includes('HTTP')) {
      errorMessage = `API error: ${err.message}`;
    } else if (err.message.includes('fetch')) {
      errorMessage = 'Network error. Please check your connection.';
    }

    await handleApiError(uniqueId, errorMessage);
  }
}

/**
 * Stop an ongoing API request
 */
async function stopApiRequest(uniqueId, fallbackTabId = null) {

  // Mark request as cancelled to prevent future execution
  cancelledRequests.add(uniqueId);

  const abortInfo = abortControllers.get(uniqueId);
  if (abortInfo) {
    const { controller, timeoutId, reader } = abortInfo;

    // Abort the fetch request
    controller.abort();
    clearTimeout(timeoutId);

    // Cancel the stream reader if it exists
    if (reader) {
      try {
        reader.cancel();
      } catch (e) {
        // reader may already be closed — safe to ignore
      }
    }

    abortControllers.delete(uniqueId);
    clearStreamState(uniqueId);

    // Send notification to UI that request was stopped
    const tab = tabIdMap.get(uniqueId) || fallbackTabId;
    if (tab) {
      await sendUiRecoveryMessages(tab, uniqueId, '[Info] Request stopped by user.');
    }

    tabIdMap.delete(uniqueId);
    responseAccumulators.delete(uniqueId);
  } else {
    // Service worker may have restarted and lost in-memory state. Still recover the UI if possible.
    const tab = tabIdMap.get(uniqueId) || fallbackTabId;
    if (tab) {
      await sendUiRecoveryMessages(tab, uniqueId, '[Info] Request was interrupted or already ended.');
    }
    clearStreamState(uniqueId);
    tabIdMap.delete(uniqueId);
    responseAccumulators.delete(uniqueId);
  }

  // Clear the cancellation flag now that the stop has been fully handled.
  // The in-flight stream loop can exit via a non-throwing break (when the
  // abort lands between reads) without ever clearing this flag, which would
  // otherwise leak here and silently drop a later follow-up that reuses the
  // same uniqueId (makeApiCall returns early when the id is still cancelled).
  cancelledRequests.delete(uniqueId);
}

/**
 * Handle API errors consistently
 */
async function handleApiError(uniqueId, message) {
  // Clean up abort controller if it exists
  const abortInfo = abortControllers.get(uniqueId);
  if (abortInfo) {
    clearTimeout(abortInfo.timeoutId);
    abortControllers.delete(uniqueId);
  }
  clearStreamState(uniqueId);

  const tab = tabIdMap.get(uniqueId);
  if (tab) {
    try {
      await sendMessageSafely(tab, { action: 'hideLoading', uniqueId });
      await sendMessageSafely(tab, {
        action: 'appendToFloatingWindow',
        content: `[Error] ${message}`,
        uniqueId
      });
      await sendMessageSafely(tab, {
        action: 'chatUnlock',
        uniqueId,
        placeholderKey: 'placeholderFollowUp'
      });
    } catch (e) {
      console.log('[API] Failed to send error message to tab:', e);
    }
  }
  cancelledRequests.delete(uniqueId);
  responseAccumulators.delete(uniqueId);
  // tabIdMap entry intentionally kept — session stays open for user retries.
}

function processBuffer(buffer, uniqueId, adapter) {
  const abortInfo = abortControllers.get(uniqueId);
  if (!abortInfo) {
    return { buffer: '', shouldStop: true, stopReason: 'cancelled' };
  }

  const lines = buffer.split('\n');
  buffer = lines.pop();

  for (const line of lines) {
    if (!abortControllers.get(uniqueId)) {
      return { buffer: '', shouldStop: true, stopReason: 'cancelled' };
    }

    const trimmedLine = line.trim();
    if (!trimmedLine || trimmedLine.startsWith(':')) {
      continue;
    }

    if (!trimmedLine.startsWith('data:')) {
      continue;
    }

    const jsonLine = trimmedLine.substring(5).trim();
    if (!jsonLine) {
      continue;
    }

    if (jsonLine === '[DONE]') {
      const streamState = streamStates.get(uniqueId);
      if (streamState) {
        streamState.sawDone = true;
        streamState.sawTerminal = true;
      }
      appendStreamDiagnostic(uniqueId, { type: 'done' });
      continue;
    }

    const result = handleJsonLine(jsonLine, uniqueId, adapter);
    if (result?.errorMessage) {
      return { buffer: '', shouldStop: true, stopReason: 'error', ...result };
    }
  }

  return { buffer, shouldStop: false };
}

function handleJsonLine(jsonLine, uniqueId, adapter) {
  try {
    if (!jsonLine) return;

    const abortInfo = abortControllers.get(uniqueId);
    if (!abortInfo) {
      return;
    }

    const data = JSON.parse(jsonLine);
    const streamState = streamStates.get(uniqueId);
    if (!streamState) {
      return null;
    }

    if (data?.error?.message) {
      appendStreamDiagnostic(uniqueId, {
        type: 'error',
        errorCode: data.error.code || null,
        errorMessage: truncateForLog(data.error.message, 500),
        provider: data.provider || null,
        model: data.model || null,
        metadata: data.error.metadata || null
      });
      if (streamState.requestDiagnostics?.providerKind === 'openrouter') {
        logOpenRouterDiagnostics('sse-error-chunk', {
          request: streamState.requestDiagnostics,
          recentEvents: streamState.recentEvents,
          errorChunk: data
        });
      }
      streamState.errorMessage = `Stream error: ${data.error.message}`;
      streamState.sawTerminal = true;
      return {
        errorMessage: streamState.errorMessage,
        errorCode: data.error.code || null,
        errorMetadata: data.error.metadata || null,
        provider: data.provider || null,
        model: data.model || null
      };
    }

    const tab = tabIdMap.get(uniqueId);

    const rawContentChunk = adapter.parseStreamChunk(data);
    const contentChunk = applyResumeOverlapDedupe(uniqueId, rawContentChunk);
    const reasoningChunk = typeof adapter.parseReasoning === 'function' ? adapter.parseReasoning(data) : null;
    const reasoningDetails = typeof adapter.parseReasoningDetails === 'function' ? adapter.parseReasoningDetails(data) : null;
    appendStreamDiagnostic(uniqueId, {
      type: 'chunk',
      finishReason: data?.choices?.[0]?.finish_reason || null,
      hasContent: Boolean(rawContentChunk),
      contentLength: rawContentChunk?.length || 0,
      dedupedContentLength: contentChunk?.length || 0,
      hasReasoning: Boolean(reasoningChunk),
      reasoningLength: reasoningChunk?.length || 0,
      reasoningDetailsCount: Array.isArray(reasoningDetails) ? reasoningDetails.length : 0,
      provider: data?.provider || null,
      model: data?.model || null
    });

    if (tab && contentChunk) {
      chrome.tabs.sendMessage(tab, {
        action: 'appendToFloatingWindow',
        content: contentChunk,
        uniqueId
      }, () => {
        void chrome.runtime.lastError;
      });

      const current = responseAccumulators.get(uniqueId) || '';
      responseAccumulators.set(uniqueId, current + contentChunk);
    }

    if (reasoningChunk) {
      streamState.reasoning += reasoningChunk;
    }

    if (reasoningDetails) {
      streamState.reasoning_details.push(...reasoningDetails);
    }

    if (adapter.isStreamEnd(data)) {
      streamState.sawTerminal = true;
      if (data?.choices?.[0]?.finish_reason === 'error') {
        streamState.errorMessage = streamState.errorMessage || 'Stream error: The provider terminated the response unexpectedly.';
        return {
          errorMessage: streamState.errorMessage,
          errorCode: null,
          errorMetadata: null,
          provider: data?.provider || null,
          model: data?.model || null
        };
      }
    }
  } catch (e) {
    appendStreamDiagnostic(uniqueId, {
      type: 'parse-failure',
      message: e.message,
      rawLine: truncateForLog(jsonLine, 600)
    });
    const streamState = streamStates.get(uniqueId);
    if (streamState?.requestDiagnostics?.providerKind === 'openrouter') {
      logOpenRouterDiagnostics('json-parse-failure', {
        request: streamState.requestDiagnostics,
        recentEvents: streamState.recentEvents,
        parseError: e.message,
        rawLine: truncateForLog(jsonLine, 1000)
      });
    }
    console.warn('[API] Failed to parse JSON line:', e.message);
  }

  return null;
}
