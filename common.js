// Helper for storage
const getStorage = (keys) => {
    return new Promise((resolve) => {
        // If keys is null, get everything from both sources
        if (keys === null) {
            Promise.all([
                new Promise(r => chrome.storage.local.get(null, r)),
                new Promise(r => chrome.storage.sync.get(null, r))
            ]).then(([local, sync]) => {
                resolve({...local, ...sync});
            });
            return;
        }

        let keysArray = Array.isArray(keys) ? keys : [keys];
        let syncKeys = keysArray.filter(k => k === 'settings');
        let localKeys = keysArray.filter(k => k !== 'settings');
        
        let promises = [];
        if (syncKeys.length > 0) promises.push(new Promise(r => chrome.storage.sync.get(syncKeys, r)));
        if (localKeys.length > 0) promises.push(new Promise(r => chrome.storage.local.get(localKeys, r)));
        
        Promise.all(promises).then(results => {
            let combined = Object.assign({}, ...results);
            resolve(combined);
        });
    });
};

const setStorage = (items) => {
    return new Promise((resolve) => {
        let syncItems = {};
        let localItems = {};
        let hasSync = false;
        let hasLocal = false;

        for (let key in items) {
            if (key === 'settings') {
                syncItems[key] = items[key];
                hasSync = true;
            } else {
                localItems[key] = items[key];
                hasLocal = true;
            }
        }

        let promises = [];
        if (hasSync) promises.push(new Promise(r => chrome.storage.sync.set(syncItems, r)));
        if (hasLocal) promises.push(new Promise(r => chrome.storage.local.set(localItems, r)));
        
        Promise.all(promises).then(() => resolve());
    });
};

const removeStorage = (keys) => {
     return new Promise((resolve) => {
        let keysArray = Array.isArray(keys) ? keys : [keys];
        let syncKeys = keysArray.filter(k => k === 'settings');
        let localKeys = keysArray.filter(k => k !== 'settings');
        
        let promises = [];
        if (syncKeys.length > 0) promises.push(new Promise(r => chrome.storage.sync.remove(syncKeys, r)));
        if (localKeys.length > 0) promises.push(new Promise(r => chrome.storage.local.remove(localKeys, r)));
        
        Promise.all(promises).then(() => resolve());
    });
};

// Show |url| in a new tab.
async function createTab(id, selected) {
	await navigator.locks.request('simpleUndoClose_data', async (lock) => {
		const data = await getStorage(["ClosedTab-" + id]);
		if (!data["ClosedTab-" + id]) return;

		var url = data["ClosedTab-" + id].split("|!|")[1];
		
		await removeClosedTabInternal(id);

		if (selected == true) {
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

		var url = data["ClosedTab-" + id].split("|!|")[1];
		
		await removeClosedTabInternal(id);

		chrome.tabs.create({ "url": url, "windowId": wId });
	});
}

async function addNewTab(tab) {
	// console.log("ADD NEW "+tab.url+"|!|"+tab.title+"|!|"+tab.status);
	// var re = /^(http:|https:|ftp:|file:)/;
	var re = /^(http:|https:|chrome-extension:)/;
	if (re.test(tab.url)) {
		if (await chkNewTab(tab)) {
			await navigator.locks.request('simpleUndoClose_data', async (lock) => {
				var insertThis = tab.url + "|!|";
				insertThis += tab.title.replace(/\|\!\|/g, " ");

				const listKey = "TabList-" + tab.id;
				let data = await getStorage(["TabListIndex"]);
				let tabListIndex = data.TabListIndex || [];

				if (tabListIndex.indexOf(tab.id) == -1) {
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

//check if url same, not same than pass
async function chkNewTab(tab) {
	var pass = false;
	const key = "TabList-" + tab.id;
	const data = await getStorage([key]);
	var inList = data[key];

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
		var n = closedTabIndex.length;
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
	//console.log("RESET");
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

	// localStorage.lastCloseTime = 0;

	regExistingTabs();
	await setBadge();
}

async function updateIcon() {
	let data = await getStorage(["settings"]);
	let settings = data.settings || {};

	if (settings.altBut) {
		chrome.action.setIcon({ path: { "19": "icon-19-1.png", "38": "icon-38-1.png" } });
	} else {
		let isDark = false;
		if (typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
			isDark = true;
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
					"19": "icon-19-0.png",
					"38": "icon-38-0.png"
				}
			});
		}
	}
}

function regExistingTabs() {
	chrome.tabs.query({ "url": "*://*/*" }, function (tabs) {
		// console.log(tabs.length+" tabs");
		for (var t = 0; t < tabs.length; t++) {
			// console.log("add tab "+t);
			addNewTab(tabs[t]);
		}
	});
}

async function getLatestCTab() {
	// console.log("LAST CLOSED TAB");
	let data = await getStorage(["ClosedTabIndex"]);
	let closedTabIndex = data.ClosedTabIndex || [];
	if (closedTabIndex.length > 0) await createTab(closedTabIndex[closedTabIndex.length - 1], true);
}