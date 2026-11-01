(function() {
  const state = {
    rmousedown: false, // a right-button gesture started in this frame
    moved: false,
    rocker: false,
    trail: false,
    rockerRL: "back",
    rockerLR: "forward",
    mx: 0,
    my: 0,
    nx: 0,
    ny: 0,
    lx: 0,
    ly: 0,
    phi: 0,
    move: "",
    omove: "",
    link: null,
    myColor: "red",
    myWidth: 3,
    rocked: false,
    skip: false,
  };
  const pi = Math.PI;
  let canvas, ctx;

  function createCanvas() {
    if (!document.body) {
      console.warn("sGesture: document.body not ready for canvas creation.");
      return;
    }
    if (!canvas) {
      canvas = document.createElement('canvas');
      canvas.id = "gestCanvas";
      canvas.style.position = 'fixed';
      canvas.style.top = '0';
      canvas.style.left = '0';
      canvas.style.zIndex = '10000';
      canvas.style.pointerEvents = 'none';
      document.body.appendChild(canvas);
      ctx = canvas.getContext('2d');
    }
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    canvas.style.display = 'block';
    ctx.clearRect(0, 0, canvas.width, canvas.height);
  }

  function draw(x, y) {
    if (!ctx) return;
    ctx.beginPath();
    ctx.strokeStyle = state.myColor;
    ctx.lineWidth = state.myWidth;
    ctx.moveTo(state.lx, state.ly);
    ctx.lineTo(x, y);
    ctx.stroke();
    state.lx = x;
    state.ly = y;
  }

  function exeFunc() {
    try {
      if (!chrome.runtime || !chrome.runtime.id) {
        console.error("sGesture: Extension context invalidated. Cannot execute function.");
        return;
      }
      
      // Look up the full gesture string (e.g. "DR") — that's the key the action
      // is stored under, not its individual direction characters.
      chrome.storage.local.get([state.move], (gests) => {
        if (chrome.runtime.lastError) {
          console.error("sGesture: Error getting gestures from storage:", chrome.runtime.lastError.message);
          return;
        }
        const action = gests[state.move];
        if (action) {
          handleAction(action);
        }
      });
    } catch (e) {
      console.error("sGesture: Error executing function: ", e);
    }
  }

  function handleAction(action) {
    const actions = {
      back: () => window.history.back(),
      forward: () => window.history.forward(),
      newtab: () => {
        if (state.link === null) {
          sendChromeMessage("newtab");
        }
        else {
          // Security: Prevent execution of javascript: URLs
          if (state.link.trim().toLowerCase().startsWith('javascript:')) {
            console.warn("sGesture: Blocked attempt to open javascript: URL");
            return;
          }
          // Route through the background worker via chrome.tabs.create. This
          // action runs inside an async storage callback, so a direct
          // window.open() would be outside the user-activation window and
          // blocked by the popup blocker.
          sendChromeMessage("openurl", { url: state.link });
        }
      },
      closetab: () => sendChromeMessage("closetab"),
      lasttab: () => sendChromeMessage("lasttab"),
      reloadall: () => sendChromeMessage("reloadall"),
      closeall: () => sendChromeMessage("closeall"),
      nexttab: () => sendChromeMessage("nexttab"),
      prevtab: () => sendChromeMessage("prevtab"),
      closeback: () => sendChromeMessage("closeback"),
      scrolltop: () => window.scrollTo(0, 0),
      scrollbottom: () => window.scrollTo(0, document.body.scrollHeight),
      reload: () => window.location.reload(),
      stop: () => window.stop(),
    };

    if (actions[action]) {
      actions[action]();
    } else {
      console.warn("sGesture: Unknown action:", action);
    }
  }

  function sendChromeMessage(msg, extra) {
    if (!chrome.runtime || !chrome.runtime.id) {
      console.error("sGesture: Extension context invalidated.");
      return;
    }

    chrome.runtime.sendMessage(Object.assign({ msg: msg }, extra), () => {
      if (chrome.runtime.lastError) {
        console.error('sGesture: Error in sendChromeMessage:', chrome.runtime.lastError.message);
      }
    });
  }

  function loadOptions() {
    try {
      if (!chrome.runtime || !chrome.runtime.id) {
        return;
      }
      chrome.storage.local.get(["colorCode", "width", "rocker", "trail", "rockerRL", "rockerLR"], (result) => {
        if (chrome.runtime.lastError) {
          console.error(chrome.runtime.lastError);
          return;
        }
        state.myColor = "#" + (result.colorCode || "FF3300");
        state.myWidth = result.width || 3;
        state.rocker = result.rocker === true;
        state.trail = result.trail === true;
        state.rockerRL = result.rockerRL || "back";
        state.rockerLR = result.rockerLR || "forward";
      });
    } catch (e) {
      console.error("sGesture: Error loading options: ", e);
    }
  }

  function initEventListeners() {
    // Read the live button state (event.buttons: 1 = left, 2 = right) instead of
    // tracking it from mouseup: mouseup is never sent after a drag-and-drop or
    // when the context menu opens on mousedown (Mac/Linux), which left a stale
    // flag that turned the next plain click into a rocker action. Window capture
    // also sees events the page stops from propagating.
    window.addEventListener('mousedown', (event) => {
      // Ignore script-synthesized events: a page could otherwise dispatch fake
      // mouse events to forge a gesture and trigger destructive tab commands
      // (closeall/closetab/reloadall) without any real user interaction.
      if (!event.isTrusted) return;
      if (event.button === 0) { // Left-click
        if ((event.buttons & 2) && state.rocker) {
          // R->L rocker gesture
          handleAction(state.rockerRL);
          state.rocked = true;
          event.preventDefault();
        }
      } else if (event.button === 2) { // Right-click
        state.rmousedown = true;
        if ((event.buttons & 1) && state.rocker) {
          // L->R rocker gesture
          handleAction(state.rockerLR);
          state.rocked = true;
          event.preventDefault();
        } else {
          // Start of a normal gesture.
          // Clear any stale rocker flag from a previous sequence whose
          // contextmenu never fired; otherwise the next gesture's mouseup
          // (which requires !state.rocked) would be silently skipped.
          state.rocked = false;
          // Don't hijack right-clicks inside form fields / editable content —
          // leave the native context menu (paste, spellcheck, ...) intact.
          const tgt = event.target;
          state.skip = !!(tgt && tgt.closest &&
            tgt.closest('input, textarea, select, [contenteditable=""], [contenteditable="true"]'));
          state.moved = false;
          state.my = event.clientY;
          state.mx = event.clientX;
          state.lx = state.mx;
          state.ly = state.my;
          state.move = "";
          state.omove = "";
          state.link = event.target.closest('a') ? event.target.closest('a').href : null;
        }
      }
    }, true);

    window.addEventListener('mousemove', (event) => {
      if (!event.isTrusted) return;
      if (!(event.buttons & 2)) state.rmousedown = false; // right button was released without a mouseup
      if (state.rmousedown && !(event.buttons & 1) && !state.skip) { // Right button down (not left), outside editable fields
        state.ny = event.clientY;
        state.nx = event.clientX;
        const r = Math.sqrt(Math.pow(state.nx - state.mx, 2) + Math.pow(state.ny - state.my, 2));
        if (r > 16) {
          state.phi = Math.atan2(state.ny - state.my, state.nx - state.mx);
          if (state.phi < 0) state.phi += 2 * pi;
          let tmove = "";
          if (state.phi >= pi / 4 && state.phi < 3 * pi / 4) tmove = "D";
          else if (state.phi >= 3 * pi / 4 && state.phi < 5 * pi / 4) tmove = "L";
          else if (state.phi >= 5 * pi / 4 && state.phi < 7 * pi / 4) tmove = "U";
          else if (state.phi >= 7 * pi / 4 || state.phi < pi / 4) tmove = "R";
          if (tmove !== state.omove) {
            state.move += tmove;
            state.omove = tmove;
          }
          if (!state.moved) {
            createCanvas();
          }
          state.moved = true;
          if (state.trail) {
            draw(state.nx, state.ny);
          }
          state.mx = state.nx;
          state.my = state.ny;
        }
      }
    }, true);

    window.addEventListener('mouseup', (event) => {
      if (!event.isTrusted) return;
      if (event.button === 2) { // Right-click up
        if (state.rmousedown && state.moved && !state.rocked) {
          exeFunc();
        }
        state.rmousedown = false;
        if (canvas) {
          canvas.style.display = 'none';
        }
        // Note: state.link must NOT be cleared here. exeFunc() reads it
        // asynchronously (inside a chrome.storage.local.get callback), so
        // clearing it now would wipe the link before the "newtab" action runs,
        // making "open link in new tab" gestures always open a blank tab.
        // It is re-initialized at the start of every gesture on mousedown.
      }

      // Prevent default action if a rocker gesture was performed
      if (state.rocked) {
        event.preventDefault();
      }
    }, true);

    window.addEventListener('contextmenu', (event) => {
      if (state.rocked || state.moved) {
        event.preventDefault();
        event.stopPropagation();
        state.rocked = false; // Reset after preventing context menu
        state.moved = false;  // Reset after preventing context menu
        return;
      }
      // The native menu is opening (on Mac/Linux before mouseup), so the gesture is over.
      state.rmousedown = false;
    }, true);

    window.addEventListener('resize', () => {
      if (canvas) {
        canvas.width = window.innerWidth;
        canvas.height = window.innerHeight;
      }
    });
  }

  function init() {
    loadOptions();
    initEventListeners();
  }

  init();
})();

