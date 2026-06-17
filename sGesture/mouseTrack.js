(function() {
  const state = {
    rmousedown: false,
    moved: false,
    lmousedown: false,
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
          window.open(state.link);
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
      console.log(`sGesture: Executing action: ${action}`);
      actions[action]();
    } else {
      console.warn("sGesture: Unknown action:", action);
    }
  }

  function sendChromeMessage(msg) {
    if (!chrome.runtime || !chrome.runtime.id) {
      console.error("sGesture: Extension context invalidated.");
      return;
    }

    chrome.runtime.sendMessage({ msg: msg }, (response) => {
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
        console.log("sGesture: Options loaded", state);
      });
    } catch (e) {
      console.error("sGesture: Error loading options: ", e);
    }
  }

  function initEventListeners() {
    document.addEventListener('mousedown', (event) => {
      if (event.button === 0) { // Left-click
        state.lmousedown = true;
        if (state.rmousedown && state.rocker) {
          // R->L rocker gesture
          handleAction(state.rockerRL);
          state.rocked = true;
          console.log("sGesture: Rocker (R->L) detected. state.rocked = true");
          event.preventDefault();
        }
      } else if (event.button === 2) { // Right-click
        state.rmousedown = true;
        if (state.lmousedown && state.rocker) {
          // L->R rocker gesture
          handleAction(state.rockerLR);
          state.rocked = true;
          console.log("sGesture: Rocker (L->R) detected. state.rocked = true");
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
    });

    document.addEventListener('mousemove', (event) => {
      if (state.rmousedown && !state.lmousedown && !state.skip) { // Right button down (not left), outside editable fields
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
    });

    document.addEventListener('mouseup', (event) => {
      const wasRocked = state.rocked;
      console.log(`sGesture: mouseup event.button: ${event.button}, wasRocked: ${wasRocked}, state.rocked: ${state.rocked}`);

      if (event.button === 0) { // Left-click up
        state.lmousedown = false;
      } else if (event.button === 2) { // Right-click up
        state.rmousedown = false;
        if (state.moved && !state.rocked) {
          exeFunc();
        }
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
      if (wasRocked) {
        event.preventDefault();
      }
    });

    document.addEventListener('contextmenu', (event) => {
      console.log(`sGesture: contextmenu event. state.rocked: ${state.rocked}, state.moved: ${state.moved}`);
      if (state.rocked || state.moved) {
        event.preventDefault();
        event.stopPropagation(); // Add this line
        state.rocked = false; // Reset after preventing context menu
        state.moved = false;  // Reset after preventing context menu
        return false;
      }
    });

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

