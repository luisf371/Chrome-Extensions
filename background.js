// background.js

let scanState = {
  isScanning: false,
  mode: null,      // 'broken' or 'duplicates'
  total: 0,
  currentIndex: 0, // Pointer for resume capability
  queue: [],       // Array of { id, title, url, path } to be checked
  broken: [],      // Array of { id, title, url, status, path }
  duplicates: {},  // Object map: url -> Array of { id, title, path }
  lastScanDateBroken: null,
  lastScanDateDuplicates: null
};

// Runtime flag to prevent double-processing in the same SW instance
let isProcessing = false;

// Initialization Promise
let stateReadyResolve;
const stateReady = new Promise(resolve => stateReadyResolve = resolve);

// Initialize state from storage
chrome.storage.local.get(['scanState'], (result) => {
  try {
    if (result.scanState) {
      // Merge saved state with defaults to ensure new fields exist
      scanState = { ...scanState, ...result.scanState };
      
      // If we were scanning, we might want to auto-resume or just reset to paused.
      // For now, let's just load it.
    }
  } catch (e) {
    console.error("Error restoring state:", e);
  } finally {
    stateReadyResolve();
  }
});

// Alarm Listener - acts as a heartbeat
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'scanKeepAlive') {
    // Wait for state to be ready before checking if we should resume
    stateReady.then(() => {
      if (scanState.isScanning && !isProcessing) {
          console.log("Alarm triggered resume.");
          processQueue();
      }
    });
  }
});

// Listen for messages
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'startBrokenScan') {
    startScan('broken');
    sendResponse({ started: true });
  } else if (request.action === 'startDuplicateScan') {
    startScan('duplicates');
    sendResponse({ started: true });
  } else if (request.action === 'startSort') {
    startSort().then(() => sendResponse({ success: true }));
    return true; // Async response
  } else if (request.action === 'resumeScan') {
    resumeScan();
    sendResponse({ resumed: true });
  } else if (request.action === 'getStatus') {
    // Wait for init to complete before replying
    stateReady.then(() => {
      const safeState = {
        isScanning: scanState.isScanning,
        mode: scanState.mode,
        total: scanState.queue ? scanState.queue.length : 0,
        checked: scanState.currentIndex,
        broken: scanState.broken,
        duplicates: scanState.duplicates,
        lastScanDateBroken: scanState.lastScanDateBroken,
        lastScanDateDuplicates: scanState.lastScanDateDuplicates
      };
      sendResponse(safeState);
    });
    return true; // Keep channel open
  } else if (request.action === 'openReport') {
    chrome.tabs.create({ url: 'report.html' });
  } else if (request.action === 'deleteBookmarks') {
    deleteBookmarks(request.ids).then((results) => sendResponse(results));
    return true; 
  } else if (request.action === 'recheckBookmarks') {
    recheckBookmarks(request.ids).then((results) => sendResponse(results));
    return true;
  } else if (request.action === 'ignoreBookmarks') {
    ignoreBookmarks(request.ids).then(() => sendResponse({ success: true }));
    return true;
  }
});

// --- Core Scanning Logic ---

async function startSort(scope = 'parent') {
  try {
    const tree = await chrome.bookmarks.getTree();
    // tree[0] is the root. Its children are "Bookmarks Bar", "Other Bookmarks", etc.
    // We usually want to sort the contents of those roots.
    // If scope is 'recursive', we go deep.
    // If scope is 'parent', we only sort the immediate children of the main roots (level 1).
    
    // Actually, tree[0] children are the roots. We iterate them.
    if (tree[0].children) {
      for (const root of tree[0].children) {
        await sortTree(root, scope === 'recursive');
      }
    }
    return true;
  } catch (e) {
    console.error("Sort error:", e);
    return false;
  }
}

