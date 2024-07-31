const colorCodes = {
    "red": "FF3300",
    "green": "008000",
    "blue": "00008B",
    "yellow": "FFFF00",
    "black": "000000"
  };
  
  const colorNames = {
    "FF3300": "red",
    "008000":"green",
    "00008B": "blue",
    "FFFF00": "yellow",
    "000000": "black"
  };
  
  const defaultGests = {
    "U": "newtab",
    "R": "forward",
    "L": "back",
    "D": "closetab"
  };
  
  const commandTrans = {
    "History Back": "back",
    "History Forward": "forward",
    "Reload": "reload",
    "Stop Loading": "stop",
    "Open New Tab": "newtab",
    "Close Current Tab": "closetab",
    "Close Background Tabs": "closeback",
    "Close Window": "closeall",
    "Reload All Tabs": "reloadall",
    "Next Tab": "nexttab",
    "Previous Tab": "prevtab",
    "Scroll to Top": "scrolltop",
    "Scroll to Bottom": "scrollbottom",
    "Re-open Last Closed Tab": "lasttab"
  };
  
  function invertHash(hash) {
    const inv = {};
    for (const key in hash) {
      inv[hash[key]] = key;
    }
    return inv;
  }
  
  function fillMenu() {
    const gestures = ["U", "D", "L", "R"];
    gestures.forEach(gesture => {
      chrome.storage.local.get(gesture, (items) => {
        const action = items[gesture] || defaultGests[gesture];
        const select = document.getElementById(`gesture-${gesture}`);
        select.value = action;
      });
    });
  }
  
  function save_options() {
    // Save color
    let colorSelect = document.getElementById("color");
    let colorValue = colorSelect.value;
    let colorCode = colorCodes[colorValue];
    chrome.storage.local.set({ "colorCode": colorCode }, () => {
      console.log("Saved color:", colorValue, "Code:", colorCode); // Debug log
    });
  
    // Save width
    let widthSelect = document.getElementById("width");
    let widthValue = widthSelect.value;
    chrome.storage.local.set({ "width": widthValue }, () => {
      console.log("Saved width:", widthValue); // Debug log
    });
  
    // Save rocker setting
    const rocker = document.getElementById('rocker');
    chrome.storage.local.set({ "rocker": rocker.checked }, () => {
      console.log("Saved rocker:", rocker.checked); // Debug log
    });
  
    // Save trail setting
    const trail = document.getElementById('trail');
    chrome.storage.local.set({ "trail": trail.checked }, () => {
      console.log("Saved trail:", trail.checked); // Debug log
    });
  
    // Save gestures
    const gestures = ["U", "D", "L", "R"];
    gestures.forEach(gesture => {
      const select = document.getElementById(`gesture-${gesture}`);
      const action = select.value;
      chrome.storage.local.set({ [gesture]: action }, () => {
        console.log(`Saved gesture ${gesture}:`, action); // Debug log
      });
    });
  
    // Update status to user
    const status = document.getElementById("status");
    status.innerHTML = "Configuration Saved";
    setTimeout(() => {
      status.innerHTML = "";
    }, 750);
  }
  
  function restore_options() {
    chrome.storage.local.get(["colorCode", "width", "rocker", "trail"], (result) => {
      console.log("Restored options:", result); // Debug log
  
      // Restore color
      let colorSelect = document.getElementById("color");
      let colorCode = result.colorCode || "FF3300"; // Default to red if not set
      let colorName = colorNames[colorCode] || "red";
      colorSelect.value = colorName;
      console.log("Restored color:", colorName, "Code:", colorCode); // Debug log
  
      // Restore width
      let widthSelect = document.getElementById("width");
      widthSelect.value = result.width || "3";
  
      // Restore rocker
      let rockerCheckbox = document.getElementById('rocker');
      rockerCheckbox.checked = result.rocker === true;
  
      // Restore trail
      let trailCheckbox = document.getElementById('trail');
      trailCheckbox.checked = result.trail === true;
  
      // Restore gestures
      ["U", "D", "L", "R"].forEach(gesture => {
        let gestureSelect = document.getElementById(`gesture-${gesture}`);
        gestureSelect.value = result[gesture] || defaultGests[gesture];
      });
    });
  }
  
  function loadInfo() {
    restore_options();
    fillMenu();
  }
  
  // Event Listener
  document.addEventListener('DOMContentLoaded', function() {
    console.log("Options page loaded"); // Debug log
    loadInfo();
    document.querySelector('#save').addEventListener('click', save_options);
  });