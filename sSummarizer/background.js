// background.js - Chrome Extension Service Worker
// Handles URL content extraction and API communication for summarization

importScripts('shared/azure-utils.js', 'shared/error-utils.js', 'shared/default-prompts.js', 'shared/reasoning-utils.js');

// Handle expected AbortErrors from cancelled API requests
self.addEventListener('unhandledrejection', event => {
  if (event.reason && event.reason.name === 'AbortError') {
    // This is expected when we cancel API requests - suppress the error
    event.preventDefault();
  }
});

// Maps unique request IDs to tab IDs for tracking multiple concurrent requests
let tabIdMap = new Map();
// Each window owns one operation; late callbacks must retain their original owner.
let abortControllers = new Map();
let sessionOwners = new Map();
// Accumulate full responses for history tracking
let responseAccumulators = new Map();
// Track heartbeat ports from content scripts while streams are active
let heartbeatPorts = new Set();
let streamStates = new Map();

// Configuration constants
const CONFIG = {
  REQUEST_TIMEOUT: 120000, // Maximum wait without provider progress (headers or body bytes)
  CONTEXT_MENU_ID: "summarize-selection",
  MAX_RETRIES: 2
};

// DEFAULT_AZURE_API_VERSION, normalizeAzureResourceName, buildAzureApiUrl
// are provided by shared/azure-utils.js (loaded via importScripts above).

const ZAI_CODING_BASE_URL = 'https://api.z.ai/api/coding/paas/v4';
const ZAI_CODING_CHAT_COMPLETIONS_URL = ZAI_CODING_BASE_URL + '/chat/completions';

function beginOperation(uniqueId, tabId, operationId = crypto.randomUUID(), documentId = null) {
  const operation = { uniqueId, tabId, operationId, documentId, controller: new AbortController(), cancelled: false, settled: false, reader: null, timeoutId: null };
  abortControllers.set(uniqueId, operation);
  responseAccumulators.set(uniqueId, '');
  streamStates.set(uniqueId, createStreamState());
  return operation;
}

function ownsOperation(operation) {
  return operation && abortControllers.get(operation.uniqueId) === operation;
}

function assertOperation(operation) {
  if (!ownsOperation(operation) || operation.cancelled) throw new DOMException('Request cancelled', 'AbortError');
  operation.controller.signal.throwIfAborted();
}

function awaitOperation(operation, promise) {
  assertOperation(operation);
  return new Promise((resolve, reject) => {
    const signal = operation.controller.signal;
    const onAbort = () => reject(signal.reason);
    signal.addEventListener('abort', onAbort, { once: true });
    Promise.resolve(promise).then(resolve, reject).finally(() => signal.removeEventListener('abort', onAbort));
  });
}

function cancelOperation(operation) {
  if (!operation || operation.settled) return;
  operation.cancelled = true;
  operation.controller.abort();
  clearTimeout(operation.timeoutId);
  clearTimeout(operation.backoffId);
  if (operation.reader) void operation.reader.cancel().catch(() => {});
  if (operation.extracting) {
    const target = operation.documentId ? { tabId: operation.tabId, documentIds: [operation.documentId] } : { tabId: operation.tabId };
    void chrome.scripting.executeScript({
      target,
      func: operationId => { if (typeof cancelContentExtraction === 'function') cancelContentExtraction(operationId); },
      args: [operation.operationId]
    }).catch(() => {});
  }
}

function finishOperation(operation) {
  operation.settled = true;
  clearTimeout(operation.timeoutId);
  clearTimeout(operation.backoffId);
  if (operation.reader) {
    void operation.reader.cancel().catch(() => {});
    try { operation.reader.releaseLock(); } catch {}
    operation.reader = null;
  }
  if (ownsOperation(operation)) {
    abortControllers.delete(operation.uniqueId);
    streamStates.delete(operation.uniqueId);
    responseAccumulators.delete(operation.uniqueId);
  }
}

function resetRequestTimeout(operation) {
  clearTimeout(operation.timeoutId);
  operation.timeoutId = setTimeout(() => {
    operation.timedOut = true;
    operation.controller.abort();
    if (operation.reader) void operation.reader.cancel().catch(() => {});
  }, CONFIG.REQUEST_TIMEOUT);
}

async function sendOperationMessage(operation, message) {
  if (!ownsOperation(operation)) return;
  return sendMessageSafely(operation.tabId, { ...message, uniqueId: operation.uniqueId, operationId: operation.operationId }, operation);
}

async function sendUiRecoveryMessages(operation, infoMessage) {
  if (!ownsOperation(operation) || operation.notified || operation.consumerGone) return;
  operation.notified = true;
  flushResumeOverlap(operation.uniqueId);
  const state = streamStates.get(operation.uniqueId);
  const assistantMessage = getPartialAssistantMessage(operation.uniqueId);
  try {
    await sendOperationMessage(operation, { action: 'hideLoading' });
    if (infoMessage) await sendOperationMessage(operation, { action: 'appendToFloatingWindow', content: infoMessage });
    await sendOperationMessage(operation, { action: 'chatUnlock', placeholderKey: 'placeholderFollowUp', originalContext: operation.originalContext, assistantMessage, incomplete: true, finishReason: state?.finishReason || null, outcome: state?.outcome || 'interrupted' });
  } catch (error) {
    console.log('[Background] UI recovery messaging failed:', error?.message || error);
  }
}