async function startScan(mode) {
  // 1. Get Settings
  const settings = await chrome.storage.local.get(['scanTimeout', 'autoSort', 'sortScope']);
  const timeout = settings.scanTimeout || 5000;
  
  // Auto Sort if requested
  if (settings.autoSort) {
    await startSort(settings.sortScope || 'parent');
  }

  // 2. Reset State specific to the new scan, keep the other results
  scanState.isScanning = true;
  scanState.mode = mode;
  scanState.total = 0;
  scanState.currentIndex = 0;
  scanState.queue = [];
  // Store timeout in scanState or just pass it? 
  // Storing in scanState implies it persists across resumes which is good.
  scanState.timeout = timeout; 
  
  if (mode === 'broken') {
    scanState.broken = [];
    scanState.lastScanDateBroken = null;
  } else if (mode === 'duplicates') {
    scanState.duplicates = {};
    scanState.lastScanDateDuplicates = null;
  }

  await chrome.storage.local.set({ scanState });

  // Create Keep-Alive Alarm (fires every 30s)
  chrome.alarms.create('scanKeepAlive', { periodInMinutes: 0.5 });

  try {
    const tree = await chrome.bookmarks.getTree();
    
    // 3. Build Queue
    buildQueue(tree[0]);
    
    scanState.total = scanState.queue.length;
    await chrome.storage.local.set({ scanState });

    // 4. Process Queue
    processQueue();

  } catch (error) {
    console.error("Scan initialization error:", error);
    scanState.isScanning = false;
    await chrome.storage.local.set({ scanState });
    chrome.alarms.clear('scanKeepAlive');
  }
}

function resumeScan() {
  if (isProcessing) return; // Already running locally
  if (scanState.currentIndex >= scanState.queue.length) return; // Already done

  scanState.isScanning = true;
  chrome.storage.local.set({ scanState }); 
  
  // Ensure alarm exists
  chrome.alarms.create('scanKeepAlive', { periodInMinutes: 0.5 });
  
  processQueue();
}

async function processQueue() {
  if (isProcessing) return;
  isProcessing = true;

  try {
    // Loop from currentIndex to end
    while (scanState.currentIndex < scanState.queue.length) {
      if (!scanState.isScanning) break; // Paused/Stopped by user

      const item = scanState.queue[scanState.currentIndex];
      
      if (scanState.mode === 'duplicates') {
        // 1. Check Duplicates
        if (scanState.duplicates[item.url]) {
          scanState.duplicates[item.url].push({
            id: item.id,
            title: item.title,
            path: item.path
          });
        } else {
          scanState.duplicates[item.url] = [{
            id: item.id,
            title: item.title,
            path: item.path
          }];
        }
      } else if (scanState.mode === 'broken') {
        // 2. Check Validity (http/https only)
        if (item.url.startsWith('http')) {
           try {
            // Use stored timeout or default
            const timeout = scanState.timeout || 5000;
            const status = await checkUrl(item.url, timeout);
            if (status !== 200) {
              scanState.broken.push({
                id: item.id,
                title: item.title,
                url: item.url,
                status: status,
                path: item.path
              });
            }
          } catch (err) {
            scanState.broken.push({
              id: item.id,
              title: item.title,
              url: item.url,
              status: 'DNS Error',
              path: item.path
            });
          }
        }
      }

      // Advance
      scanState.currentIndex++;

      // Checkpoint: Every 20 items
      if (scanState.currentIndex % 20 === 0) {
        await chrome.storage.local.set({ scanState });
      }
    }
  } catch (err) {
    console.error("Process Queue Error:", err);
  } finally {
    isProcessing = false;
    
    // If finished
    if (scanState.currentIndex >= scanState.queue.length && scanState.isScanning) {
      completeScan();
    } else if (!scanState.isScanning) {
        // Paused manually
        chrome.alarms.clear('scanKeepAlive');
    }
  }
}

async function completeScan() {
  if (scanState.mode === 'duplicates') {
      // Prune duplicates
      for (const url in scanState.duplicates) {
        if (scanState.duplicates[url].length <= 1) {
          delete scanState.duplicates[url];
        }
      }
      scanState.lastScanDateDuplicates = Date.now();
  } else if (scanState.mode === 'broken') {
      scanState.lastScanDateBroken = Date.now();
  }

  scanState.isScanning = false;
  scanState.mode = null;
  
  await chrome.storage.local.set({ scanState });
  chrome.alarms.clear('scanKeepAlive');
}
// --- Helpers ---

async function sortTree(node, recursive = true) {
  if (node.children) {
    // If it's the root (0), we don't sort it itself, we sort its children (processed in startSort)
    // But here we are passed a node.
    
    const folders = node.children.filter(child => child.children);
    const bookmarks = node.children.filter(child => !child.children);

    folders.sort((a, b) => a.title.localeCompare(b.title));
    bookmarks.sort((a, b) => a.title.localeCompare(b.title));

    const sortedChildren = [...folders, ...bookmarks];
    for (let i = 0; i < sortedChildren.length; i++) {
      const child = sortedChildren[i];
      if (node.id !== '0' && child.index !== i) {
         await chrome.bookmarks.move(child.id, { index: i, parentId: node.id });
      }
      
      // Recurse only if requested
      if (recursive && child.children) {
        await sortTree(child, true);
      }
    }
  }
}

