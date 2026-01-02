// Helper for storage
export const getStorage = async (keys) => {
    if (keys === null) {
        const [local, sync] = await Promise.all([
            chrome.storage.local.get(null),
            chrome.storage.sync.get(null)
        ]);
        return { ...local, ...sync };
    }

    const keysArray = Array.isArray(keys) ? keys : [keys];
    const syncKeys = keysArray.filter(k => k === 'settings');
    const localKeys = keysArray.filter(k => k !== 'settings');

    const promises = [];
    if (syncKeys.length > 0) promises.push(chrome.storage.sync.get(syncKeys));
    if (localKeys.length > 0) promises.push(chrome.storage.local.get(localKeys));

    const results = await Promise.all(promises);
    return Object.assign({}, ...results);
};

export const setStorage = async (items) => {
    const syncItems = {};
    const localItems = {};
    let hasSync = false;
    let hasLocal = false;

    for (const key in items) {
        if (key === 'settings') {
            syncItems[key] = items[key];
            hasSync = true;
        } else {
            localItems[key] = items[key];
            hasLocal = true;
        }
    }

    const promises = [];
    if (hasSync) promises.push(chrome.storage.sync.set(syncItems));
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

// Robust HTML escaping
export function encodeHtml(str) {
    if (!str) return "";
    return str
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

export function stripVowelAccent(str) {
    if (!str) return "";
    return str.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

export function multiFind(data, strings, settings) {
    let target = "";
    
    if (data) {
        if (settings.searchMode === 1) target = data.title;
        else if (settings.searchMode === 2) target = data.url;
        else target = data.url + " " + data.title;
    }

    target = stripVowelAccent(target).toLowerCase();

    let foundAmount = 0;
    for (const s of strings) {
        if (target.indexOf(s) !== -1) foundAmount++;
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
            workingStr = workingStr.substr(0, position) + startTag + workingStr.substr(position, strings[i].length) + endTag + workingStr.substr(position + strings[i].length); 
        }
    }
    
    return workingStr;
}

// --- Business Logic Functions ---

export async function createTab(id, selected) {
	await navigator.locks.request('simpleUndoClose_data', async (lock) => {
		const data = await getStorage(["ClosedTab-" + id]);
		const entry = data["ClosedTab-" + id];
        
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
	await navigator.locks.request('simpleUndoClose_data', async (lock) => {
		const data = await getStorage(["ClosedTab-" + id]);
		const entry = data["ClosedTab-" + id];
        
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
		await navigator.locks.request('simpleUndoClose_data', async (lock) => {
			if (await chkNewTab(tab)) {
				let insertThis = { url: tab.url, title: tab.title };

				const listKey = "TabList-" + tab.id;
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
	const key = "TabList-" + tab.id;
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
	await navigator.locks.request('simpleUndoClose_data', async (lock) => {
        const data = await getStorage(["ClosedTab-" + id, "settings"]);
		const entry = data["ClosedTab-" + id];
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

	await removeStorage(["ClosedTab-" + id]);
    
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
	
	await navigator.locks.request('simpleUndoClose_data', async (lock) => {
        // Fetch settings and potential history items to delete
        let keysToFetch = ids.map(id => "ClosedTab-" + id);
        keysToFetch.push("settings");
        let fetchData = await getStorage(keysToFetch);
        let settings = fetchData.settings || {};

        if (settings.removeHistory) {
             for(let id of ids) {
                 let entry = fetchData["ClosedTab-" + id];
                 if(entry && entry.url) {
                     try {
                        await chrome.history.deleteUrl({ url: entry.url });
                     } catch (e) { console.error(e); }
                 }
             }
        }

		let data = await getStorage(["ClosedTabIndex"]);
		let closedTabIndex = data.ClosedTabIndex || [];
		
		let keysToRemove = ids.map(id => "ClosedTab-" + id);
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
}

export async function resetData() {
	let data = await getStorage(["settings"]);
	let settings = data.settings;

	await chrome.storage.local.clear();

	await setStorage({
		"settings": settings,
		"TabListIndex": [],
		"ClosedTabIndex": [],
        "SearchIndex": [],
        "restoreCountAllTime": 0
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
    
    // Convert single ID to array check just in case, though usually array passed
    const idSet = new Set(Array.isArray(ids) ? ids : [ids]);

    let newIndex = index.filter(item => !idSet.has(item.id));
    
    if (newIndex.length !== index.length) {
        await setStorage({ SearchIndex: newIndex });
    }
}


export async function updateIcon() {
	let data = await getStorage(["settings"]);
	let settings = data.settings || {};

	if (settings.useAlternateIcon) {
		chrome.action.setIcon({ path: { "19": "icon-19-0.png", "38": "icon-38-0.png" } });
	} else {
		let isDark = false;
		if (settings.theme == "3") {
			isDark = true;
		} else if (settings.theme == "2") {
			isDark = false;
		} else {
			if (typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
				isDark = true;
			}
		}

		if (isDark) { 
			chrome.action.setIcon({
				path: {
					"19": "icon-19-2.png",
					"38": "icon-38-2.png"
				}
			});
		} else { 
			chrome.action.setIcon({
				path: {
					"19": "icon-19-1.png", 
					"38": "icon-38-1.png"  
				}
			});
		}
	}
}

export async function regExistingTabs() {
    const tabs = await chrome.tabs.query({ "url": "*://*/*" });
    if (tabs.length === 0) return;

    await navigator.locks.request('simpleUndoClose_data', async (lock) => {
        const data = await getStorage(["TabListIndex"]);
        let tabListIndex = data.TabListIndex || [];
        let updates = {};
        let changed = false;
        
        const re = /^(http:|https:|chrome-extension:|file:)/;
        
        for (const tab of tabs) {
             if (re.test(tab.url)) {
                 const listKey = "TabList-" + tab.id;
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
