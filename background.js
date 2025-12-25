// background.js

let scanState = {
  isScanning: false,
  total: 0,
  checked: 0,
  broken: [],     // Array of { id, title, url, status, path }
  duplicates: {}, // Object map: url -> Array of { id, title, path }
  currentPath: []
};

// Initialize state from storage
chrome.storage.local.get(['scanState'], (result) => {
  if (result.scanState) {
    scanState = result.scanState;
    // Ensure isScanning is false on reload (if it crashed/restarted during scan)
    scanState.isScanning = false;
  }
});

// Listen for messages from popup or report page
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'startScan') {
    if (!scanState.isScanning) {
      startScan();
    }
    sendResponse({ started: true });
  } else if (request.action === 'getStatus') {
    sendResponse(scanState);
  } else if (request.action === 'openReport') {
    chrome.tabs.create({ url: 'report.html' });
  } else if (request.action === 'deleteBookmarks') {
    deleteBookmarks(request.ids).then((results) => sendResponse(results));
    return true; // async response
  } else if (request.action === 'recheckBookmarks') {
    recheckBookmarks(request.ids).then((results) => sendResponse(results));
    return true;
  } else if (request.action === 'ignoreBookmarks') {
    ignoreBookmarks(request.ids).then(() => sendResponse({ success: true }));
    return true;
  }
});

// Helper to check URL with credentials and fallback
async function checkUrl(url) {
  const commonHeaders = {
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
    'Accept-Language': 'en-US,en;q=0.9',
    'Cache-Control': 'no-cache',
    'Pragma': 'no-cache'
  };

  const fetchOptions = { 
    method: 'HEAD',
    redirect: 'follow',
    credentials: 'include',
    headers: commonHeaders
  };

  try {
    let response = await fetch(url, fetchOptions);
    
    if (response.status === 403 || response.status === 405) {
      // Retry with GET and full headers
      response = await fetch(url, { 
        ...fetchOptions, 
        method: 'GET',
        // 'navigate' mode is restricted, but we can try to make it look like one
      });
    }

    return response.ok ? 200 : response.status;
  } catch (e) {
    // If the error is about a restricted header or similar, fallback to basic fetch
    return 'DNS Error';
  }
}

async function startScan() {
  // Reset state
  scanState = {
    isScanning: true,
    total: 0,
    checked: 0,
    broken: [],
    duplicates: {},
    currentPath: []
  };
  
  // Clear previous storage
  await chrome.storage.local.remove('scanState');

  try {
    const tree = await chrome.bookmarks.getTree();
    
    // First pass: Count total and Sort
    await sortAndCount(tree[0]); 
    
    // Second pass: Check links
    await traverseAndCheck(tree[0]);
    
  } catch (error) {
    console.error("Scan error:", error);
  } finally {
    // OPTIMIZATION: Prune the duplicates map. 
    // We currently hold EVERY bookmark in here. We only need to save actual duplicates.
    for (const url in scanState.duplicates) {
      if (scanState.duplicates[url].length <= 1) {
        delete scanState.duplicates[url];
      }
    }
    
    // Remove transient data
    delete scanState.currentPath;

    scanState.isScanning = false;
    scanState.lastScanDate = Date.now(); // Save completion timestamp
    // Save results to storage
    await chrome.storage.local.set({ scanState });
  }
}

// Recursive function to Sort folders/items and Count bookmarks
async function sortAndCount(node) {
  if (node.children) {
    // If it's the root (id '0'), we cannot sort/move its children (Bookmarks Bar, Other, etc.)
    // We just recurse into them.
    if (node.id === '0') {
      for (const child of node.children) {
        await sortAndCount(child);
      }
      return;
    }

    // Separate folders and bookmarks
    const folders = node.children.filter(child => child.children);
    const bookmarks = node.children.filter(child => !child.children);

    // Sort alphabetically
    folders.sort((a, b) => a.title.localeCompare(b.title));
    bookmarks.sort((a, b) => a.title.localeCompare(b.title));

    // Reorder in Chrome
    // We simply iterate and enforce the index. This handles shifts automatically.
    const sortedChildren = [...folders, ...bookmarks];
    for (let i = 0; i < sortedChildren.length; i++) {
      const child = sortedChildren[i];
      
      // Only move if we are not at the root level (redundant check, but safe)
      if (node.id !== '0') {
         await chrome.bookmarks.move(child.id, { index: i, parentId: node.id });
      }
      
      // Recursive call for folders
      if (child.children) {
        await sortAndCount(child);
      } else {
        scanState.total++;
      }
    }
  }
}

