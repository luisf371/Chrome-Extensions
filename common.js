// Helper for storage
const getStorage = async (keys) => {
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

const setStorage = async (items) => {
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

const removeStorage = async (keys) => {
    const keysArray = Array.isArray(keys) ? keys : [keys];
    const syncKeys = keysArray.filter(k => k === 'settings');
    const localKeys = keysArray.filter(k => k !== 'settings');

    const promises = [];
    if (syncKeys.length > 0) promises.push(chrome.storage.sync.remove(syncKeys));
    if (localKeys.length > 0) promises.push(chrome.storage.local.remove(localKeys));

    await Promise.all(promises);
};

// Robust HTML escaping
function encodeHtml(str) {
    if (!str) return "";
    return str
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function stripVowelAccent(str) {
    const rExps = [ /[\u00C0-\u00C2]/g, /[\u00E0-\u00E2]/g,
        /[\u00C8-\u00CA]/g, /[\u00E8-\u00EB]/g,
        /[\u00CC-\u00CE]/g, /[\u00EC-\u00EE]/g,
        /[\u00D2-\u00D4]/g, /[\u00F2-\u00F4]/g,
        /[\u00D9-\u00DB]/g, /[\u00F9-\u00FB]/g ];

    const repChar = ['A','a','E','e','I','i','O','o','U','u'];

    for(let i=0; i<rExps.length; i++) {
        str = str.replace(rExps[i], repChar[i]);
    }
    return str;
}

function multiFind(str, strings, settings) {
    let target = stripVowelAccent(str).toLowerCase();
    
    if (settings && settings.searchMode !== 3 && str.includes("|!|")) {
        const splitStr = target.split("|!|");
        if (settings.searchMode === 1 && splitStr[2]) target = splitStr[2];
        if (settings.searchMode === 2 && splitStr[1]) target = splitStr[1];
    }

    let foundAmount = 0;
    for (const s of strings) {
        if (target.indexOf(s) !== -1) foundAmount++;
    }
    return (foundAmount === strings.length);
}

function multiReplace(strReal, strings) {
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
    
    let encoded = encodeHtml(workingStr);
    encoded = encoded.split(startTag).join("<u>").split(endTag).join("</u>");
    return encoded;
}

// --- Business Logic Functions ---

async function createTab(id, selected) {
	await navigator.locks.request('simpleUndoClose_data', async (lock) => {
		const data = await getStorage(["ClosedTab-" + id]);
		if (!data["ClosedTab-" + id]) return;

		const url = data["ClosedTab-" + id].split("|!|")[1];
		
		await removeClosedTabInternal(id);

		if (selected === true) {
			chrome.tabs.create({ "url": url, "active": true });
			if (typeof window !== 'undefined' && window.close) window.close();
		} else {
			chrome.tabs.create({ "url": url, "active": false });
		}
	});
}

async function createTabWindow(id, wId) {
	await navigator.locks.request('simpleUndoClose_data', async (lock) => {
		const data = await getStorage(["ClosedTab-" + id]);
		if (!data["ClosedTab-" + id]) return;

		const url = data["ClosedTab-" + id].split("|!|")[1];
		
		await removeClosedTabInternal(id);

		chrome.tabs.create({ "url": url, "windowId": wId });
	});
}

async function addNewTab(tab) {
	const re = /^(http:|https:|chrome-extension:|file:)/;
	if (re.test(tab.url)) {
		if (await chkNewTab(tab)) {
			await navigator.locks.request('simpleUndoClose_data', async (lock) => {
				let insertThis = tab.url + "|!|";
				insertThis += tab.title.replace(/\|\!\|/g, " ");

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
			});
		}
	}
}

async function chkNewTab(tab) {
	let pass = false;
	const key = "TabList-" + tab.id;
	const data = await getStorage([key]);
	const inList = data[key];

	if (inList === undefined || (inList && (inList.split("|!|")[0] !== tab.url || (inList.split("|!|")[0] === tab.url && inList.split("|!|")[1] !== tab.title)))) pass = true;
	return pass;
}

async function removeClosedTab(id) {
	await navigator.locks.request('simpleUndoClose_data', async (lock) => {
		await removeClosedTabInternal(id);
	});
}

async function removeClosedTabInternal(id) {
	let data = await getStorage(["ClosedTabIndex"]);
	let closedTabIndex = data.ClosedTabIndex || [];

	await removeStorage(["ClosedTab-" + id]);

	const index = closedTabIndex.indexOf(id);
	if (index > -1) {
		closedTabIndex.splice(index, 1);
		await setStorage({ "ClosedTabIndex": closedTabIndex });
	}
	await setBadge();
}

async function removeClosedTabBatch(ids) {
	if (!ids || ids.length === 0) return;
	
	await navigator.locks.request('simpleUndoClose_data', async (lock) => {
		let data = await getStorage(["ClosedTabIndex"]);
		let closedTabIndex = data.ClosedTabIndex || [];
		
		let keysToRemove = ids.map(id => "ClosedTab-" + id);
		await removeStorage(keysToRemove);

		let newIndex = closedTabIndex.filter(id => !ids.includes(id));
		
		if (newIndex.length !== closedTabIndex.length) {
			await setStorage({ "ClosedTabIndex": newIndex });
		}
	});
	await setBadge();
}

async function setBadge() {
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

async function resetData() {
	let data = await getStorage(["settings", "updatedTill"]);
	let settings = data.settings;
	let oldUpdTill = data.updatedTill;

	await chrome.storage.local.clear();

	await setStorage({
		"settings": settings,
		"updatedTill": oldUpdTill,
		"TabListIndex": [],
		"ClosedTabIndex": []
	});

	await regExistingTabs();
	await setBadge();
}

async function updateIcon() {
	let data = await getStorage(["settings"]);
	let settings = data.settings || {};

	if (settings.altBut) {
		chrome.action.setIcon({ path: { "19": "icon-19-1.png", "38": "icon-38-1.png" } });
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

async function regExistingTabs() {
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
                 let insertThis = tab.url + "|!|";
                 insertThis += tab.title.replace(/\|\!\|/g, " ");
                 
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

async function getLatestCTab() {
	let data = await getStorage(["ClosedTabIndex"]);
	let closedTabIndex = data.ClosedTabIndex || [];
	if (closedTabIndex.length > 0) await createTab(closedTabIndex[closedTabIndex.length - 1], true);
}