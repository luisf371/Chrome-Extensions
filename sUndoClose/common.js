export const TABLIST_PREFIX = 'TabList-';
export const CLOSEDTAB_PREFIX = 'ClosedTab-';
const SETTINGS_CACHE_KEY = 'settings_cache';
const SETTINGS_VERSION_KEY = 'settings_version';

function getSettingsWithVersion(syncSettings, syncVersion, cacheSettings, cacheVersion) {
    if (!syncSettings && !cacheSettings) return null;
    if (!syncSettings) return cacheSettings;
    if (!cacheSettings) return syncSettings;
    
    const syncV = syncVersion || 0;
    const cacheV = cacheVersion || 0;
    
    return cacheV > syncV ? cacheSettings : syncSettings;
}

export const getStorage = async (keys) => {
    if (keys === null) {
        const [local, sync] = await Promise.all([
            chrome.storage.local.get(null),
            chrome.storage.sync.get(null).catch(() => ({}))
        ]);
        const merged = { ...local, ...sync };
        
        merged.settings = getSettingsWithVersion(
            sync.settings, sync[SETTINGS_VERSION_KEY],
            local[SETTINGS_CACHE_KEY], local[SETTINGS_VERSION_KEY]
        );
        
        delete merged[SETTINGS_CACHE_KEY];
        delete merged[SETTINGS_VERSION_KEY];
        return merged;
    }

    const keysArray = Array.isArray(keys) ? keys : [keys];
    const needsSettings = keysArray.includes('settings');
    const syncKeys = keysArray.filter(k => k === 'settings');
    const localKeys = keysArray.filter(k => k !== 'settings');

    const promises = [];
    let syncResult = {};
    let localResult = {};
    
    if (syncKeys.length > 0) {
        promises.push(
            chrome.storage.sync.get(['settings', SETTINGS_VERSION_KEY])
                .then(r => { syncResult = r; })
                .catch(() => {})
        );
    }
    if (localKeys.length > 0 || needsSettings) {
        const localFetchKeys = needsSettings 
            ? [...localKeys, SETTINGS_CACHE_KEY, SETTINGS_VERSION_KEY] 
            : localKeys;
        promises.push(
            chrome.storage.local.get(localFetchKeys)
                .then(r => { localResult = r; })
        );
    }

    await Promise.all(promises);
    const merged = { ...localResult, ...syncResult };
    
    if (needsSettings) {
        merged.settings = getSettingsWithVersion(
            syncResult.settings, syncResult[SETTINGS_VERSION_KEY],
            localResult[SETTINGS_CACHE_KEY], localResult[SETTINGS_VERSION_KEY]
        );
    }
    
    delete merged[SETTINGS_CACHE_KEY];
    delete merged[SETTINGS_VERSION_KEY];
    
    return merged;
};

export const setStorage = async (items) => {
    const syncItems = {};
    const localItems = {};
    let hasSync = false;
    let hasLocal = false;

    for (const key in items) {
        if (key === 'settings') {
            const version = Date.now();
            syncItems[key] = items[key];
            syncItems[SETTINGS_VERSION_KEY] = version;
            localItems[SETTINGS_CACHE_KEY] = items[key];
            localItems[SETTINGS_VERSION_KEY] = version;
            hasSync = true;
            hasLocal = true;
        } else {
            localItems[key] = items[key];
            hasLocal = true;
        }
    }

    const promises = [];
    if (hasSync) {
        promises.push(chrome.storage.sync.set(syncItems).catch(err => {
            console.warn('sUndoClose: Sync storage unavailable, using local cache:', err.message);
        }));
    }
    if (hasLocal) promises.push(chrome.storage.local.set(localItems));

    await Promise.all(promises);
};

export const removeStorage = async (keys) => {
    const keysArray = Array.isArray(keys) ? keys : [keys];
    const syncKeys = keysArray.filter(k => k === 'settings');
    const localKeys = keysArray.filter(k => k !== 'settings');

    const promises = [];
    if (syncKeys.length > 0) promises.push(chrome.storage.sync.remove(syncKeys));
    if (localKeys.length > 0) promises.push(chrome.storage.local.remove(localKeys));

    await Promise.all(promises);
};