// Recursive function to traverse and check URLs
async function traverseAndCheck(node, path = []) {
  if (node.children) {
    const newPath = node.title ? [...path, node.title] : path;
    for (const child of node.children) {
      if (!scanState.isScanning) return; // Stop if cancelled (not implemented yet)
      await traverseAndCheck(child, newPath);
    }
  } else if (node.url) {
    // It's a bookmark
    scanState.checked++;
    
    // 1. Check Duplicates
    if (scanState.duplicates[node.url]) {
      scanState.duplicates[node.url].push({
        id: node.id,
        title: node.title,
        path: path.join(' > ')
      });
    } else {
      scanState.duplicates[node.url] = [{
        id: node.id,
        title: node.title,
        path: path.join(' > ')
      }];
    }

    // 2. Check Link Validity
    // Skip javascript:, mailto:, data: URLs
    if (!node.url.startsWith('http')) return;

    try {
      const status = await checkUrl(node.url);
      
      if (status !== 200) {
        // 404, 500, etc.
        scanState.broken.push({
          id: node.id,
          title: node.title,
          url: node.url,
          status: status,
          path: path.join(' > ')
        });
      }
    } catch (err) {
      // Network error, DNS failure, etc.
      scanState.broken.push({
        id: node.id,
        title: node.title,
        url: node.url,
        status: 'DNS Error', 
        path: path.join(' > ')
      });
    }
  }
}

async function recheckBookmarks(ids) {
  const results = { fixed: [], stillBroken: [] };
  
  // Find the items in broken list
  const itemsToCheck = scanState.broken.filter(b => ids.includes(b.id));
  
  for (const item of itemsToCheck) {
    try {
      const status = await checkUrl(item.url);
      
      if (status === 200) {
        // It's fixed! Remove from broken list
        scanState.broken = scanState.broken.filter(b => b.id !== item.id);
        results.fixed.push(item.id);
      } else {
        // Still broken, update status
        item.status = status;
        results.stillBroken.push(item.id);
      }
    } catch (err) {
      // Still DNS/Network error
      item.status = 'DNS Error';
      results.stillBroken.push(item.id);
    }
  }
  
  // Save updated state
  await chrome.storage.local.set({ scanState });
  return results;
}

async function ignoreBookmarks(ids) {
  // Remove items from broken list
  scanState.broken = scanState.broken.filter(b => !ids.includes(b.id));
  // Save updated state
  await chrome.storage.local.set({ scanState });
}


async function deleteBookmarks(ids) {
  const results = { success: [], failed: [] };
  for (const id of ids) {
    try {
      await chrome.bookmarks.remove(id);
      results.success.push(id);
      
      // Update local state to reflect deletion
      // Remove from broken
      scanState.broken = scanState.broken.filter(b => b.id !== id);
      
      // Remove from duplicates
      for (const url in scanState.duplicates) {
        scanState.duplicates[url] = scanState.duplicates[url].filter(d => d.id !== id);
        if (scanState.duplicates[url].length <= 1) delete scanState.duplicates[url];
      }

    } catch (e) {
      results.failed.push(id);
    }
  }
  // Sync with storage
  await chrome.storage.local.set({ scanState });
  
  return results;
}

// Listen for external bookmark removals (e.g. user deletes manually)
chrome.bookmarks.onRemoved.addListener((id, removeInfo) => {
  let stateChanged = false;

  // 1. Remove from broken list
  const initialBrokenCount = scanState.broken.length;
  scanState.broken = scanState.broken.filter(b => b.id !== id);
  if (scanState.broken.length !== initialBrokenCount) stateChanged = true;

  // 2. Remove from duplicates
  for (const url in scanState.duplicates) {
    const initialLen = scanState.duplicates[url].length;
    scanState.duplicates[url] = scanState.duplicates[url].filter(d => d.id !== id);
    
    if (scanState.duplicates[url].length !== initialLen) {
      stateChanged = true;
      // If only 1 or 0 left, it's no longer a duplicate entry
      if (scanState.duplicates[url].length <= 1) {
        delete scanState.duplicates[url];
      }
    }
  }

  // Save if changed
  if (stateChanged) {
    chrome.storage.local.set({ scanState });
  }
});