function buildQueue(node, path = []) {
  if (node.children) {
    const newPath = node.title ? [...path, node.title] : path;
    for (const child of node.children) {
      buildQueue(child, newPath);
    }
  } else if (node.url) {
    scanState.queue.push({
      id: node.id,
      title: node.title,
      url: node.url,
      path: path.join(' > ')
    });
  }
}

async function checkUrl(url, timeout = 5000) {
  const commonHeaders = {
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
    'Accept-Language': 'en-US,en;q=0.9',
    'Cache-Control': 'no-cache',
    'Pragma': 'no-cache'
  };

  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeout);

  const fetchOptions = { 
    method: 'HEAD',
    redirect: 'follow',
    credentials: 'include',
    headers: commonHeaders,
    signal: controller.signal
  };

  try {
    let response = await fetch(url, fetchOptions);
    clearTimeout(id);
    
    if (response.status === 403 || response.status === 405) {
      // Retry with GET if HEAD fails
      const controller2 = new AbortController();
      const id2 = setTimeout(() => controller2.abort(), timeout);
      response = await fetch(url, { ...fetchOptions, method: 'GET', signal: controller2.signal });
      clearTimeout(id2);
    }
    return response.ok ? 200 : response.status;
  } catch (e) {
    clearTimeout(id);
    if (e.name === 'AbortError') {
      return 'Timeout';
    }
    return 'DNS Error';
  }
}

// --- CRUD Operations ---

async function recheckBookmarks(ids) {
  const results = { fixed: [], stillBroken: [] };
  const itemsToCheck = scanState.broken.filter(b => ids.includes(b.id));
  
  for (const item of itemsToCheck) {
    try {
      const status = await checkUrl(item.url);
      if (status === 200) {
        scanState.broken = scanState.broken.filter(b => b.id !== item.id);
        results.fixed.push(item.id);
      } else {
        item.status = status;
        results.stillBroken.push(item.id);
      }
    } catch (err) {
      item.status = 'DNS Error';
      results.stillBroken.push(item.id);
    }
  }
  await chrome.storage.local.set({ scanState });
  return results;
}

async function ignoreBookmarks(ids) {
  scanState.broken = scanState.broken.filter(b => !ids.includes(b.id));
  await chrome.storage.local.set({ scanState });
}

async function deleteBookmarks(ids) {
  const results = { success: [], failed: [] };
  for (const id of ids) {
    try {
      await chrome.bookmarks.remove(id);
      results.success.push(id);
      scanState.broken = scanState.broken.filter(b => b.id !== id);
      
      // Update duplicates
      for (const url in scanState.duplicates) {
        scanState.duplicates[url] = scanState.duplicates[url].filter(d => d.id !== id);
        if (scanState.duplicates[url].length <= 1) delete scanState.duplicates[url];
      }
    } catch (e) {
      results.failed.push(id);
    }
  }
  await chrome.storage.local.set({ scanState });
  return results;
}

chrome.bookmarks.onRemoved.addListener((id, removeInfo) => {
  let stateChanged = false;
  const initialBrokenCount = scanState.broken.length;
  scanState.broken = scanState.broken.filter(b => b.id !== id);
  if (scanState.broken.length !== initialBrokenCount) stateChanged = true;

  for (const url in scanState.duplicates) {
    const initialLen = scanState.duplicates[url].length;
    scanState.duplicates[url] = scanState.duplicates[url].filter(d => d.id !== id);
    if (scanState.duplicates[url].length !== initialLen) {
      stateChanged = true;
      if (scanState.duplicates[url].length <= 1) delete scanState.duplicates[url];
    }
  }
  if (stateChanged) chrome.storage.local.set({ scanState });
});

// --- Lifecycle Handlers ---

function pauseScanOnRestart() {
  // Wait for init to finish so we have the loaded scanState
  stateReady.then(() => {
    if (scanState.isScanning) {
      console.log("Browser/Extension restart detected. Pausing active scan.");
      // Update global state in memory
      scanState.isScanning = false;
      // Persist to storage
      chrome.storage.local.set({ scanState });
      // Kill the heartbeat (user must manually resume)
      chrome.alarms.clear('scanKeepAlive');
    }
  });
}

chrome.runtime.onStartup.addListener(pauseScanOnRestart);
chrome.runtime.onInstalled.addListener(pauseScanOnRestart);