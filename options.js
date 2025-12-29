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
  
  function save_options() {
    // Gather all settings
    const settings = {};

    // Color
    let colorSelect = document.getElementById("color");
    let colorValue = colorSelect.value;
    settings.colorCode = colorCodes[colorValue];

    // Width
    let widthSelect = document.getElementById("width");
    settings.width = widthSelect.value;

    // Rocker
    const rocker = document.getElementById('rocker');
    settings.rocker = rocker.checked;

    // Trail
    const trail = document.getElementById('trail');
    settings.trail = trail.checked;

    // Gestures
    const gestures = ["U", "D", "L", "R"];
    gestures.forEach(gesture => {
      const select = document.getElementById(`gesture-${gesture}`);
      settings[gesture] = select.value;
    });

    // Save all at once
    chrome.storage.local.set(settings, () => {
      console.log("Settings saved:", settings);
      
      // Update status to user
      const status = document.getElementById("status");
      status.innerHTML = "Configuration Saved";
      setTimeout(() => {
        status.innerHTML = "";
      }, 750);
    });
  }
  
  function restore_options() {
    const gestures = ["U", "D", "L", "R"];
    const settingsToGet = ["colorCode", "width", "rocker", "trail", ...gestures];
    chrome.storage.local.get(settingsToGet, (result) => {
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
      gestures.forEach(gesture => {
        let gestureSelect = document.getElementById(`gesture-${gesture}`);
        gestureSelect.value = result[gesture] || defaultGests[gesture];
      });
    });
  }
  
  // Event Listener
  document.addEventListener('DOMContentLoaded', function() {
    console.log("Options page loaded"); // Debug log
    restore_options();
    document.querySelector('#save').addEventListener('click', save_options);
  });