function removeSession(uniqueId) {
  tabIdMap.delete(uniqueId);
  sessionOwners.delete(uniqueId);
  void chrome.storage.session.remove(`summarySession:${uniqueId}`).catch(() => {});
}

function cancelTabOperations(tabId) {
  for (const operation of abortControllers.values()) {
    if (operation.tabId === tabId) {
      operation.consumerGone = true;
      cancelOperation(operation);
    }
  }
  for (const [uniqueId, ownerTab] of tabIdMap) if (ownerTab === tabId) removeSession(uniqueId);
  // Include sessions restored after a worker restart.
  void chrome.storage.session.get(null).then(sessions => {
    for (const [key, owner] of Object.entries(sessions)) {
      if (key.startsWith('summarySession:') && owner.tabId === tabId && !sessionOwners.has(Number(key.slice('summarySession:'.length)))) {
        void chrome.storage.session.remove(key);
      }
    }
  }).catch(() => {});
}

chrome.tabs.onRemoved.addListener(cancelTabOperations);

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== 'sSummarizer-stream-heartbeat') {
    return;
  }

  heartbeatPorts.add(port);
  let heartbeatIdentity;

  port.onMessage.addListener((message) => {
    if (message?.type === 'heartbeat') {
      heartbeatIdentity = { uniqueId: message.uniqueId, operationId: message.operationId };
      try {
        port.postMessage({
          type: 'heartbeatAck',
          uniqueId: message.uniqueId,
          operationId: message.operationId,
          ts: Date.now()
        });
      } catch (e) {
      }
    }
  });

  port.onDisconnect.addListener(() => {
    heartbeatPorts.delete(port);
    const operation = abortControllers.get(heartbeatIdentity?.uniqueId);
    if (operation?.operationId === heartbeatIdentity?.operationId && operation.tabId === port.sender?.tab?.id &&
        (!operation.documentId || operation.documentId === port.sender?.documentId) && !operation.notified) {
      operation.consumerGone = true;
      cancelOperation(operation);
      removeSession(operation.uniqueId);
    }
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
      'anthropic-version': '2023-06-01',
      // Extension requests carry a chrome-extension:// Origin; Anthropic requires this opt-in for them.
      'anthropic-dangerous-direct-browser-access': 'true'
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
      // Claude 3 / 3.5 models reject larger values (4096 for most Claude 3); newer models allow far more.
      max_tokens: /^claude-3(?:-5)?-/i.test(model?.trim() || '') ? 4096 : 16000,
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
    // message_delta carries the outcome; message_stop ends trailing metadata.
    return data?.type === 'message_stop';
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
    return jsonData.candidates?.[0]?.content?.parts?.filter(part => !part.thought && typeof part.text === 'string').map(part => part.text).join('') || null;
  },

  isStreamEnd(data) {
    // Gemini: finishReason in candidates
    return Boolean(data?.candidates?.[0]?.finishReason || data?.promptFeedback?.blockReason);
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

// Build the effective system prompt sent to the provider.
// The user's system prompt holds the hard rules and stays on top; an optional
// slash-command prompt is layered beneath it (combine, not replace), and the
// timestamp instructions are appended last when enabled. This is the single
// place that defines `system = systemPrompt + slashCommandPrompt (+ timestamps)`.
function composeSystemPrompt({ systemPrompt, slashCommandPrompt, includeTimestamps, timestampPrompt }) {
  const base = (systemPrompt || '').trim() || 'You are a helpful assistant that summarizes content concisely.';
  const parts = [base];

  const slash = (slashCommandPrompt || '').trim();
  if (slash) {
    parts.push(slash);
  }

  let combined = parts.join('\n\n');

  if (includeTimestamps && (timestampPrompt || '').trim()) {
    combined += '\n\n' + timestampPrompt.trim();
  }

  return combined;
}

function createStreamState(overrides = {}) {
  return {
    sawTerminal: false,
    sawDone: false,
    errorMessage: null,
    reasoning: '',
    reasoning_details: [],
    reasoningDetailsStart: 0,
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
  // Saved custom URLs may carry credentials or tokens; log only the endpoint shape.
  const { origin, pathname } = new URL(fetchUrl);
  return {
    uniqueId,
    providerKind,
    model: model?.trim() || null,
    fetchUrl: origin + pathname,
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

function logDiagnostics(label, details) {
  console.log(`[sSummarizer Diagnostics] ${label}`, details);
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

// Transient unless a deterministic client error; null/string codes count as transient.
function isRetryableStatus(status) {
  return !(status >= 400 && status < 500) || [408, 409, 429].includes(status);
}

function applyResumeOverlapDedupe(uniqueId, chunk, flush = false) {
  const deduper = streamStates.get(uniqueId)?.resumeDeduper;
  if (!deduper?.active) return chunk || '';
  deduper.pending += chunk || '';
  const { existingText, pending } = deduper;
  // Wait while this prefix could still grow into a longer suffix match.
  if (!flush && existingText.slice(0, -1).includes(pending)) return '';
  let overlap = Math.min(existingText.length, pending.length);
  while (overlap > 0 && !existingText.endsWith(pending.slice(0, overlap))) overlap--;
  deduper.active = false;
  deduper.pending = '';
  return pending.slice(overlap);
}

function appendResponseChunk(uniqueId, content) {
  const operation = abortControllers.get(uniqueId);
  if (!content || !operation) return;
  responseAccumulators.set(uniqueId, (responseAccumulators.get(uniqueId) || '') + content);
  void sendOperationMessage(operation, { action: 'appendToFloatingWindow', content, isDelta: true }).catch(() => {});
}

function flushResumeOverlap(uniqueId) {
  appendResponseChunk(uniqueId, applyResumeOverlapDedupe(uniqueId, '', true));
}

function recordFinishReason(state, data) {
  const reason = data?.choices?.[0]?.finish_reason ?? data?.delta?.stop_reason ?? data?.stop_reason ??
    data?.candidates?.[0]?.finishReason ?? data?.promptFeedback?.blockReason;
  if (!reason) return;
  state.finishReason = reason;
  if (['stop', 'STOP', 'end_turn', 'stop_sequence'].includes(reason)) {
    state.outcome = 'complete';
  } else if (['length', 'max_tokens', 'MAX_TOKENS', 'model_context_window_exceeded'].includes(reason)) {
    state.outcome = 'truncated';
    state.errorMessage = `The provider stopped at its output or context limit (${reason}). The answer is incomplete; you can ask a follow-up to continue.`;
  } else if (data?.promptFeedback?.blockReason || ['content_filter', 'refusal', 'SAFETY', 'RECITATION', 'BLOCKLIST', 'PROHIBITED_CONTENT', 'SPII', 'IMAGE_SAFETY', 'IMAGE_PROHIBITED_CONTENT'].includes(reason)) {
    state.outcome = 'blocked';
    state.errorMessage = `The provider blocked this response (${reason}).`;
  } else {
    state.outcome = 'failed';
    state.errorMessage = `The provider ended the response with ${reason}. The answer may be incomplete.`;
  }
}

function validFollowUpMessages(messages) {
  return Array.isArray(messages) && messages.length > 0 &&
    messages[messages.length - 1]?.role === 'user' &&
    messages.every(message => message && ['user', 'assistant'].includes(message.role) &&
      typeof message.content === 'string' &&
      (message.reasoning === undefined || typeof message.reasoning === 'string') &&
      (message.reasoning_details === undefined || (Array.isArray(message.reasoning_details) &&
        message.reasoning_details.every(detail => detail && typeof detail === 'object' && !Array.isArray(detail) &&
          typeof detail.type === 'string'))));
}

// ===== END PROVIDER ADAPTERS =====

// Initialize context menu on install/update; seed built-in defaults on fresh install
chrome.runtime.onInstalled.addListener((details) => {
  if (details?.reason === 'install') {
    seedDefaultSettings().catch(err => console.log('[Background] seedDefaultSettings error:', err));
  }
  queueContextMenuSetup();
});

// On a fresh install, pre-populate the built-in system prompt, timestamp prompt, and
// starter slash commands so the defaults are active without the user having to click
// "Use Default". Each key is only written when absent, so existing data is never
// clobbered (and re-running this is a no-op).
async function seedDefaultSettings() {
  const existing = await chrome.storage.local.get(['systemPrompt', 'timestampPrompt', 'slashCommands']);
  const toSet = {};

  if (existing.systemPrompt === undefined || existing.systemPrompt === '') {
    toSet.systemPrompt = DEFAULT_SYSTEM_PROMPT;
  }
  if (existing.timestampPrompt === undefined) {
    toSet.timestampPrompt = DEFAULT_TIMESTAMP_PROMPT;
  }
  if (!Array.isArray(existing.slashCommands) || existing.slashCommands.length === 0) {
    // Deep-clone so the seeded objects are independent of the shared constant.
    toSet.slashCommands = DEFAULT_SLASH_COMMANDS.map(cmd => ({ ...cmd }));
  }

  if (Object.keys(toSet).length > 0) {
    await chrome.storage.local.set(toSet);
  }
}

// Initialize context menu on startup
chrome.runtime.onStartup.addListener(() => {
  queueContextMenuSetup();
});

// Update context menu when settings change
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && (changes.enableContextMenu || changes.slashCommands)) {
    queueContextMenuSetup();
  }
});

// Serialize setupContextMenu() runs. Two separate storage writes
// (enableContextMenu and slashCommands are saved independently) can fire
// onChanged close together; without serialization the concurrent runs
// interleave around the awaited removeAll() and create() throws a
// duplicate-id error for "quick-commands-parent".
let contextMenuSetupChain = Promise.resolve();
function queueContextMenuSetup() {
  contextMenuSetupChain = contextMenuSetupChain
    .then(() => setupContextMenu())
    .catch(err => console.log('[Background] setupContextMenu error:', err));
  return contextMenuSetupChain;
}

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
  if (!request || !['stopApiRequest', 'submitFollowUp'].includes(request.action)) return;
  if (sender?.id !== chrome.runtime.id || !Number.isInteger(sender.tab?.id) || sender.frameId !== 0 ||
      !Number.isSafeInteger(request.uniqueId) || typeof request.operationId !== 'string' || !request.operationId ||
      (request.action === 'submitFollowUp' && !validFollowUpMessages(request.messages))) {
    sendResponse({ success: false, error: 'Invalid request or sender.' });
    return;
  }
  const active = abortControllers.get(request.uniqueId);
  if (request.action === 'stopApiRequest') {
    if (active && (active.tabId !== sender.tab.id || active.operationId !== request.operationId ||
        (active.documentId && active.documentId !== sender.documentId))) {
      sendResponse({ success: false, error: 'Request does not own this operation.' });
      return;
    }
    if (active) {
      stopApiRequest(request.uniqueId, sender.tab.id, request.operationId, request.closeWindow === true)
        .then(() => sendResponse({ success: true }), () => sendResponse({ success: false }));
    } else {
      const key = `summarySession:${request.uniqueId}`;
      chrome.storage.session.get(key).then(async saved => {
        const owner = sessionOwners.get(request.uniqueId) || saved[key];
        if (!owner || owner.tabId !== sender.tab.id || owner.lastOperationId !== request.operationId ||
            (owner.documentId && owner.documentId !== sender.documentId)) {
          sendResponse({ success: false, error: 'Unknown session.' });
          return;
        }
        await stopApiRequest(request.uniqueId, sender.tab.id, request.operationId, request.closeWindow === true);
        sendResponse({ success: true });
      }).catch(() => sendResponse({ success: false }));
    }
    return true;
  }
  if (active && !active.cancelled && !active.settled) {
    sendResponse({ success: false, error: 'A request is already running.' });
    return;
  }
  // Reserve before storage awaits so Stop can cancel even restored sessions.
  const operation = beginOperation(request.uniqueId, sender.tab.id, request.operationId, sender.documentId);
  (async () => {
    try {
      const key = `summarySession:${request.uniqueId}`;
      const owner = sessionOwners.get(request.uniqueId) || (await awaitOperation(operation, chrome.storage.session.get(key)))[key];
      assertOperation(operation);
      if (!owner || owner.tabId !== sender.tab.id || (owner.documentId && owner.documentId !== sender.documentId) || owner.lastOperationId === request.operationId) {
        throw new Error('Request does not own this session.');
      }
      owner.lastOperationId = request.operationId;
      sessionOwners.set(request.uniqueId, owner);
      await awaitOperation(operation, chrome.storage.session.set({ [key]: owner }));
      assertOperation(operation);
      tabIdMap.set(request.uniqueId, sender.tab.id);
      sendResponse({ success: true });
      await makeApiCall(request.messages, request.uniqueId, null, null, { operation });
    } catch (error) {
      sendResponse({ success: false, error: operation.cancelled ? 'Request stopped.' : error.message });
      await operation.recoveryPromise;
      finishOperation(operation);
    }
  })();
  return true;
});

// Wrap click logic in its own async function so we can catch errors.
// If a slash command is flagged as the default, the toolbar-icon click runs it
// (its prompt is combined with the hard-rules system prompt); otherwise the plain
// system prompt is used.
chrome.action.onClicked.addListener((tab) => {
  chrome.storage.local.get(['slashCommands'], (result) => {
    const commands = Array.isArray(result.slashCommands) ? result.slashCommands : [];
    const defaultCommand = commands.find(cmd => cmd && cmd.isDefault && cmd.command && cmd.prompt);

    const clickPromise = defaultCommand
      ? handleIconClick(tab, null, defaultCommand.prompt, defaultCommand.command)
      : handleIconClick(tab);

    clickPromise.catch(err => {
      console.log('[Background] handleIconClick error:', err);
    });
  });
});

// Tabs that already have a summary starting or streaming, so a double click does not
// open a second window and pay for a second request.
const busyTabs = new Set();

// Pages the extension cannot inject into (internal pages, the Web Store, the PDF viewer).
function isRestrictedUrl(url) {
  if (/^(chrome|chrome-extension|chrome-untrusted|chrome-search|moz-extension|edge|about|view-source|devtools):/i.test(url)) return true;
  try {
    const { hostname, pathname } = new URL(url);
    return hostname === 'chromewebstore.google.com' ||
      (hostname === 'chrome.google.com' && pathname.startsWith('/webstore'));
  } catch {
    return false;
  }
}

// Show a short "!" on the toolbar icon so a click that cannot work is not silent.
function flashUnavailableBadge(tabId) {
  try {
    chrome.action.setBadgeBackgroundColor({ color: '#d93025', tabId });
    chrome.action.setBadgeText({ text: '!', tabId });
    setTimeout(() => {
      try { chrome.action.setBadgeText({ text: '', tabId }); } catch {}
    }, 4000);
  } catch {}
}

// Returns { videoId } for a YouTube watch or Shorts page, otherwise null.
function parseYouTubeVideoUrl(url) {
  try {
    const { hostname, pathname, searchParams } = new URL(url);
    if (!/^(?:www\.|m\.|music\.)?youtube\.com$/i.test(hostname)) return null;
    if (pathname === '/watch') return { videoId: searchParams.get('v') || '' };
    const shorts = pathname.match(/^\/shorts\/([^/]+)/);
    return shorts ? { videoId: shorts[1] } : null;
  } catch {
    return null;
  }
}

async function handleIconClick(tab, directTextContent = null, customPrompt = null, commandName = null) {
  if (!tab || !Number.isInteger(tab.id) || !tab.url) return;
  if (isRestrictedUrl(tab.url)) {
    flashUnavailableBadge(tab.id);
    return;
  }
  if (busyTabs.has(tab.id)) return;
  busyTabs.add(tab.id);
  try {
    await runIconClick(tab, directTextContent, customPrompt, commandName);
  } finally {
    busyTabs.delete(tab.id);
  }
}

async function runIconClick(tab, directTextContent, customPrompt, commandName) {
  const uniqueId = Date.now() + Math.floor(Math.random() * 1000);
  const operation = beginOperation(uniqueId, tab.id);
  tabIdMap.set(uniqueId, tab.id);
  try {
    const injection = await awaitOperation(operation, chrome.scripting.executeScript({
      target: { tabId: tab.id }, files: ['shared/reasoning-utils.js', 'content.js']
    }));
    assertOperation(operation);
    operation.documentId = injection?.[0]?.documentId || null;
    const owner = { tabId: tab.id, documentId: operation.documentId, lastOperationId: operation.operationId };
    sessionOwners.set(uniqueId, owner);
    await awaitOperation(operation, chrome.storage.session.set({ [`summarySession:${uniqueId}`]: owner }));
    const ready = await sendOperationMessage(operation, { action: 'createFloatingWindow', showLoading: true });
    assertOperation(operation);
    if (!ready?.success) throw new Error(ready?.error || 'Could not initialize the summary window.');
    operation.uiReady = true;
    if (directTextContent) {
      await makeApiCall(directTextContent, uniqueId, customPrompt, commandName, { operation });
      return;
    }
    let extractorFn, errorContext;
    const youTube = parseYouTubeVideoUrl(tab.url);
    if (youTube) {
      if (!youTube.videoId) throw new Error('Could not extract video ID from the URL.');
      extractorFn = (operationId) => extractYouTubeCaptions(operationId);
      errorContext = 'YouTube video';
    } else if (tab.url.match(/reddit\.com\/r\/.*\/comments\//)) {
      extractorFn = (operationId) => extractRedditThread(operationId);
      errorContext = 'Reddit thread';
    } else {
      extractorFn = () => getPageContent();
      errorContext = 'page';
    }
    const target = operation.documentId ? { tabId: tab.id, documentIds: [operation.documentId] } : { tabId: tab.id };
    await awaitOperation(operation, chrome.scripting.executeScript({ target, files: ['scripts/content-scraper.js'] }));
    assertOperation(operation);
    operation.extracting = true;
    const results = await awaitOperation(operation, chrome.scripting.executeScript({
      target, func: extractorFn, args: [operation.operationId]
    }));
    operation.extracting = false;
    assertOperation(operation);
    const content = results?.[0]?.result;
    if (typeof content !== 'string' || !content.trim()) throw new Error(`Could not extract content from this ${errorContext}.`);
    await makeApiCall(content, uniqueId, customPrompt, commandName, { operation });
  } catch (error) {
    if (!operation.cancelled && ownsOperation(operation)) {
      if (operation.uiReady) await handleApiError(uniqueId, error.message, operation);
      else {
        console.log('[Background] Failed to initialize UI:', error.message);
        removeSession(uniqueId);
        flashUnavailableBadge(tab.id);
      }
    }
  } finally {
    await operation.recoveryPromise;
    if (!operation.settled) finishOperation(operation);
  }
}

/**
 * Helper function to safely send messages to content script
 */
async function sendMessageSafely(tabId, message, operation = null) {
  return new Promise((resolve, reject) => {
    const callback = response => {
      const error = chrome.runtime.lastError;
      if (response?.stale && ownsOperation(operation) && !operation.notified) {
        operation.consumerGone = true;
        cancelOperation(operation);
        removeSession(operation.uniqueId);
      }
      if (error) {
        if (ownsOperation(operation) && /Receiving end does not exist|No tab with id|No document with id|port closed|message port closed/i.test(error.message)) {
          operation.consumerGone = true;
          cancelOperation(operation);
          removeSession(operation.uniqueId);
        }
        reject(new Error(error.message));
      } else {
        resolve(response);
      }
    };
    if (operation?.documentId) chrome.tabs.sendMessage(tabId, message, { documentId: operation.documentId }, callback);
    else chrome.tabs.sendMessage(tabId, message, callback);
  });
}

// Note: YouTube transcript fetching is now handled entirely by the content script
// using the same approach as the Python youtube-transcript-api implementation

async function makeApiCall(inputData, uniqueId, customUserPrompt = null, commandName = null, options = {}) {
  const tabId = tabIdMap.get(uniqueId);
  if (tabId == null) return;
  const operation = options.operation || beginOperation(uniqueId, tabId, options.operationId);
  let providerKind = '', resolvedApiUrl = '';
  try {
    assertOperation(operation);
    let messages;
    if (typeof inputData === 'string' && inputData.trim()) {
      const content = inputData.trim();
      operation.originalContext = customUserPrompt ? `${customUserPrompt}\n\n---\n\n${content}` : content;
      messages = [{ role: 'user', content }];
    } else if (validFollowUpMessages(inputData)) {
      messages = inputData;
    } else {
      throw new Error('Invalid text content or conversation history');
    }
    await sendOperationMessage(operation, { action: 'streamStart', originalContext: operation.originalContext || null });
    assertOperation(operation);
    const settings = await awaitOperation(operation, chrome.storage.local.get(
      ['apiUrl', 'model', 'systemPrompt', 'timestampPrompt', 'apiKey', 'enableDebugMode', 'includeTimestamps', 'apiProvider', 'azureResource', 'azureDeployment', 'azureApiVersion', 'openrouterDisableReasoning']
    ));
    assertOperation(operation);
    const { apiUrl, model, systemPrompt, timestampPrompt, apiKey, enableDebugMode, includeTimestamps, apiProvider,
      azureResource, azureDeployment, azureApiVersion, openrouterDisableReasoning } = settings;
    const adapter = getAdapter(apiProvider);
    providerKind = (apiProvider || '').toLowerCase();
    resolvedApiUrl = providerKind === 'azure' ? buildAzureApiUrl({ apiUrl, azureResource, azureDeployment, azureApiVersion })
      : providerKind === 'glm' ? ZAI_CODING_CHAT_COMPLETIONS_URL : (apiUrl || '').trim();
    const effectiveSystemPrompt = composeSystemPrompt({
      systemPrompt, slashCommandPrompt: typeof inputData === 'string' ? customUserPrompt : null, includeTimestamps, timestampPrompt
    });
    if (enableDebugMode) {
      const debugContent = typeof inputData === 'string' ? inputData : JSON.stringify(inputData, null, 2);
      const label = commandName ? `/${commandName}` : customUserPrompt ? 'Custom Prompt' : 'Default Summary';
      await sendOperationMessage(operation, { action: 'appendToFloatingWindow', content:
        `**[DEBUG MODE]**\n\n**Action:** ${label}\n**Model:** ${model}\n**Target URL:** ${resolvedApiUrl}\n**System Prompt:**\n${effectiveSystemPrompt}\n\n**Content Payload (${debugContent.length} chars):**\n\n${debugContent}\n` });
      await sendUiRecoveryMessages(operation, null);
      return;
    }
    if (!resolvedApiUrl || !apiKey?.trim()) {
      throw new Error('API URL or API Key not set. Please configure in extension options by right-clicking the extension icon.');
    }
    let parsedUrl;
    try { parsedUrl = new URL(resolvedApiUrl); } catch { throw new Error('Invalid API URL format. Please check your configuration.'); }
    if (parsedUrl.protocol !== 'https:') throw new Error('API URL must use HTTPS. Please reconfigure in extension options.');
    if (customUserPrompt) {
      const label = commandName ? `/${commandName}` : customUserPrompt.split('\n')[0].substring(0, 50);
      await sendOperationMessage(operation, { action: 'appendToFloatingWindow', content: `\n**YOU:** ${label}${commandName ? '' : '...'}\n\n---\n` });
    }
    // Accept ids copied from ListModels ("models/gemini-...") and keep odd characters out of the URL path.
    const geminiModel = (model || '').trim().replace(/^models\//, '') || 'gemini-flash-latest';
    const fetchUrl = providerKind === 'gemini'
      ? `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(geminiModel)}:streamGenerateContent?alt=sse`
      : resolvedApiUrl;
    // Every retry is rebuilt from this base so continuations never duplicate earlier output.
    const baseMessages = messages;
    for (let attempt = 0; ; attempt++) {
      assertOperation(operation);
      const state = streamStates.get(uniqueId);
      // Provider boundary: drop local-only metadata (partial reasoning poisons follow-ups) and
      // merge same-role turns (strict providers reject [user, user] after a failed answer).
      const providerMessages = messages.reduce((out, { role, content }) => {
        const last = out.at(-1);
        if (last?.role === role) last.content += `\n\n${content}`;
        else out.push({ role, content });
        return out;
      }, []);
      const requestBody = adapter.transformRequest(providerMessages, model, effectiveSystemPrompt);
      if (providerKind === 'openrouter' && openrouterDisableReasoning) requestBody.reasoning = { effort: 'none' };
      state.requestDiagnostics = buildRequestDiagnostics({ uniqueId, providerKind, model, fetchUrl, requestBody, messages: providerMessages, openrouterDisableReasoning, isFollowUp: Array.isArray(inputData), retryAttempt: attempt });
      logDiagnostics('request-start', state.requestDiagnostics);
      let failure = null, result = null;
      resetRequestTimeout(operation);
      try {
        const response = await awaitOperation(operation, fetch(fetchUrl, {
          method: 'POST', headers: adapter.buildHeaders(apiKey), body: JSON.stringify(requestBody), signal: operation.controller.signal
        }));
        assertOperation(operation);
        resetRequestTimeout(operation); // Response headers are provider progress too.
        const contentType = response.headers.get('content-type') || '';
        if (!response.ok) {
          let errorText = '';
          try { errorText = await awaitOperation(operation, response.text()); } catch (error) {
            if (operation.cancelled || !ownsOperation(operation)) throw error;
          }
          const retryAfter = response.headers.get('retry-after');
          failure = { kind: 'http', status: response.status, retryAfter, retryable: isRetryableStatus(response.status),
            message: formatHttpError({ status: response.status, statusText: response.statusText, body: errorText, providerKind, retryAfter }) };
        } else if (/application\/json/i.test(contentType) && !/event-stream/i.test(contentType)) {
          // A JSON body on a stream request is a provider error or ignored `stream`; surface its text.
          const detail = extractProviderErrorDetail(await awaitOperation(operation, response.text()));
          failure = { kind: 'non-streaming', message: `The provider returned a non-streaming response.${detail.message ? ` Provider said: ${detail.message}` : ''}` };
        } else {
          if (!response.body) throw new Error('Response body is not available for streaming');
          const reader = operation.reader = response.body.getReader();
          const decoder = new TextDecoder();
          let buffer = '';
          while (!state.sawTerminal) {
            const { done, value } = await awaitOperation(operation, reader.read());
            assertOperation(operation);
            if (value?.byteLength) {
              resetRequestTimeout(operation);
              buffer += decoder.decode(value, { stream: true });
            }
            if (done) buffer += decoder.decode();
            result = processBuffer(buffer, uniqueId, adapter);
            buffer = result.buffer;
            if (result.errorMessage || result.shouldStop || done) break;
          }
          const message = result?.errorMessage || state.errorMessage;
          if (message) {
            failure = { kind: 'stream', code: result?.errorCode ?? state.finishReason ?? null, message,
              retryable: Boolean(result?.retryable) || state.finishReason === 'error' };
          } else if (!state.sawTerminal) {
            failure = { kind: 'eof', retryable: true, info: true,
              message: 'Stream interrupted before the provider sent a completion marker. You can ask a follow-up to continue.' };
          }
        }
      } catch (error) {
        if (operation.cancelled || operation.timedOut || !ownsOperation(operation) || !isNetworkError(error)) throw error;
        failure = { kind: 'network', retryable: true, message: formatNetworkError(error, { providerKind, apiUrl: resolvedApiUrl }) };
      } finally {
        clearTimeout(operation.timeoutId);
        if (operation.reader) {
          void operation.reader.cancel().catch(() => {});
          try { operation.reader.releaseLock(); } catch {}
          operation.reader = null;
        }
      }
      if (operation.cancelled || !ownsOperation(operation)) return;
      flushResumeOverlap(uniqueId);
      if (!failure) {
        const fullResponse = responseAccumulators.get(uniqueId) || '';
        if (!fullResponse.trim()) {
          await handleApiError(uniqueId, 'The provider finished without returning any text. Try again, or ask a follow-up.', operation);
          break;
        }
        operation.notified = true;
        await sendOperationMessage(operation, {
          action: 'streamEnd', fullResponse, originalContext: operation.originalContext,
          assistantMessage: getAssistantMessagePayload(uniqueId, fullResponse), finishReason: state.finishReason || null, outcome: 'complete'
        });
        await sendOperationMessage(operation, { action: 'hideLoading' });
        break;
      }
      // Numeric Retry-After up to 10 s is honored; longer means give up. Dates/missing use 1 s, 2 s.
      const retryAfter = failure.retryAfter == null ? NaN : Number(failure.retryAfter);
      const willRetry = Boolean(failure.retryable) && !operation.timedOut && attempt < CONFIG.MAX_RETRIES && !(retryAfter > 10);
      const delay = retryAfter >= 0 && retryAfter <= 10 ? retryAfter * 1000 : 1000 * 2 ** attempt;
      logDiagnostics('attempt-failed', { ...state.requestDiagnostics,
        failure: { kind: failure.kind, status: failure.status ?? null, code: failure.code ?? null, retryable: Boolean(failure.retryable), message: failure.message },
        willRetry, delay: willRetry ? delay : null, recentEvents: [...state.recentEvents] });
      if (!willRetry) {
        await sendUiRecoveryMessages(operation, `${failure.info ? '[Info]' : '[Error]'} ${failure.message}`);
        break;
      }
      const partialContent = responseAccumulators.get(uniqueId) || '';
      const resumed = partialContent.trim().length > 0;
      messages = resumed
        ? [...baseMessages, { role: 'assistant', content: partialContent }, { role: 'user', content: buildContinuationRetryPrompt() }]
        : baseMessages;
      // Keep one operation and the same effective system/slash prompt throughout backoff.
      streamStates.set(uniqueId, createStreamState({
        reasoning: state.reasoning, reasoning_details: cloneReasoningDetails(state.reasoning_details),
        reasoningDetailsStart: state.reasoning_details.length,
        // ponytail: dedupe checks only the last 4096 characters; use a prefix table for larger overlaps.
        resumeDeduper: resumed ? { active: true, existingText: partialContent.slice(-4096), pending: '' } : null
      }));
      await awaitOperation(operation, new Promise(resolve => { operation.backoffId = setTimeout(resolve, delay); }));
    }
  } catch (error) {
    if (!ownsOperation(operation) || operation.cancelled || operation.consumerGone) return;
    const message = operation.timedOut
      ? `The request timed out after ${Math.round(CONFIG.REQUEST_TIMEOUT / 1000)} seconds without provider progress. You can ask a follow-up to continue.`
      : error.message || 'The provider request failed.';
    await handleApiError(uniqueId, message, operation);
  } finally {
    await operation.recoveryPromise;
    finishOperation(operation);
  }
}

/**
 * Stop an ongoing API request
 */
async function stopApiRequest(uniqueId, fallbackTabId = null, operationId = null, closeWindow = false) {
  const operation = abortControllers.get(uniqueId);
  if (operation && (!operationId || operation.operationId === operationId) &&
      (fallbackTabId == null || operation.tabId === fallbackTabId)) {
    cancelOperation(operation);
    if (closeWindow) operation.consumerGone = true;
    else {
      operation.recoveryPromise = sendUiRecoveryMessages(operation, '[Info] Request stopped by user.');
      await operation.recoveryPromise;
    }
  }
  if (closeWindow && (!operation || operation.operationId === operationId)) removeSession(uniqueId);
}

/**
 * Handle API errors consistently
 */
async function handleApiError(uniqueId, message, operation = abortControllers.get(uniqueId)) {
  if (!ownsOperation(operation) || operation.cancelled) return;
  await sendUiRecoveryMessages(operation, `[Error] ${message}`);
}

function processBuffer(buffer, uniqueId, adapter) {
  const operation = abortControllers.get(uniqueId);
  const state = streamStates.get(uniqueId);
  if (!operation || operation.cancelled || !state) return { buffer: '', shouldStop: true, stopReason: 'cancelled' };
  state.sseData ||= [];
  if (state.skipNextLf && buffer.length) {
    if (buffer[0] === '\n') buffer = buffer.slice(1);
    state.skipNextLf = false;
  }
  while (buffer.length) {
    const end = buffer.search(/[\r\n]/);
    if (end < 0) break;
    const line = buffer.slice(0, end);
    // A final CR already ends the line; swallow a following LF on the next read.
    state.skipNextLf = buffer[end] === '\r' && end === buffer.length - 1;
    buffer = buffer.slice(end + (buffer[end] === '\r' && buffer[end + 1] === '\n' ? 2 : 1));
    if (!line) {
      if (!state.sseData.length) continue;
      const json = state.sseData.join('\n');
      state.sseData = [];
      if (!json) continue;
      if (json === '[DONE]') {
        state.sawDone = true;
        state.sawTerminal = true;
        appendStreamDiagnostic(uniqueId, { type: 'done' });
      } else {
        const result = handleJsonLine(json, uniqueId, adapter);
        if (result?.errorMessage) return { buffer: '', shouldStop: true, stopReason: 'error', ...result };
      }
      if (state.sawTerminal) return { buffer: '', shouldStop: true, stopReason: 'terminal', errorMessage: state.errorMessage };
    } else if (line === 'data' || line.startsWith('data:')) {
      state.sseData.push(line === 'data' ? '' : line.slice(5).replace(/^ /, ''));
    }
  }
  // SSE requires a blank line to dispatch; EOF never certifies a partial event.
  return { buffer, shouldStop: false };
}

function handleJsonLine(jsonLine, uniqueId, adapter) {
  const operation = abortControllers.get(uniqueId);
  const state = streamStates.get(uniqueId);
  if (!operation || operation.cancelled || !state) return null;
  try {
    const data = JSON.parse(jsonLine);
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('Expected a provider event object');
    if (data.error) {
      const code = data.error.code ?? data.error.type ?? null;
      state.outcome = 'failed';
      state.sawTerminal = true;
      state.errorMessage = formatStreamError({
        message: data.error.message || 'The provider returned a stream error.',
        code,
        providerKind: state.requestDiagnostics?.providerKind
      });
      appendStreamDiagnostic(uniqueId, { type: 'error', code });
      // Mid-stream errors are upstream failures; providers use arbitrary string codes, so only
      // a numeric/digit-string deterministic 4xx is final.
      const status = /^\d+$/.test(String(code)) ? Number(code) : null;
      return { errorMessage: state.errorMessage, errorCode: code, retryable: isRetryableStatus(status) };
    }
    const rawContent = adapter.parseStreamChunk(data);
    if (rawContent != null && typeof rawContent !== 'string') throw new Error('Expected a text delta');
    const reasoning = adapter.parseReasoning?.(data);
    const details = adapter.parseReasoningDetails?.(data);
    appendResponseChunk(uniqueId, applyResumeOverlapDedupe(uniqueId, rawContent));
    if (reasoning) state.reasoning += reasoning;
    if (details) mergeReasoningDetails(state.reasoning_details, details, state.reasoningDetailsStart);
    // Carry only new fragments; full snapshots here would make message traffic quadratic.
    if (reasoning || details?.length) {
      void sendOperationMessage(operation, { action: 'appendToFloatingWindow', isDelta: true, content: '',
        reasoningDelta: { ...(reasoning ? { reasoning } : {}), ...(details?.length ? { reasoning_details: details } : {}) },
        reasoningDetailsStart: state.reasoningDetailsStart }).catch(() => {});
    }
    recordFinishReason(state, data);
    appendStreamDiagnostic(uniqueId, {
      type: 'chunk', finishReason: state.finishReason || null, contentLength: rawContent?.length || 0,
      reasoningLength: reasoning?.length || 0, reasoningDetailsCount: details?.length || 0
    });
    if (adapter.isStreamEnd(data)) state.sawTerminal = true;
  } catch (error) {
    state.outcome = 'protocol_error';
    state.errorMessage = `Invalid provider stream data: ${error.message}. The answer may be incomplete.`;
    appendStreamDiagnostic(uniqueId, { type: 'parse-failure', message: error.message });
    return { errorMessage: state.errorMessage };
  }
  return null;
}
