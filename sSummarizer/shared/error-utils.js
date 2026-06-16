// shared/error-utils.js
// User-facing error helpers shared between background.js (via importScripts)
// and options.js (via <script> tag in options.html).
//
// Purpose: turn raw HTTP status codes, provider error bodies, and network /
// fetch failures into clear, actionable messages instead of leaking raw
// strings like "HTTP 401: Unauthorized - {...}" or a blanket
// "Network error. Please check your connection." to the user.
//
// Status-code meanings follow each provider's published error reference:
//   OpenAI      https://platform.openai.com/docs/guides/error-codes
//   Anthropic   https://docs.anthropic.com/en/api/errors            (529 = overloaded_error)
//   Gemini      https://ai.google.dev/gemini-api/docs/troubleshooting
//   OpenRouter  https://openrouter.ai/docs/api/reference/errors-and-debugging
//   Groq / Perplexity / Azure OpenAI use OpenAI-compatible status semantics.
//
// IMPORTANT: keep this file free of browser-context-specific DOM APIs so it
// runs in both the service worker and the options page (mirrors azure-utils.js).

// Canonical, provider-agnostic explanation for each HTTP status the providers
// above can return. `label` is a short headline; `hint` tells the user what to
// do about it.
const HTTP_ERROR_GUIDE = {
  400: {
    label: 'Bad request',
    hint: 'The request was rejected as malformed. The page content may be too long for the model, or the model name / a parameter is invalid.'
  },
  401: {
    label: 'Authentication failed',
    hint: 'Your API key is missing, invalid, or expired. Open the extension options and re-enter a valid key.'
  },
  402: {
    label: 'Payment required',
    hint: 'Your account is out of credits or has hit its spending limit. Add funds or check billing with your provider.'
  },
  403: {
    label: 'Access denied',
    hint: "Your API key isn't permitted to use this model, or the request was blocked (region restriction or content moderation)."
  },
  404: {
    label: 'Not found',
    hint: 'The endpoint URL or model name could not be found. Double-check the API URL and model in the extension options.'
  },
  408: {
    label: 'Request timeout',
    hint: 'The provider took too long to accept the request. Please try again.'
  },
  413: {
    label: 'Content too large',
    hint: "The content exceeds the provider's size limit. Try summarizing a text selection or a shorter page."
  },
  422: {
    label: 'Request rejected',
    hint: 'The provider could not process the request parameters. Verify your model and settings.'
  },
  429: {
    label: 'Rate limit reached',
    hint: "You've sent too many requests or exceeded your quota. Wait a moment before trying again."
  },
  500: {
    label: 'Provider error',
    hint: 'The AI provider hit an internal error. This is usually temporary — try again shortly.'
  },
  502: {
    label: 'Bad gateway',
    hint: 'The provider returned an invalid response from the upstream model. Try again in a moment.'
  },
  503: {
    label: 'Service unavailable',
    hint: 'The provider is temporarily overloaded or down. Try again in a moment.'
  },
  504: {
    label: 'Gateway timeout',
    hint: 'The provider timed out talking to the upstream model. Try again in a moment.'
  },
  529: {
    label: 'Provider overloaded',
    hint: 'The provider is temporarily at capacity. Wait 30–60 seconds and try again.'
  }
};

// Provider-specific overrides where a status carries a more precise meaning than
// the generic guide above.
const PROVIDER_STATUS_OVERRIDES = {
  openrouter: {
    402: { label: 'Out of credits', hint: 'Your OpenRouter balance is too low for this request. Add credits at openrouter.ai/credits.' },
    403: { label: 'Request blocked', hint: 'OpenRouter flagged the input with its moderation model, or your key lacks access to this model.' },
    502: { label: 'Model unavailable', hint: 'The selected model is down or returned an invalid response. Try a different model or retry.' },
    503: { label: 'No available provider', hint: 'No upstream provider could serve this model right now. Try a different model or retry shortly.' }
  },
  anthropic: {
    400: { label: 'Bad request', hint: 'Anthropic rejected the request — messages must alternate user/assistant, and the content may be too long for the model.' }
  },
  gemini: {
    400: { label: 'Invalid request', hint: 'Gemini rejected the request (INVALID_ARGUMENT). The model name or request body is likely wrong.' },
    403: { label: 'Permission denied', hint: 'The API key is invalid for this project or the model is not enabled. Regenerate the key in Google AI Studio.' },
    429: { label: 'Quota exceeded', hint: 'You hit a Gemini rate limit or daily quota (RESOURCE_EXHAUSTED). Wait and retry, or check your quota.' }
  },
  perplexity: {
    400: { label: 'Bad request', hint: 'Perplexity rejected the request. Check the model name and request parameters.' }
  }
};

// Clamp provider-supplied text so a verbose error body can't flood the UI.
function clampErrorText(value, maxLength = 300) {
  if (typeof value !== 'string') {
    return '';
  }
  const trimmed = value.trim();
  return trimmed.length > maxLength ? `${trimmed.slice(0, maxLength)}…` : trimmed;
}

