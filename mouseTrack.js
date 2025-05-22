let rmousedown = false, moved = false, lmousedown = false;
let rocker = false, trail = false;
let mx, my, nx, ny, lx, ly, phi;
let move = "", omove = "";
const pi = Math.PI;
let suppress = 1;
let canvas, ctx;
let link, myColor = "red", myWidth = 3;
let loaded = false, rocked = false;
let lastMouseDown = 0;
const ROCKER_DELAY = 200; // ms
console.log("mouseTrack.js loaded"); // Debug log

function createCanvas() {
  if (!document.body) { // Add this check
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
    document.body.appendChild(canvas); // This line is critical
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
  ctx.strokeStyle = myColor;
  ctx.lineWidth = myWidth;
  ctx.moveTo(lx, ly);
  ctx.lineTo(x, y);
  ctx.stroke();
  lx = x;
  ly = y;
}

document.addEventListener('mousedown', function(event) {
  const now = Date.now();
  if (event.button === 0) {
    lmousedown = true;
    lastMouseDown = now;
  } else if (event.button === 2) {
    rmousedown = true;
    if (now - lastMouseDown < ROCKER_DELAY && rocker && suppress) {
      if (!loaded) {
        loadOptions();
        loaded = true;
      }
      move = 'back';
      rocked = true;
      exeRock();
    } else if (suppress) {
      if (!loaded) {
        loadOptions();
        loaded = true;
      }
      my = event.clientY; // Use clientY
      mx = event.clientX; // Use clientX
      lx = mx;
      ly = my;
      move = "";
      omove = "";
      moved = false;
      link = event.target.closest('a') ? event.target.closest('a').href : null;
    }
  }
});

document.addEventListener('mousemove', function(event) {
  if (rmousedown) {
    ny = event.clientY; // Use clientY
    nx = event.clientX; // Use clientX
    const r = Math.sqrt(Math.pow(nx - mx, 2) + Math.pow(ny - my, 2));
    if (r > 16) {
      phi = Math.atan2(ny - my, nx - mx);
      if (phi < 0) phi += 2 * pi;
      let tmove = "";
      if (phi >= pi / 4 && phi < 3 * pi / 4) tmove = "D";
      else if (phi >= 3 * pi / 4 && phi < 5 * pi / 4) tmove = "L";
      else if (phi >= 5 * pi / 4 && phi < 7 * pi / 4) tmove = "U";
      else if (phi >= 7 * pi / 4 || phi < pi / 4) tmove = "R";
      if (tmove !== omove) {
        move += tmove;
        omove = tmove;
      }
      if (!moved) {
        createCanvas();
      }
      moved = true;
      if (trail) {
        draw(nx, ny);
      }
      mx = nx;
      my = ny;
    }
  }
});

document.addEventListener('mouseup', function(event) {
  if (event.button === 0) {
    lmousedown = false;
  }

  if (event.button === 2) {
    rmousedown = false;
    if (moved) {
      exeFunc();
    } else if (rocked) {
      rocked = false;
    } else {
      suppress--;
    }
    if (canvas) {
      canvas.style.display = 'none';
    }
  }
});

function exeRock() {
  if (move === "back") {
    window.history.back();
  } else if (move === "forward") {
    window.history.forward();
  }
}

function exeFunc() {
  try {
    if (!chrome.runtime || !chrome.runtime.id) {
      console.error("Extension context invalidated.");
      return;
    }
    chrome.storage.local.get(["U", "D", "L", "R"], (gests) => {
      if (chrome.runtime.lastError) {
        console.error(chrome.runtime.lastError);
        return;
      }
      const action = gests[move];
      if (action) {
        if (action === "back") {
          window.history.back();
        } else if (action === "forward") {
          window.history.forward();
        } else if (action === "newtab") {
          if (link === null) {
            sendChromeMessage("newtab", (error, response) => {
              if (error) console.error('Error opening new tab:', error.message);
            });
          } else {
            window.open(link);
          }
        } else if (action === "closetab") {
          sendChromeMessage("closetab", (error, response) => {
            if (error) console.error('Error closing tab:', error.message);
          });
        } else if (action === "lasttab") {
          sendChromeMessage("lasttab", (error, response) => {
            if (error) console.error('Error opening last tab:', error.message);
          });
        } else if (action === "reloadall") {
          sendChromeMessage("reloadall", (error, response) => {
            if (error) console.error('Error reloading all tabs:', error.message);
          });
        } else if (action === "closeall") {
          sendChromeMessage("closeall", (error, response) => {
            if (error) console.error('Error closing all tabs:', error.message);
          });
        } else if (action === "nexttab") {
          sendChromeMessage("nexttab", (error, response) => {
            if (error) console.error('Error switching to next tab:', error.message);
          });
        } else if (action === "prevtab") {
          sendChromeMessage("prevtab", (error, response) => {
            if (error) console.error('Error switching to previous tab:', error.message);
          });
        } else if (action === "closeback") {
          sendChromeMessage("closeback", (error, response) => {
            if (error) console.error('Error closing background tabs:', error.message);
          });
        } else if (action === "scrolltop") {
          window.scrollTo(0, 0);
        } else if (action === "scrollbottom") {
          window.scrollTo(0, document.body.scrollHeight);
        } else if (action === "reload") {
          window.location.reload();
        } else if (action === "stop") {
          window.stop();
        }
      }
    });
  } catch (e) {
    console.error("Error executing function: ", e);
  }
}

function sendChromeMessage(msg, callback) {
    if (!chrome.runtime || !chrome.runtime.id) {
      console.error("Extension context invalidated.");
      callback(new Error("Extension context invalidated"));
      return;
    }
  
    console.log('Sending message:', msg);

    const timeoutId = setTimeout(() => {
        console.warn('Message response timeout for:', msg);
        callback(new Error('Message response timeout'));
    }, 5000);

    try {
        chrome.runtime.sendMessage({ msg: msg }, (response) => {
            clearTimeout(timeoutId);
            if (chrome.runtime.lastError) {
                console.error('Error in sendChromeMessage:', chrome.runtime.lastError.message);
                callback(new Error(chrome.runtime.lastError.message));
            } else if (response) {
                console.log('Received response:', response.resp);
                callback(null, response);
            } else {
                console.log('No response received for message:', msg);
                callback(new Error('No response received'));
            }
        });
    } catch (e) {
        clearTimeout(timeoutId);
        console.error('Exception in sendChromeMessage:', e.message);
        callback(new Error(e.message));
    }
  }

document.addEventListener('contextmenu', function(event) {
  if (suppress) {
    event.preventDefault();
    return false;
  } else {
    suppress++;
    if (canvas) {
      canvas.style.display = 'none';
    }
    rmousedown = false;
    return true;
  }
});

function loadOptions() {
  try {
    if (!chrome.runtime || !chrome.runtime.id) {
      console.log("Extension context invalidated.");
      return;
    }
    console.log("Extension context is valid. Loading options..."); // Debug log
    chrome.storage.local.get(["colorCode", "width", "rocker", "trail"], (result) => {
      if (chrome.runtime.lastError) {
        console.error(chrome.runtime.lastError);
        return;
      }
      myColor = "#" + (result.colorCode || "FF3300"); // Add "#" prefix
      myWidth = result.width || 3;
      rocker = result.rocker === true;
      trail = result.trail === true;
      console.log("Loaded options:", { myColor, myWidth, rocker, trail }); // Debug log
    });
  } catch (e) {
    console.error("Error loading options: ", e);
  }
}

document.addEventListener('DOMContentLoaded', function() {
  loadOptions();
});

// Ensure the canvas is resized when the window is resized
window.addEventListener('resize', function() {
  if (canvas) {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
  }
});