export const getSessionStorage = async (keys) => {
    const keysArray = Array.isArray(keys) ? keys : [keys];
    return chrome.storage.session.get(keysArray);
};

export const setSessionStorage = async (items) => {
    await chrome.storage.session.set(items);
};



export function stripVowelAccent(str) {
    if (!str) return "";
    return str.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

export function multiFind(data, strings, settings) {
    let target = "";
    
    if (data) {
        // searchMode may be a number (default) or a string from the saved
        // <select> value; coerce so "1"/"2" still match and the Title/URL
        // scope isn't silently lost to the default after the options are saved.
        const mode = parseInt(settings.searchMode, 10);
        if (mode === 1) target = data.title;
        else if (mode === 2) target = data.url;
        else target = data.url + " " + data.title;
    }

    target = stripVowelAccent(target).toLowerCase();

    let foundAmount = 0;
    for (const s of strings) {
        if (target.includes(s)) foundAmount++;
    }
    return (foundAmount === strings.length);
}

export function multiReplace(strReal, strings) {
    let str;
    const startTag = "\uE000";
    const endTag = "\uE001";
    let workingStr = strReal;

    for(let i = 0; i < strings.length; i++ ) {
        str = stripVowelAccent(workingStr).toLowerCase();
        const position = str.indexOf(strings[i]);
        if (position !== -1) {
            workingStr = workingStr.substring(0, position) + startTag + workingStr.substring(position, position + strings[i].length) + endTag + workingStr.substring(position + strings[i].length); 
        }
    }
    
    return workingStr;
}

// --- Business Logic Functions ---

export async function createTab(id, selected) {
	await navigator.locks.request('sUndoClose_data', async (lock) => {
		const data = await getStorage([CLOSEDTAB_PREFIX + id]);
		const entry = data[CLOSEDTAB_PREFIX + id];
        
		if (!entry) return;

		const url = entry.url;
		
		await removeClosedTabInternal(id);
        await incrementRestoreCounts();

		if (selected === true) {
			chrome.tabs.create({ "url": url, "active": true });
			if (typeof window !== 'undefined' && window.close) window.close();
		} else {
			chrome.tabs.create({ "url": url, "active": false });
		}
	});
}

export async function createTabWindow(id, wId) {
	await navigator.locks.request('sUndoClose_data', async (lock) => {
		const data = await getStorage([CLOSEDTAB_PREFIX + id]);
		const entry = data[CLOSEDTAB_PREFIX + id];
        
		if (!entry) return;

		const url = entry.url;
		
		await removeClosedTabInternal(id);
        await incrementRestoreCounts();

		chrome.tabs.create({ "url": url, "windowId": wId });
	});
}

export async function addNewTab(tab) {
	const re = /^(http:|https:|chrome-extension:|file:)/;
	if (re.test(tab.url)) {
		await navigator.locks.request('sUndoClose_data', async (lock) => {
			if (await chkNewTab(tab)) {
				let insertThis = { url: tab.url, title: tab.title };

				const listKey = TABLIST_PREFIX + tab.id;
				let data = await getStorage(["TabListIndex"]);
				let tabListIndex = data.TabListIndex || [];

				if (!tabListIndex.includes(tab.id)) {
					tabListIndex.push(tab.id);
					await setStorage({
						[listKey]: insertThis,
						"TabListIndex": tabListIndex
					});
				} else {
					await setStorage({
						[listKey]: insertThis
					});
				}
			}
		});
	}
}

export async function chkNewTab(tab) {
	let pass = false;
	const key = TABLIST_PREFIX + tab.id;
	const data = await getStorage([key]);
	const inList = data[key];

	if (inList === undefined) {
        pass = true;
    } else {
        if (inList.url !== tab.url || inList.title !== tab.title) pass = true;
    }
	return pass;
}

export async function removeClosedTab(id) {
	await navigator.locks.request('sUndoClose_data', async (lock) => {
        const data = await getStorage([CLOSEDTAB_PREFIX + id, "settings"]);
		const entry = data[CLOSEDTAB_PREFIX + id];
        const settings = data.settings || {};

        if (settings.removeHistory && entry && entry.url) {
            try {
                await chrome.history.deleteUrl({ url: entry.url });
            } catch (e) {
                console.error("Failed to remove history entry:", e);
            }
        }

		await removeClosedTabInternal(id);
	});
}

export async function removeClosedTabInternal(id) {
	let data = await getStorage(["ClosedTabIndex"]);
	let closedTabIndex = data.ClosedTabIndex || [];

	await removeStorage([CLOSEDTAB_PREFIX + id]);
    
    // Sync Index
    await removeFromSearchIndex([id]);

	const index = closedTabIndex.indexOf(id);
	if (index > -1) {
		closedTabIndex.splice(index, 1);
		await setStorage({ "ClosedTabIndex": closedTabIndex });
	}
	await setBadge();
}

export async function removeClosedTabBatch(ids) {
	if (!ids || ids.length === 0) return;
	
	await navigator.locks.request('sUndoClose_data', async (lock) => {
        let keysToFetch = ids.map(id => CLOSEDTAB_PREFIX + id);
        keysToFetch.push("settings");
        let fetchData = await getStorage(keysToFetch);
        let settings = fetchData.settings || {};

        if (settings.removeHistory) {
             for(let id of ids) {
                 let entry = fetchData[CLOSEDTAB_PREFIX + id];
                 if(entry && entry.url) {
                     try {
                        await chrome.history.deleteUrl({ url: entry.url });
                     } catch (e) { console.error(e); }
                 }
             }
        }

		let data = await getStorage(["ClosedTabIndex"]);
		let closedTabIndex = data.ClosedTabIndex || [];
		
		let keysToRemove = ids.map(id => CLOSEDTAB_PREFIX + id);
		await removeStorage(keysToRemove);
        
        // Sync Index
        await removeFromSearchIndex(ids);

		let newIndex = closedTabIndex.filter(id => !ids.includes(id));
		
		if (newIndex.length !== closedTabIndex.length) {
			await setStorage({ "ClosedTabIndex": newIndex });
		}
	});
	await setBadge();
}

export async function setBadge() {
	await navigator.locks.request('sUndoClose_badge', async (lock) => {
		let data = await getStorage(["settings", "ClosedTabIndex"]);
		let settings = data.settings || {};

		if (settings.showBadge) {
			let closedTabIndex = data.ClosedTabIndex || [];
			const n = closedTabIndex.length;
			if (n > 0) {
				chrome.action.setBadgeBackgroundColor({ color: [15, 161, 211, 255] });
				chrome.action.setBadgeText({ text: n.toString() });
			} else {
				chrome.action.setBadgeText({ text: "" });
			}
		} else {
			chrome.action.setBadgeText({ text: "" });
		}
	});
}

export async function resetData() {
	let data = await getStorage(["settings", "restoreCountAllTime", "installDate"]);
	let settings = data.settings;
	// Preserve lifetime stats: clearing closed-tab history must not wipe the
	// all-time recovered count or the install date (this also runs on every
	// startup when saveHistory is disabled).
	const restoreCountAllTime = Number(data.restoreCountAllTime) || 0;
	const installDate = data.installDate || Date.now();

	await chrome.storage.local.clear();

	await setStorage({
		"settings": settings,
		"TabListIndex": [],
		"ClosedTabIndex": [],
        "SearchIndex": [],
        "restoreCountAllTime": restoreCountAllTime,
        "installDate": installDate
	});

	await regExistingTabs();
	await setBadge();
}

// ... (Rest of existing functions)

export async function updateSearchIndex(id, title, url) {
    // Note: Called inside lock usually
    let data = await getStorage(['SearchIndex']);
    let index = data.SearchIndex || [];
    // We add new items to the END (matching ClosedTabIndex)
    // Minimal data for search
    index.push({ id: id, t: title, u: url });
    await setStorage({ SearchIndex: index });
}

export async function removeFromSearchIndex(ids) {
    if (!ids || ids.length === 0) return;
    let data = await getStorage(['SearchIndex']);
    let index = data.SearchIndex || [];
    
    const idSet = new Set(Array.isArray(ids) ? ids : [ids]);

    let newIndex = index.filter(item => !idSet.has(item.id));
    
    if (newIndex.length !== index.length) {
        await setStorage({ SearchIndex: newIndex });
    }
}

export async function rebuildSearchIndex() {
    let data = await getStorage(['ClosedTabIndex']);
    const closedTabIndex = data.ClosedTabIndex || [];
    
    if (closedTabIndex.length === 0) {
        await setStorage({ SearchIndex: [] });
        return;
    }
    
    const keys = closedTabIndex.map(id => CLOSEDTAB_PREFIX + id);
    const tabsData = await getStorage(keys);
    
    const newIndex = [];
    for (const id of closedTabIndex) {
        const entry = tabsData[CLOSEDTAB_PREFIX + id];
        if (entry) {
            newIndex.push({ id: id, t: entry.title, u: entry.url });
        }
    }
    
    await setStorage({ SearchIndex: newIndex });
}


// Debounce timer for updateIcon to prevent race conditions
let updateIconTimer = null;

export async function updateIcon() {
    // Debounce rapid calls
    if (updateIconTimer) {
        clearTimeout(updateIconTimer);
    }
    
    return new Promise((resolve) => {
        updateIconTimer = setTimeout(async () => {
            await updateIconInternal();
            updateIconTimer = null;
            resolve();
        }, 50);
    });
}

async function updateIconInternal() {
    let data = await getStorage(["settings"]);
    let settings = data.settings || {};

    if (settings.useAlternateIcon) {
        chrome.action.setIcon({ 
            path: { 
                "16": "assets/icons/icon16.png",
                "32": "assets/icons/icon32.png"
            } 
        });
    } else {
        let isDark = false;

        // Theme is persisted inside the settings object (settings.theme),
        // not as a top-level "theme" key.
        const theme = settings.theme;

        if (theme === "dark") {
            isDark = true;
        } else if (theme === "light") {
            isDark = false;
        } else if (typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
            isDark = true;
        }

        if (isDark) { 
            chrome.action.setIcon({
                path: {
                    "16": "assets/icon-19-2.png",
                    "32": "assets/icon-38-2.png"
                }
            });
        } else { 
            chrome.action.setIcon({
                path: {
                    "16": "assets/icon-19-1.png",
                    "32": "assets/icon-38-1.png"
                }
            });
        }
    }
}

export async function regExistingTabs() {
    const tabs = await chrome.tabs.query({ "url": "*://*/*" });
    if (tabs.length === 0) return;

    await navigator.locks.request('sUndoClose_data', async (lock) => {
        const data = await getStorage(["TabListIndex"]);
        let tabListIndex = data.TabListIndex || [];
        let updates = {};
        let changed = false;
        
        const re = /^(http:|https:|chrome-extension:|file:)/;
        
        for (const tab of tabs) {
             if (re.test(tab.url)) {
                 const listKey = TABLIST_PREFIX + tab.id;
                 let insertThis = { url: tab.url, title: tab.title };
                 
                 updates[listKey] = insertThis;
                 changed = true;
                 
                 if (!tabListIndex.includes(tab.id)) {
                     tabListIndex.push(tab.id);
                 }
             }
        }
        
        if (changed) {
            updates["TabListIndex"] = tabListIndex;
            await setStorage(updates);
        }
    });
}

export async function getLatestCTab() {
	let data = await getStorage(["ClosedTabIndex"]);
	let closedTabIndex = data.ClosedTabIndex || [];
	if (closedTabIndex.length > 0) await createTab(closedTabIndex[closedTabIndex.length - 1], true);
}

async function incrementRestoreCounts() {
    const [localData, sessionData] = await Promise.all([
        getStorage(['restoreCountAllTime']),
        getSessionStorage(['restoreCountSession'])
    ]);

    const allTime = Number(localData.restoreCountAllTime) || 0;
    const session = Number(sessionData.restoreCountSession) || 0;

    await Promise.all([
        setStorage({ restoreCountAllTime: allTime + 1 }),
        setSessionStorage({ restoreCountSession: session + 1 })
    ]);
}