// Resolve the best explanation for a status code, preferring a provider override.
function getStatusGuide(status, providerKind) {
  const kind = (providerKind || '').toLowerCase();
  const overrides = PROVIDER_STATUS_OVERRIDES[kind];
  if (overrides && overrides[status]) {
    return overrides[status];
  }
  return HTTP_ERROR_GUIDE[status] || null;
}

// Pull a human-readable message and machine code out of a provider error body.
// Handles the OpenAI/Anthropic/OpenRouter `{ error: { message, code } }` shape,
// the Gemini `{ error: { message, status } }` shape, and bare strings.
function extractProviderErrorDetail(rawBody) {
  if (typeof rawBody !== 'string') {
    return { message: '', code: null };
  }
  const text = rawBody.trim();
  if (!text) {
    return { message: '', code: null };
  }

  try {
    const parsed = JSON.parse(text);
    const errObj = (parsed && typeof parsed.error === 'object' && parsed.error) || parsed || {};
    const message =
      (typeof errObj.message === 'string' && errObj.message) ||
      (typeof errObj.details === 'string' && errObj.details) ||
      (typeof parsed.message === 'string' && parsed.message) ||
      '';
    const code = errObj.code ?? errObj.status ?? errObj.type ?? parsed.code ?? null;
    return { message: clampErrorText(message), code };
  } catch (e) {
    // Body wasn't JSON. Gateways (Cloudflare, nginx) often return an HTML error
    // page — don't echo raw markup; the status guide already explains it. For
    // plain text, return a clamped snippet.
    if (text.startsWith('<')) {
      return { message: '', code: null };
    }
    return { message: clampErrorText(text), code: null };
  }
}

// Build the full user-facing message for a non-OK HTTP response.
function formatHttpError(details = {}) {
  const { status, statusText, body, providerKind, retryAfter } = details;
  const guide = getStatusGuide(status, providerKind);
  const detail = extractProviderErrorDetail(body);
  const parts = [];

  if (guide) {
    parts.push(`${guide.label} (HTTP ${status}). ${guide.hint}`);
  } else if (status) {
    parts.push(`The provider returned HTTP ${status}${statusText ? ` ${statusText}` : ''}.`);
  } else {
    parts.push('The provider returned an unexpected error.');
  }

  if ((status === 429 || status === 503 || status === 529) && retryAfter != null) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds) && seconds > 0) {
      parts.push(`The provider asked you to wait ${seconds} second${seconds === 1 ? '' : 's'} before retrying.`);
    }
  }

  if (detail.message) {
    parts.push(`Provider said: ${detail.message}`);
  }

  return parts.join(' ');
}

// True when an error is a transport-level failure (DNS, refused/reset
// connection, TLS, offline, or a blocked host) rather than an HTTP response.
// `fetch` surfaces all of these as `TypeError: Failed to fetch`.
function isNetworkError(error) {
  if (!error) {
    return false;
  }
  const name = error.name || '';
  const message = error.message || '';
  return name === 'TypeError' && /failed to fetch|networkerror|load failed|fetch/i.test(message);
}

// Explain a transport-level failure — the "endpoint disconnect" case the user
// most often hits with a wrong URL, an unreachable host, or no connection.
function formatNetworkError(error, context = {}) {
  const { apiUrl } = context;

  if (typeof navigator !== 'undefined' && navigator && navigator.onLine === false) {
    return 'You appear to be offline. Check your internet connection and try again.';
  }

  let host = '';
  try {
    host = apiUrl ? new URL(apiUrl).host : '';
  } catch (e) {
    host = '';
  }

  const target = host ? `the endpoint (${host})` : 'the API endpoint';
  return (
    `Could not reach ${target} — the connection failed or was dropped before the provider responded. ` +
    'Verify the API URL is correct and reachable, and that no firewall, proxy, or VPN is blocking it, then try again.'
  );
}

// Format an error reported inside the SSE stream (provider sends an error event
// mid-response). `code` may be a numeric HTTP-like status from the provider.
function formatStreamError(detail = {}) {
  const { message, code, providerKind } = detail;
  const numericStatus = Number(code);
  const guide = Number.isFinite(numericStatus) ? getStatusGuide(numericStatus, providerKind) : null;
  const cleanMessage = clampErrorText(message);

  if (guide) {
    return `${guide.label} (HTTP ${numericStatus}). ${guide.hint}${cleanMessage ? ` Provider said: ${cleanMessage}` : ''}`;
  }
  if (cleanMessage) {
    return `The provider reported an error: ${cleanMessage}`;
  }
  return 'The provider reported an error while streaming the response.';
}

// Expose on the global scope for both importScripts (service worker) and the
// options page <script>. Mirrors how azure-utils.js shares its helpers.
if (typeof self !== 'undefined') {
  self.formatHttpError = formatHttpError;
  self.formatNetworkError = formatNetworkError;
  self.formatStreamError = formatStreamError;
  self.isNetworkError = isNetworkError;
  self.getStatusGuide = getStatusGuide;
  self.extractProviderErrorDetail = extractProviderErrorDetail;
}
