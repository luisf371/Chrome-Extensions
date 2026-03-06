// content.js - Content Script for Floating Window UI
// Handles the creation and management of floating summarization windows

(function () {
  if (window.sSummarizerLoaded) {
    return;
  }
  window.sSummarizerLoaded = true;

  // State management for multiple floating windows
  let floatingWindows = new Map(); // Stores ShadowRoot
  let isMinimized = new Map();
  let textSizes = new Map();
  let windowSizes = new Map();
  let contentBuffers = new Map();
  let userScrolledUp = new Map();
  let isContentUpdating = new Map(); // Flag to ignore scroll events during content updates
  let chatHistories = new Map();
  let isChatProcessing = new Map();
  let slashCommandsCache = new Map();
  let selectedSlashCommand = new Map();
  let dropdownSelectedIndex = new Map();
  let streamHeartbeatPorts = new Map();
  let streamHeartbeatTimers = new Map();
  let activeStreams = new Set();
  let contentRenderTimers = new Map();

  // Configuration constants
  const UI_CONFIG = {
    DEFAULT_FONT_SIZE: 14,
    MIN_FONT_SIZE: 8,
    MAX_FONT_SIZE: 24,
    DEFAULT_WIDTH: 280,
    DEFAULT_HEIGHT: 250,
    MIN_WIDTH: 280,
    MIN_HEIGHT: 250,
    POSITION_OFFSET: 20 // Offset for multiple windows
  };
  const STREAM_HEARTBEAT_INTERVAL_MS = 5000;
  const STREAM_RENDER_BATCH_MS = 50;

  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    switch (request.action) {
      case 'createFloatingWindow':
        createFloatingWindow(request.uniqueId);
        sendResponse({ success: true });
        break;
      case 'appendToFloatingWindow':
        handleMessage(request.content, request.uniqueId);
        sendResponse({ success: true });
        break;
      case 'showLoading':
        startStreamSession(request.uniqueId);
        showLoading(request.uniqueId);
        sendResponse({ success: true });
        break;
      case 'hideLoading':
        hideLoading(request.uniqueId);
        sendResponse({ success: true });
        break;
      case 'streamEnd':
        stopStreamSession(request.uniqueId);
        handleStreamEnd(request);
        sendResponse({ success: true });
        break;
      case 'chatUnlock':
        stopStreamSession(request.uniqueId);
        setChatEnabled(request.uniqueId, true, request.placeholderKey || 'placeholderFollowUp');
        sendResponse({ success: true });
        break;
    }
  });

  // ———— Floating‐window and utility functions below ————

  /**
   * Create a floating window with improved positioning and error handling
   */
  async function createFloatingWindow(uniqueId) {
    try {
      if (floatingWindows.has(uniqueId)) {
        const existingWindow = floatingWindows.get(uniqueId);
        if (existingWindow && existingWindow.host && existingWindow.host.parentNode) {
          existingWindow.host.remove();
        }
        cleanupWindowState(uniqueId);
      }

      const { defaultFontSize } = await chrome.storage.local.get('defaultFontSize');
      const initialFontSize = defaultFontSize || UI_CONFIG.DEFAULT_FONT_SIZE;

      const savedState = await chrome.storage.local.get(['windowState']);
      let state = savedState.windowState || {};

      // Validate and correct window position
      state = validateWindowState(state);

      let position;
      const size = { width: state.width, height: state.height };

      // Determine position:
      // If we already have windows open, calculate a cascaded position to avoid overlap.
      // Otherwise, use the saved state (or default) for the first window.
      if (floatingWindows.size > 0) {
        position = calculateWindowPosition();
        // calculateWindowPosition returns {top, right}, so ensure left is null
        position.left = null;
      } else {
        position = { top: state.top, left: state.left };

        // If right is not saved and left is null, default to right: 20
        if (position.left === null) {
          position.right = 20;
        }
      }

      // Create Host Element
      const host = document.createElement('div');
      host.id = `sSummarizer-host-${uniqueId}`;
      host.style.all = 'initial';
      host.style.zIndex = '2147483647'; // Max safe integer to ensure it's on top
      // Position host to ensure it doesn't affect layout, though children are fixed.
      // We don't set position: fixed on host to avoid creating a new stacking context 
      // that might interfere with child's fixed positioning relative to viewport,
      // unless strictly necessary. But 'all: initial' resets position to static.

      // Attach Shadow DOM
      const shadow = host.attachShadow({ mode: 'open' });

      const positionStyle = position.left !== null ? `top: ${position.top}px; left: ${position.left}px;` : `top: ${position.top}px; right: ${position.right}px;`;

      shadow.innerHTML = `
      <div id="floating-window-${uniqueId}" style="position: fixed; ${positionStyle} z-index: 9999; background-color: #1e1e1e; color: #cfcfcf; border: 1px solid #333; border-radius: 8px; width: ${size.width}px; height: ${size.height}px; display: flex; flex-direction: column; box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3); font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; backdrop-filter: blur(10px); box-sizing: border-box;">
        <div id="title-bar-${uniqueId}" style="padding: 12px 16px; background: linear-gradient(135deg, #2e2e2e, #3a3a3a); cursor: move; display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid #444; border-radius: 8px 8px 0 0; user-select: none;">
          <span style="font-weight: 600; color: #f0f0f0; font-size: 14px;">AI Summarizer</span>
          <div style="display: flex; align-items: center; gap: 8px;">
            <div style="display: flex; align-items: center; gap: 4px; margin-right: 8px;">
              <button id="decrease-font-${uniqueId}" style="background: none; border: none; color: #f0f0f0; cursor: pointer; padding: 4px 6px; border-radius: 4px; font-size: 12px; transition: background-color 0.2s;" title="Decrease font size">A⁻</button>
              <button id="increase-font-${uniqueId}" style="background: none; border: none; color: #f0f0f0; cursor: pointer; padding: 4px 6px; border-radius: 4px; font-size: 14px; transition: background-color 0.2s;" title="Increase font size">A⁺</button>
            </div>
            <button id="minimize-btn-${uniqueId}" style="background: none; border: none; color: #f0f0f0; cursor: pointer; padding: 4px 8px; border-radius: 4px; transition: background-color 0.2s;" title="Minimize">−</button>
            <button id="close-btn-${uniqueId}" style="background: none; border: none; color: #f0f0f0; cursor: pointer; padding: 4px 8px; border-radius: 4px; transition: background-color 0.2s;" title="Close">×</button>
          </div>
        </div>
        <div id="content-wrapper-${uniqueId}" style="flex-grow: 1; position: relative; overflow: hidden;">
          <div id="content-${uniqueId}" style="height: 100%; overflow-y: auto; padding: 16px; font-size: ${initialFontSize}px; background-color: #1e1e1e; color: #cfcfcf; line-height: 1.5; word-wrap: break-word;">
            <div id="loading-overlay-${uniqueId}" style="display: none; position: absolute; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0, 0, 0, 0.7); justify-content: center; align-items: center; border-radius: 0 0 8px 8px; z-index: 10;">
              <div class="spinner" style="border: 3px solid rgba(255,255,255,0.1); border-left-color: #4a9eff; border-radius: 50%; width: 32px; height: 32px; animation: spin 1s linear infinite;"></div>
            </div>
          </div>
          <button id="scroll-to-bottom-${uniqueId}" title="Scroll to bottom">↓</button>
        </div>
        
        <div id="chat-area-${uniqueId}" style="padding: 10px; border-top: 1px solid #333; background: #252525; display: flex; gap: 8px; align-items: center; border-radius: 0 0 8px 8px; position: relative;">
           <div id="chat-input-wrapper-${uniqueId}" style="flex-grow: 1; position: relative; display: flex; align-items: center;">
             <input type="text" id="chat-input-${uniqueId}" placeholder="${chrome.i18n.getMessage('placeholderThinking') || 'Thinking...'}" disabled style="width: 100%; background: #1e1e1e; border: 1px solid #444; color: #fff; padding: 8px 12px; border-radius: 4px; outline: none; font-family: inherit; font-size: 13px; transition: all 0.2s;">
             <button id="clear-command-${uniqueId}" style="display: none; position: absolute; right: 6px; top: 50%; transform: translateY(-50%); background: transparent; border: none; color: #888; cursor: pointer; font-size: 14px; padding: 4px 6px; line-height: 1; border-radius: 3px;">×</button>
           </div>
           <button id="chat-send-${uniqueId}" disabled style="background: #4a9eff; border: none; color: white; border-radius: 4px; width: 32px; height: 32px; padding: 0; display: flex; align-items: center; justify-content: center; flex-shrink: 0; cursor: pointer; font-size: 13px; transition: opacity 0.2s; opacity: 0.6;">➤</button>
           <div id="slash-dropdown-${uniqueId}" class="slash-dropdown" style="display: none; position: absolute; bottom: 100%; left: 10px; right: 50px; background: #2a2a2a; border: 1px solid #444; border-radius: 4px; max-height: 180px; overflow-y: auto; z-index: 100; margin-bottom: 4px; box-shadow: 0 -4px 12px rgba(0,0,0,0.3);"></div>
        </div>

        <div id="resize-handle-${uniqueId}" style="width: 12px; height: 12px; background: linear-gradient(135deg, #555, #777); position: absolute; right: 0; bottom: 0; cursor: se-resize; border-radius: 0 0 8px 0; z-index: 20;"></div>
      </div>
      <style>
        /* CSS Reset for the floating window */
        #floating-window-${uniqueId}, #floating-window-${uniqueId} * {
          box-sizing: border-box;
          margin: 0;
          padding: 0;
          line-height: normal;
          -webkit-font-smoothing: antialiased;
          -moz-osx-font-smoothing: grayscale;
        }

        /* Aggressive button reset for title bar to prevent bleeding */
        #floating-window-${uniqueId} #title-bar-${uniqueId} button {
          all: initial; /* Reset all properties */
          display: inline-block;
          background: none !important;
          border: none !important;
          box-shadow: none !important;
          text-shadow: none !important;
          min-width: 0 !important;
          min-height: 0 !important;
          width: auto !important;
          height: auto !important;
          margin: 0 !important;
          padding: 4px 8px !important; /* Restore desired padding */
          font-family: inherit !important;
          font-size: 14px !important; /* Explicit size */
          color: #f0f0f0 !important;
          cursor: pointer !important;
          text-transform: none !important;
          letter-spacing: normal !important;
          border-radius: 4px !important;
          appearance: none !important;
          box-sizing: border-box !important;
          line-height: 1 !important;
          transition: background-color 0.2s !important;
        }

        /* Specific overrides for font size buttons to match original intent */
        #floating-window-${uniqueId} #decrease-font-${uniqueId},
        #floating-window-${uniqueId} #increase-font-${uniqueId} {
             padding: 4px 6px !important;
             font-size: 12px !important;
        }
        #floating-window-${uniqueId} #increase-font-${uniqueId} {
             font-size: 14px !important;
        }

        /* Generic button reset for other areas if needed */
        #floating-window-${uniqueId} button:not([id*="title-bar"]) {
          font-family: inherit;
          white-space: nowrap;
          text-align: center;
          text-decoration: none;
        }

        @keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }
        
        /* Hover effects */
        #floating-window-${uniqueId} #title-bar-${uniqueId} button:hover { 
            background-color: rgba(255, 255, 255, 0.1) !important; 
        }
        
        #floating-window-${uniqueId} #chat-send-${uniqueId}:not(:disabled):hover { opacity: 0.9; }
        #floating-window-${uniqueId} #chat-send-${uniqueId}:disabled {
            background-color: #555 !important;
            cursor: not-allowed;
            opacity: 0.5;
        }
        #floating-window-${uniqueId} #chat-input-${uniqueId}:focus { border-color: #4a9eff; }
        #floating-window-${uniqueId} #chat-input-${uniqueId}.command-locked {
            background: #2a2a2a;
            border-color: #555;
            color: #4a9eff;
            font-weight: 500;
            padding-right: 32px;
        }
        #floating-window-${uniqueId} #clear-command-${uniqueId}:hover {
            color: #fff;
            background: rgba(255,255,255,0.1);
        }
        #floating-window-${uniqueId} .slash-dropdown {
            scrollbar-width: thin;
            scrollbar-color: #555 #2a2a2a;
        }
        #floating-window-${uniqueId} .slash-dropdown::-webkit-scrollbar { width: 6px; }
        #floating-window-${uniqueId} .slash-dropdown::-webkit-scrollbar-track { background: #2a2a2a; }
        #floating-window-${uniqueId} .slash-dropdown::-webkit-scrollbar-thumb { background: #555; border-radius: 3px; }
        #floating-window-${uniqueId} .slash-item {
            padding: 6px 12px;
            cursor: pointer;
            font-size: 13px;
            color: #4a9eff;
            font-weight: 500;
            border-bottom: 1px solid #333;
        }
        #floating-window-${uniqueId} .slash-item:last-child { border-bottom: none; }
        #floating-window-${uniqueId} .slash-item:hover,
        #floating-window-${uniqueId} .slash-item.selected {
            background: rgba(74, 158, 255, 0.2);
        }
        #floating-window-${uniqueId} .slash-empty {
            padding: 12px;
            color: #888;
            font-size: 12px;
            text-align: center;
        }
        #floating-window-${uniqueId} #content-${uniqueId}::-webkit-scrollbar { width: 8px; }
        #floating-window-${uniqueId} #content-${uniqueId}::-webkit-scrollbar-track { background: #2a2a2a; border-radius: 4px; }
        #floating-window-${uniqueId} #content-${uniqueId}::-webkit-scrollbar-thumb { background: #555; border-radius: 4px; }
        #floating-window-${uniqueId} #content-${uniqueId}::-webkit-scrollbar-thumb:hover { background: #666; }
        
        /* Scroll to bottom button */
        #floating-window-${uniqueId} #content-wrapper-${uniqueId} #scroll-to-bottom-${uniqueId} {
          position: absolute;
          bottom: 12px;
          right: 12px;
          background: rgba(74, 158, 255, 0.9);
          border: none;
          border-radius: 50%;
          width: 32px;
          height: 32px;
          cursor: pointer;
          display: none;
          align-items: center;
          justify-content: center;
          color: white;
          font-size: 16px;
          box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
          transition: opacity 0.2s, transform 0.2s;
          z-index: 15;
        }
        #floating-window-${uniqueId} #content-wrapper-${uniqueId} #scroll-to-bottom-${uniqueId}:hover {
          background: rgba(74, 158, 255, 1);
          transform: scale(1.1);
        }
        #floating-window-${uniqueId} #content-wrapper-${uniqueId} #scroll-to-bottom-${uniqueId}.visible {
          display: flex;
        }

        /* Markdown styling for dark theme */
        #floating-window-${uniqueId} h1 { color: #4a9eff; font-size: 1.5em; margin: 16px 0 8px 0; font-weight: 600; }
        #floating-window-${uniqueId} h2 { color: #4a9eff; font-size: 1.3em; margin: 14px 0 6px 0; font-weight: 600; }
        #floating-window-${uniqueId} h3 { color: #4a9eff; font-size: 1.1em; margin: 12px 0 4px 0; font-weight: 600; }
        #floating-window-${uniqueId} strong { color: #f0f0f0; font-weight: 600; }
        #floating-window-${uniqueId} em { color: #e0e0e0; font-style: italic; }
        #floating-window-${uniqueId} code { 
          background: #2a2a2a; 
          color: #4a9eff; 
          padding: 2px 6px; 
          border-radius: 4px; 
          font-family: 'Consolas', 'Monaco', 'Courier New', monospace; 
          font-size: 0.9em; 
        }
        #floating-window-${uniqueId} pre { 
          background: #2a2a2a; 
          border: 1px solid #444; 
          border-radius: 6px; 
          padding: 12px; 
          margin: 8px 0; 
          overflow-x: auto; 
        }
        #floating-window-${uniqueId} pre code { 
          background: none; 
          padding: 0; 
          color: #cfcfcf; 
        }
        #floating-window-${uniqueId} blockquote { 
          border-left: 4px solid #4a9eff; 
          margin: 8px 0; 
          padding: 8px 16px; 
          background: rgba(74, 158, 255, 0.1); 
          border-radius: 0 4px 4px 0; 
        }
        #floating-window-${uniqueId} ul, #floating-window-${uniqueId} ol { 
          margin: 8px 0; 
          padding-left: 20px; 
        }
        #floating-window-${uniqueId} li { 
          margin: 4px 0; 
          color: #cfcfcf; 
        }
        #floating-window-${uniqueId} p { 
          margin: 8px 0; 
          line-height: 1.6; 
        }
        #floating-window-${uniqueId} hr {
          border: 0;
          border-top: 1px solid #444;
          margin: 16px 0;
        }
      </style>
    `;

      document.body.appendChild(host);

      // Initialize state - Store ShadowRoot
      floatingWindows.set(uniqueId, shadow);
      isMinimized.set(uniqueId, false);
      textSizes.set(uniqueId, initialFontSize);
      userScrolledUp.set(uniqueId, false);
      isContentUpdating.set(uniqueId, false);
      isChatProcessing.set(uniqueId, false);
      selectedSlashCommand.set(uniqueId, null);
      dropdownSelectedIndex.set(uniqueId, -1);

      // Load slash commands from storage
      chrome.storage.local.get(['slashCommands'], (result) => {
        slashCommandsCache.set(uniqueId, result.slashCommands || []);
      });

      const win = shadow.querySelector(`#floating-window-${uniqueId}`);
      const contentEl = win.querySelector(`#content-${uniqueId}`);

      // Add scroll event listener to track user scrolling
      if (contentEl) {
        contentEl.addEventListener('scroll', () => {
          // Skip scroll events triggered by content updates to prevent race conditions
          if (isContentUpdating.get(uniqueId)) {
            return;
          }

          // A threshold of 30px is used to account for layout shifts and inaccuracies
          const isScrolledToBottom = contentEl.scrollHeight - contentEl.clientHeight <= contentEl.scrollTop + 30;
          userScrolledUp.set(uniqueId, !isScrolledToBottom);

          // Update scroll-to-bottom button visibility
          updateScrollButtonVisibility(uniqueId);
        });
      }

      // Setup scroll-to-bottom button
      const scrollBtn = win.querySelector(`#scroll-to-bottom-${uniqueId}`);
      if (scrollBtn) {
        scrollBtn.addEventListener('click', () => {
          scrollToBottomAndResume(uniqueId);
        });
      }

      // Add event listeners with error handling
      setupWindowEventListeners(uniqueId, win);
      setupChatListeners(uniqueId, win);

      // Make window interactive
      makeDraggable(uniqueId, win, win.querySelector(`#title-bar-${uniqueId}`));
      makeResizable(win, win.querySelector(`#resize-handle-${uniqueId}`));

    } catch (error) {
      console.log('[Content] Error creating floating window:', error);
      // Clean up on error
      cleanupWindowState(uniqueId);
    }
  }

  /**
   * Validates the window state to ensure it is within the viewport.
   * @param {object} state - The window state object with top, left, width, height.
   * @returns {object} A validated state object.
   */
  function validateWindowState(state) {
    const defaults = {
      top: 20,
      left: null,
      right: 20,
      width: UI_CONFIG.DEFAULT_WIDTH,
      height: UI_CONFIG.DEFAULT_HEIGHT
    };

    const validatedState = { ...defaults, ...state };

    // Enforce minimum dimensions to prevent restoring minimized (tiny) sizes
    if (validatedState.width < UI_CONFIG.MIN_WIDTH) validatedState.width = UI_CONFIG.MIN_WIDTH;
    if (validatedState.height < UI_CONFIG.MIN_HEIGHT) validatedState.height = UI_CONFIG.MIN_HEIGHT;

    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;

    // If left is null, calculate it from right
    if (validatedState.left === null) {
      validatedState.left = viewportWidth - validatedState.width - validatedState.right;
    }

    // Check if window is out of bounds
    const isOutOfBounds =
      validatedState.top < 0 ||
      validatedState.left < 0 ||
      validatedState.top > viewportHeight - 50 || // 50px buffer for title bar
      validatedState.left > viewportWidth - 50;

    if (isOutOfBounds) {
      console.warn('[Content] Window position is out of bounds. Resetting to default.');
      return { ...defaults };
    }

    return validatedState;
  }

  /**
   * Calculate optimal position for new window to avoid overlaps
   */
  function calculateWindowPosition() {
    const existingWindows = Array.from(floatingWindows.values());
    const basePosition = { top: 20, right: 20 };

    if (existingWindows.length === 0) {
      return basePosition;
    }

    // Offset new windows to avoid complete overlap
    const offset = existingWindows.length * UI_CONFIG.POSITION_OFFSET;
    return {
      top: basePosition.top + offset,
      right: basePosition.right + offset
    };
  }

  /**
   * Setup event listeners for window controls
   */
  function setupWindowEventListeners(uniqueId, win) {
    try {
      const closeBtn = win.querySelector(`#close-btn-${uniqueId}`);
      const minimizeBtn = win.querySelector(`#minimize-btn-${uniqueId}`);
      const increaseFontBtn = win.querySelector(`#increase-font-${uniqueId}`);
      const decreaseFontBtn = win.querySelector(`#decrease-font-${uniqueId}`);

      const buttons = [closeBtn, minimizeBtn, increaseFontBtn, decreaseFontBtn];
      buttons.forEach(btn => {
        if (btn) {
          // Prevent drag initiation when clicking buttons
          btn.addEventListener('pointerdown', (e) => e.stopPropagation());
        }
      });

      if (closeBtn) {
        closeBtn.addEventListener('click', () => closeWindow(uniqueId));
      }

      if (minimizeBtn) {
        minimizeBtn.addEventListener('click', () => toggleMinimize(uniqueId));
      }

      if (increaseFontBtn) {
        increaseFontBtn.addEventListener('click', () => changeFontSize(uniqueId, 1));
      }

      if (decreaseFontBtn) {
        decreaseFontBtn.addEventListener('click', () => changeFontSize(uniqueId, -1));
      }

    } catch (error) {
      console.log('[Content] Error setting up event listeners:', error);
    }
  }

  /**
   * Close window and clean up resources
   */
  function closeWindow(uniqueId) {
    try {
      stopStreamSession(uniqueId);

      // Send stop request to background script to abort any ongoing API request
      chrome.runtime.sendMessage({
        action: 'stopApiRequest',
        uniqueId: uniqueId
      }, (response) => {
        if (chrome.runtime.lastError) {
          console.warn('[Content] Error sending stop request:', chrome.runtime.lastError.message);
        }
      });

      const win = floatingWindows.get(uniqueId); // ShadowRoot
      // win is ShadowRoot, access host to remove
      if (win && win.host) {
        win.host.remove();
      }
      cleanupWindowState(uniqueId);
    } catch (error) {
      console.log('[Content] Error closing window:', error);
    }
  }

  /**
   * Clean up window state from all maps
   */
  function cleanupWindowState(uniqueId) {
    stopStreamSession(uniqueId);
    const renderTimer = contentRenderTimers.get(uniqueId);
    if (renderTimer) {
      clearTimeout(renderTimer);
      contentRenderTimers.delete(uniqueId);
    }
    floatingWindows.delete(uniqueId);
    isMinimized.delete(uniqueId);
    textSizes.delete(uniqueId);
    windowSizes.delete(uniqueId);
    contentBuffers.delete(uniqueId);
    userScrolledUp.delete(uniqueId);
    isContentUpdating.delete(uniqueId);
    chatHistories.delete(uniqueId);
    isChatProcessing.delete(uniqueId);
    slashCommandsCache.delete(uniqueId);
    selectedSlashCommand.delete(uniqueId);
    dropdownSelectedIndex.delete(uniqueId);
  }

  /**
   * Update the visibility of the scroll-to-bottom button
   */
  function updateScrollButtonVisibility(uniqueId) {
    const win = floatingWindows.get(uniqueId);
    if (!win) return;

    const scrollBtn = win.querySelector(`#scroll-to-bottom-${uniqueId}`);
    if (!scrollBtn) return;

    const isScrolledUp = userScrolledUp.get(uniqueId);
    if (isScrolledUp) {
      scrollBtn.classList.add('visible');
    } else {
      scrollBtn.classList.remove('visible');
    }
  }

  /**
   * Scroll to bottom and resume auto-scroll
   */
  function scrollToBottomAndResume(uniqueId) {
    const win = floatingWindows.get(uniqueId);
    if (!win) return;

    const contentElement = win.querySelector(`#content-${uniqueId}`);
    if (!contentElement) return;

    // Set updating flag to prevent scroll listener from interfering
    isContentUpdating.set(uniqueId, true);

    // Reset user scroll state to enable auto-scroll
    userScrolledUp.set(uniqueId, false);

    // Scroll to bottom
    contentElement.scrollTop = contentElement.scrollHeight;

    // Hide the button
    updateScrollButtonVisibility(uniqueId);

    // Reset flag after a short delay
    requestAnimationFrame(() => {
      isContentUpdating.set(uniqueId, false);
    });
  }

  /**
   * Change font size with validation and bounds checking
   */
  function changeFontSize(uniqueId, delta) {
    try {
      const win = floatingWindows.get(uniqueId); // ShadowRoot
      if (!win) {
        return;
      }

      const content = win.querySelector(`#content-${uniqueId}`);
      if (!content) {
        return;
      }

      const currentSize = textSizes.get(uniqueId) || UI_CONFIG.DEFAULT_FONT_SIZE;
      let newSize = currentSize + delta;

      // Enforce bounds
      newSize = Math.max(UI_CONFIG.MIN_FONT_SIZE, Math.min(UI_CONFIG.MAX_FONT_SIZE, newSize));

      if (newSize !== currentSize) {
        textSizes.set(uniqueId, newSize);
        content.style.fontSize = `${newSize}px`;
        chrome.storage.local.set({ defaultFontSize: newSize });
      }
    } catch (error) {
      console.log('[Content] Error changing font size:', error);
    }
  }

  /**
   * Toggle window minimize state with improved state management
   */
  function toggleMinimize(uniqueId) {
    try {
      const wrapper = floatingWindows.get(uniqueId); // ShadowRoot
      if (!wrapper) {
        return;
      }
      const win = wrapper.querySelector(`#floating-window-${uniqueId}`);
      const content = win.querySelector(`#content-${uniqueId}`);
      const handle = win.querySelector(`#resize-handle-${uniqueId}`);
      const minimizeBtn = win.querySelector(`#minimize-btn-${uniqueId}`);

      if (!content || !handle || !win) {
        return;
      }

      const isCurrentlyMinimized = isMinimized.get(uniqueId) || false;

      if (isCurrentlyMinimized) {
        // Restore window
        const lastSize = windowSizes.get(uniqueId);
        content.style.display = ''; // Restore to default display
        handle.style.display = 'block';
        if (lastSize) {
          win.style.height = `${lastSize.height}px`;
        }
        if (minimizeBtn) minimizeBtn.textContent = '−';
        if (minimizeBtn) minimizeBtn.title = 'Minimize';
        isMinimized.set(uniqueId, false);
      } else {
        // Minimize window
        windowSizes.set(uniqueId, { width: win.offsetWidth, height: win.offsetHeight });
        content.style.display = 'none';
        handle.style.display = 'none';
        win.style.height = 'auto'; // Let the title bar define the height
        if (minimizeBtn) minimizeBtn.textContent = '□';
        if (minimizeBtn) minimizeBtn.title = 'Restore';
        isMinimized.set(uniqueId, true);
      }
    } catch (error) {
      console.log('[Content] Error toggling minimize:', error);
    }
  }

  /**
   * Handle incoming messages with improved content sanitization
   */
  function handleMessage(content, uniqueId) {
    try {
      const win = floatingWindows.get(uniqueId); // ShadowRoot
      if (!win) {
        // This is expected when window is already closed - no need to warn
        return;
      }

      const contentElement = win.querySelector(`#content-${uniqueId}`);
      if (!contentElement) {
        return;
      }

      let currentBuffer = contentBuffers.get(uniqueId) || '';
      currentBuffer += content;
      contentBuffers.set(uniqueId, currentBuffer);
      scheduleContentRender(uniqueId);

    } catch (error) {
      console.log('[Content] Error handling message:', error);
    }
  }

  /**
   * Convert markdown to HTML and sanitize content
   */
  function sanitizeContent(content) {
    if (typeof content !== 'string') {
      return String(content || '');
    }

    // Convert markdown to HTML
    let html = convertMarkdownToHtml(content);

    // Allow basic formatting tags but escape potentially dangerous content
    const allowedTags = ['b', 'i', 'em', 'strong', 'br', 'p', 'div', 'span', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'ul', 'ol', 'li', 'code', 'pre', 'blockquote', 'hr'];
    const tagRegex = /<(\/?)(\w+)([^>]*)>/gi;

    return html.replace(tagRegex, (match, slash, tagName, attributes) => {
      if (allowedTags.includes(tagName.toLowerCase())) {
        // Remove any attributes for security, except for basic styling
        return `<${slash}${tagName}>`;
      }
      // Escape disallowed tags
      return match.replace(/</g, '&lt;').replace(/>/g, '&gt;');
    });
  }


  function convertMarkdownToHtml(markdown) {
    const processInline = (text) => {
      if (!text) return '';
      return text
        .replace(/\*\*\*(.*?)\*\*\*/g, '<strong><em>$1</em></strong>')
        .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
        .replace(/\*(.*?)\*/g, '<em>$1</em>')
        .replace(/`([^`]+)`/g, '<code>$1</code>');
    };

    const lines = markdown.trim().split('\n');
    let html = '';
    let i = 0;

    while (i < lines.length) {
      const line = lines[i];

      // Headers (with support for YOU: prefix)
      const headerMatch = line.match(/^(\s*(?:\*\*(?:YOU):\*\*\s*)?)(#{1,6})\s+(.*)$/);
      if (headerMatch) {
        const prefix = headerMatch[1];
        const hashes = headerMatch[2];
        const content = headerMatch[3];
        const level = hashes.length;

        html += `<h${level}>${prefix ? processInline(prefix) : ''}${processInline(content)}</h${level}>\n`;
        i++;
        continue;
      }

      // Horizontal Rule
      if (line.match(/^-{3,}$/)) {
        html += '<hr>\n';
        i++;
        continue;
      }

      // Code blocks
      if (line.startsWith('```')) {
        let codeBlockContent = '';
        i++;
        while (i < lines.length && !lines[i].startsWith('```')) {
          codeBlockContent += lines[i] + '\n';
          i++;
        }
        html += `<pre><code>${escapeHtml(codeBlockContent.trim())}</code></pre>\n`;
        i++; // Skip closing ```
        continue;
      }

      // Lists (with support for YOU: prefix)
      const listMatch = line.match(/^(\s*(?:\*\*(?:YOU):\*\*\s*)?)([-*]|\d+\.)\s+(.*)$/);
      if (listMatch) {
        let listHtml = '';
        const listStack = [];

        while (i < lines.length) {
          const currentLine = lines[i];
          const itemMatch = currentLine.match(/^(\s*(?:\*\*(?:YOU):\*\*\s*)?)([-*]|\d+\.)\s+(.*)$/);

          if (!itemMatch && !currentLine.match(/^\s+.*$/)) break;

          if (itemMatch) {
            const prefix = itemMatch[1];
            const marker = itemMatch[2];
            let content = itemMatch[3];
            const indent = (prefix ? prefix.length : 0) + (itemMatch[1].match(/^\s*/) ? itemMatch[1].match(/^\s*/)[0].length : 0);
            const type = marker.match(/\d/) ? 'ol' : 'ul';

            // Look ahead for multi-line list items
            let nextIndex = i + 1;
            while (nextIndex < lines.length && lines[nextIndex].match(/^\s{2,}/) && !lines[nextIndex].match(/^(\s*(?:\*\*(?:YOU):\*\*\s*)?)([-*]|\d+\.)\s/)) {
              content += ' ' + lines[nextIndex].trim();
              nextIndex++;
            }

            while (listStack.length > 0 && indent < listStack[listStack.length - 1].indent) {
              listHtml += `</${listStack.pop().type}>\n`;
            }
            if (listStack.length === 0 || indent > listStack[listStack.length - 1].indent || type !== listStack[listStack.length - 1].type) {
              if (listStack.length > 0 && listStack[listStack.length - 1].type !== type) {
                listHtml += `</${listStack.pop().type}>\n`;
              }
              listHtml += `<${type}>\n`;
              listStack.push({ type, indent });
            }
            listHtml += `<li>${prefix ? processInline(prefix) : ''}${processInline(content)}</li>\n`;
            i = nextIndex;
          } else {
            i++;
          }
        }
        while (listStack.length > 0) {
          listHtml += `</${listStack.pop().type}>\n`;
        }
        html += listHtml;
        continue;
      }

      // Paragraphs
      if (line.trim()) {
        let paragraphContent = line;
        while (i + 1 < lines.length && lines[i + 1].trim() && !lines[i + 1].match(/^-{3,}$/) && !lines[i + 1].match(/^#{1,6}\s/) && !lines[i + 1].match(/^(\s*)([-*]|\d+\.)\s/)) {
          paragraphContent += '<br>' + lines[i + 1];
          i++;
        }
        html += `<p>${processInline(paragraphContent)}</p>\n`;
      }
      i++;
    }

    return html.trim();
  }

  /**
   * Escape HTML characters
   */
  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  /**
   * Show loading indicator with error handling
   */
  function showLoading(uniqueId) {
    try {
      const win = floatingWindows.get(uniqueId); // ShadowRoot
      if (!win) {
        return;
      }

      const loadingOverlay = win.querySelector(`#loading-overlay-${uniqueId}`);
      if (loadingOverlay) {
        loadingOverlay.style.display = 'flex';
      }
    } catch (error) {
      console.log('[Content] Error showing loading:', error);
    }
  }

  /**
   * Hide loading indicator with error handling
   */
  function hideLoading(uniqueId) {
    try {
      const win = floatingWindows.get(uniqueId); // ShadowRoot
      if (!win) {
        // This is expected when window is already closed - no need to warn
        return;
      }

      const loadingOverlay = win.querySelector(`#loading-overlay-${uniqueId}`);
      if (loadingOverlay) {
        loadingOverlay.style.display = 'none';
      }
    } catch (error) {
      console.log('[Content] Error hiding loading:', error);
    }
  }

  function makeDraggable(uniqueId, el, handle) {
    let x0 = 0, y0 = 0, x1 = 0, y1 = 0;
    handle.onpointerdown = e => { // Changed from onmousedown
      e.preventDefault();
      e.target.setPointerCapture(e.pointerId); // Capture pointer events
      x1 = e.clientX; y1 = e.clientY;

      const drag = (e) => { // Defined drag function inside pointerdown for proper scope
        e.preventDefault();
        x0 = x1 - e.clientX; y0 = y1 - e.clientY;
        x1 = e.clientX; y1 = e.clientY;
        el.style.top = (el.offsetTop - y0) + 'px';
        el.style.left = (el.offsetLeft - x0) + 'px';
      };

      const stopDrag = (e) => { // Defined stopDrag function
        e.target.releasePointerCapture(e.pointerId); // Release pointer capture
        window.removeEventListener('pointermove', drag);
        window.removeEventListener('pointerup', stopDrag);

        const isMin = isMinimized.get(uniqueId);

        let heightToSave = el.offsetHeight;
        if (isMin && windowSizes.has(uniqueId)) {
          // If minimized, use the stored full height instead of the current title-bar height
          heightToSave = windowSizes.get(uniqueId).height;
        }

        chrome.storage.local.set({ windowState: { top: el.offsetTop, left: el.offsetLeft, width: el.offsetWidth, height: heightToSave } });
      };

      window.addEventListener('pointermove', drag);
      window.addEventListener('pointerup', stopDrag, { once: true });
    };
  }

  function makeResizable(el, handle) {
    handle.onpointerdown = (e) => { // Changed from onmousedown
      e.preventDefault();
      e.target.setPointerCapture(e.pointerId); // Capture pointer events

      const resize = (e) => { // Defined resize function inside pointerdown
        const newWidth = Math.max(UI_CONFIG.MIN_WIDTH, e.clientX - el.offsetLeft);
        const newHeight = Math.max(UI_CONFIG.MIN_HEIGHT, e.clientY - el.offsetTop);
        el.style.width = newWidth + 'px';
        el.style.height = newHeight + 'px';
      };

      const stopResize = (e) => { // Defined stopResize function
        e.target.releasePointerCapture(e.pointerId); // Release pointer capture
        window.removeEventListener('pointermove', resize);
        window.removeEventListener('pointerup', stopResize);
        chrome.storage.local.set({ windowState: { top: el.offsetTop, left: el.offsetLeft, width: el.offsetWidth, height: el.offsetHeight } });
      };

      window.addEventListener('pointermove', resize);
      window.addEventListener('pointerup', stopResize, { once: true });
    };
  }

  // ———— Chat Functionality ————

  function handleStreamEnd(request) {
    const { uniqueId, fullResponse, originalContext } = request;
    flushContentRender(uniqueId);

    // Initialize history if not present
    if (!chatHistories.has(uniqueId)) {
      chatHistories.set(uniqueId, []);
    }
    const history = chatHistories.get(uniqueId);

    // If originalContext is provided (initial request), add it first
    if (originalContext && history.length === 0) {
      history.push({ role: 'user', content: originalContext });
    }

    // Add the assistant's response
    history.push({ role: 'assistant', content: fullResponse });

    const win = floatingWindows.get(uniqueId); // ShadowRoot
    if (win) {
      // Final auto-scroll check to ensure it ends at the bottom
      const contentElement = win.querySelector(`#content-${uniqueId}`);
      if (contentElement && !userScrolledUp.get(uniqueId)) {
        requestAnimationFrame(() => {
          contentElement.scrollTop = contentElement.scrollHeight;
        });
      }
    }
    setChatEnabled(uniqueId, true, 'placeholderFollowUp');
  }

  function setChatEnabled(uniqueId, enabled, placeholderKey = 'placeholderFollowUp') {
    const win = floatingWindows.get(uniqueId);
    if (!win) return;

    const input = win.querySelector(`#chat-input-${uniqueId}`);
    const btn = win.querySelector(`#chat-send-${uniqueId}`);

    if (input) {
      input.disabled = !enabled;
      if (enabled) {
        input.placeholder = chrome.i18n.getMessage(placeholderKey) || "Ask a follow-up...";
      } else {
        input.placeholder = chrome.i18n.getMessage('placeholderThinking') || "Thinking...";
      }
    }
    if (btn) btn.disabled = !enabled;
    isChatProcessing.set(uniqueId, !enabled);
  }

  function setupChatListeners(uniqueId, win) {
    const input = win.querySelector(`#chat-input-${uniqueId}`);
    const sendBtn = win.querySelector(`#chat-send-${uniqueId}`);
    const dropdown = win.querySelector(`#slash-dropdown-${uniqueId}`);

    const submit = () => {
      const selected = selectedSlashCommand.get(uniqueId);
      let textToSend = '';

      if (selected) {
        textToSend = selected.prompt;
      } else {
        textToSend = input ? input.value.trim() : '';
      }

      if (textToSend && !isChatProcessing.get(uniqueId)) {
        sendFollowUp(uniqueId, textToSend);
        const clearBtn = win.querySelector(`#clear-command-${uniqueId}`);
        if (input) {
          input.value = '';
          input.classList.remove('command-locked');
          input.readOnly = false;
        }
        if (clearBtn) {
          clearBtn.style.display = 'none';
        }
        selectedSlashCommand.set(uniqueId, null);
        hideSlashDropdown(uniqueId);
      }
    };

    const hideSlashDropdown = (id) => {
      const dd = win.querySelector(`#slash-dropdown-${id}`);
      if (dd) dd.style.display = 'none';
      dropdownSelectedIndex.set(id, -1);
    };

    const showSlashDropdown = (id, filterText) => {
      const dd = win.querySelector(`#slash-dropdown-${id}`);
      if (!dd) return;

      const commands = slashCommandsCache.get(id) || [];
      const filter = filterText.toLowerCase();
      const filtered = commands.filter(cmd =>
        cmd.command.toLowerCase().startsWith(filter)
      );

      dd.innerHTML = '';

      if (filtered.length === 0) {
        dd.innerHTML = `<div class="slash-empty">${chrome.i18n.getMessage('emptyDropdown') || 'No commands found. Configure in extension options.'}</div>`;
      } else {
        filtered.forEach((cmd, idx) => {
          const item = document.createElement('div');
          item.className = 'slash-item';
          item.dataset.command = cmd.command;
          item.dataset.index = idx;
          item.textContent = '/' + cmd.command;

          item.addEventListener('click', () => {
            selectSlashCommand(id, cmd);
          });

          dd.appendChild(item);
        });
      }

      dd.style.display = 'block';
      dropdownSelectedIndex.set(id, -1);
    };

    const selectSlashCommand = (id, cmd) => {
      selectedSlashCommand.set(id, cmd);
      const clearBtn = win.querySelector(`#clear-command-${id}`);
      if (input) {
        input.value = '/' + cmd.command;
        input.classList.add('command-locked');
        input.readOnly = true;
      }
      if (clearBtn) {
        clearBtn.style.display = 'block';
      }
      hideSlashDropdown(id);
    };

    const unlockInput = (id) => {
      selectedSlashCommand.set(id, null);
      const clearBtn = win.querySelector(`#clear-command-${id}`);
      if (input) {
        input.value = '';
        input.classList.remove('command-locked');
        input.readOnly = false;
        input.focus();
      }
      if (clearBtn) {
        clearBtn.style.display = 'none';
      }
    };

    const updateDropdownSelection = (id, direction) => {
      const dd = win.querySelector(`#slash-dropdown-${id}`);
      if (!dd || dd.style.display === 'none') return;

      const items = dd.querySelectorAll('.slash-item');
      if (items.length === 0) return;

      let currentIdx = dropdownSelectedIndex.get(id);
      items.forEach(item => item.classList.remove('selected'));

      if (direction === 'down') {
        currentIdx = currentIdx < items.length - 1 ? currentIdx + 1 : 0;
      } else {
        currentIdx = currentIdx > 0 ? currentIdx - 1 : items.length - 1;
      }

      dropdownSelectedIndex.set(id, currentIdx);
      items[currentIdx].classList.add('selected');
      items[currentIdx].scrollIntoView({ block: 'nearest' });
    };

    const confirmDropdownSelection = (id) => {
      const dd = win.querySelector(`#slash-dropdown-${id}`);
      if (!dd || dd.style.display === 'none') return false;

      const idx = dropdownSelectedIndex.get(id);
      if (idx >= 0) {
        const items = dd.querySelectorAll('.slash-item');
        if (items[idx]) {
          const cmdName = items[idx].dataset.command;
          const commands = slashCommandsCache.get(id) || [];
          const cmd = commands.find(c => c.command === cmdName);
          if (cmd) {
            selectSlashCommand(id, cmd);
            return true;
          }
        }
      }
      return false;
    };

    const checkExactMatch = (id, value) => {
      if (!value.startsWith('/')) return;
      const cmdName = value.substring(1).toLowerCase();
      const commands = slashCommandsCache.get(id) || [];
      const match = commands.find(c => c.command.toLowerCase() === cmdName);
      if (match) {
        selectSlashCommand(id, match);
      }
    };

    if (input) {
      input.addEventListener('keydown', (e) => {
        e.stopPropagation();

        const isLocked = selectedSlashCommand.get(uniqueId) !== null;
        const dd = win.querySelector(`#slash-dropdown-${uniqueId}`);
        const dropdownVisible = dd && dd.style.display !== 'none';

        if (isLocked && (e.key === 'Backspace' || e.key === 'Delete')) {
          e.preventDefault();
          unlockInput(uniqueId);
          return;
        }

        if (dropdownVisible) {
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            updateDropdownSelection(uniqueId, 'down');
            return;
          }
          if (e.key === 'ArrowUp') {
            e.preventDefault();
            updateDropdownSelection(uniqueId, 'up');
            return;
          }
          if (e.key === 'Enter') {
            e.preventDefault();
            if (confirmDropdownSelection(uniqueId)) {
              return;
            }
            submit();
            return;
          }
          if (e.key === 'Escape') {
            e.preventDefault();
            hideSlashDropdown(uniqueId);
            input.value = '';
            return;
          }
        } else {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            submit();
            return;
          }
        }
      });

      input.addEventListener('input', (e) => {
        const value = e.target.value;

        if (value.startsWith('/') && value.length >= 1) {
          const filterText = value.substring(1);
          showSlashDropdown(uniqueId, filterText);

          if (filterText.length > 0) {
            checkExactMatch(uniqueId, value);
          }
        } else {
          hideSlashDropdown(uniqueId);
        }
      });

      input.addEventListener('keyup', (e) => e.stopPropagation());
      input.addEventListener('keypress', (e) => e.stopPropagation());

      input.addEventListener('blur', () => {
        setTimeout(() => hideSlashDropdown(uniqueId), 150);
      });
    }

    if (sendBtn) {
      sendBtn.addEventListener('click', submit);
    }

    const clearBtn = win.querySelector(`#clear-command-${uniqueId}`);
    if (clearBtn) {
      clearBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        unlockInput(uniqueId);
      });
    }
  }

  function sendFollowUp(uniqueId, question) {
    startStreamSession(uniqueId);
    setChatEnabled(uniqueId, false, 'placeholderThinking');
    const win = floatingWindows.get(uniqueId); // ShadowRoot
    if (win) {
      // Format question - show /command for slash commands, otherwise text
      const selected = selectedSlashCommand.get(uniqueId);
      const displayQuestion = selected ? `/${selected.command}` : (question.startsWith('/') ? question.split('\n')[0] : question);
      const formattedQuestion = `\n\n---\n**YOU:** ${displayQuestion}\n\n---\n`;

      // Render question immediately
      handleMessage(formattedQuestion, uniqueId);
    }

    // Update history
    if (!chatHistories.has(uniqueId)) {
      chatHistories.set(uniqueId, []);
    }
    const history = chatHistories.get(uniqueId);
    history.push({ role: 'user', content: question });

    // Send to background
    chrome.runtime.sendMessage({
      action: 'submitFollowUp',
      uniqueId: uniqueId,
      messages: history
    }, (response) => {
      if (chrome.runtime.lastError) {
        console.log('Error sending follow-up:', chrome.runtime.lastError.message);
        setChatEnabled(uniqueId, true, 'placeholderFollowUp');
      }
    });
  }

  function startStreamSession(uniqueId) {
    activeStreams.add(uniqueId);
    startHeartbeat(uniqueId);
  }

  function stopStreamSession(uniqueId) {
    activeStreams.delete(uniqueId);
    stopHeartbeat(uniqueId);
  }

  function startHeartbeat(uniqueId) {
    if (streamHeartbeatPorts.has(uniqueId)) {
      return;
    }

    try {
      const port = chrome.runtime.connect({ name: 'sSummarizer-stream-heartbeat' });
      streamHeartbeatPorts.set(uniqueId, port);

      port.onMessage.addListener(() => {
        // Ack is intentionally ignored; the message itself helps keep the worker active.
      });

      port.onDisconnect.addListener(() => {
        streamHeartbeatPorts.delete(uniqueId);
        const timerId = streamHeartbeatTimers.get(uniqueId);
        if (timerId) {
          clearInterval(timerId);
          streamHeartbeatTimers.delete(uniqueId);
        }

        if (activeStreams.has(uniqueId)) {
          recoverInterruptedStream(uniqueId);
        }
      });

      const sendHeartbeat = () => {
        const currentPort = streamHeartbeatPorts.get(uniqueId);
        if (!currentPort) return;
        try {
          currentPort.postMessage({
            type: 'heartbeat',
            uniqueId,
            ts: Date.now()
          });
        } catch (e) {
        }
      };

      sendHeartbeat();
      const timerId = setInterval(sendHeartbeat, STREAM_HEARTBEAT_INTERVAL_MS);
      streamHeartbeatTimers.set(uniqueId, timerId);
    } catch (error) {
      console.log('[Content] Failed to start heartbeat:', error);
    }
  }

  function stopHeartbeat(uniqueId) {
    const timerId = streamHeartbeatTimers.get(uniqueId);
    if (timerId) {
      clearInterval(timerId);
      streamHeartbeatTimers.delete(uniqueId);
    }

    const port = streamHeartbeatPorts.get(uniqueId);
    if (port) {
      streamHeartbeatPorts.delete(uniqueId);
      try {
        port.disconnect();
      } catch (e) {
      }
    }
  }

  function recoverInterruptedStream(uniqueId) {
    if (!activeStreams.has(uniqueId)) return;
    activeStreams.delete(uniqueId);

    const win = floatingWindows.get(uniqueId);
    if (!win) return;

    hideLoading(uniqueId);
    handleMessage('\n\n---\n[Info] Stream interrupted (background worker restarted or disconnected). You can ask a follow-up to continue.', uniqueId);
    setChatEnabled(uniqueId, true, 'placeholderFollowUp');
  }

  function scheduleContentRender(uniqueId) {
    if (contentRenderTimers.has(uniqueId)) {
      return;
    }

    const timerId = setTimeout(() => {
      contentRenderTimers.delete(uniqueId);
      requestAnimationFrame(() => flushContentRender(uniqueId));
    }, STREAM_RENDER_BATCH_MS);

    contentRenderTimers.set(uniqueId, timerId);
  }

  function flushContentRender(uniqueId) {
    const win = floatingWindows.get(uniqueId);
    if (!win) {
      return;
    }

    const contentElement = win.querySelector(`#content-${uniqueId}`);
    if (!contentElement) {
      return;
    }

    const currentBuffer = contentBuffers.get(uniqueId) || '';

    isContentUpdating.set(uniqueId, true);
    const savedScrollTop = contentElement.scrollTop;
    const wasScrolledUp = userScrolledUp.get(uniqueId);

    contentElement.innerHTML = sanitizeContent(currentBuffer);

    if (!wasScrolledUp) {
      requestAnimationFrame(() => {
        contentElement.scrollTop = contentElement.scrollHeight;
        isContentUpdating.set(uniqueId, false);
      });
    } else {
      requestAnimationFrame(() => {
        contentElement.scrollTop = savedScrollTop;
        isContentUpdating.set(uniqueId, false);
        updateScrollButtonVisibility(uniqueId);
      });
    }

    const currentFontSize = textSizes.get(uniqueId) || UI_CONFIG.DEFAULT_FONT_SIZE;
    contentElement.style.fontSize = `${currentFontSize}px`;
  }

})();
