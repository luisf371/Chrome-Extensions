import { 
    getStorage, 
    setStorage, 
    removeStorage, 
    getLatestCTab, 
    addNewTab, 
    regExistingTabs,
    setBadge,
    updateIcon,
    resetData,
    updateSearchIndex,
    removeFromSearchIndex,
    rebuildSearchIndex,
    TABLIST_PREFIX,
    CLOSEDTAB_PREFIX
} from './common.js';

const defaultSettings = {
	"showClear" : true,
	"showBadge" : false,
	"showTime" : true,
	"showSearch" : true,
	"searchMode" : 1,
	"saveHistory" : true,
	"menuTop" : false,
	"disableDClick" : true,
	"tooltipText" : true,
	"numLimit" : 60,
	"numItems" : 10,
	"numLines" : 1,
	"useAlternateIcon" : false,
	"popupWidth" : 300,
	"style" : 1,
	"longPressDelay" : 3,
	"mClickClose" : false,
	"theme" : "dark",
    "removeHistory" : false
};

chrome.runtime.onStartup.addListener(async function() {
    try {
        let data = await getStorage(['settings']);
        let settings = data.settings;

        if (!settings) {
            await ensureDefaults();
            data = await getStorage(['settings']);
            settings = data.settings;
        }

        await chrome.storage.session.set({ restoreCountSession: 0 });

        if (settings && !settings.saveHistory) {
            await resetData(); 
        }
        else if (settings) {
            await tabListProcessing();
            await cleanClosedTabs();
            await setBadge();
            await regExistingTabs();
            await updateIcon();
        }
    } catch (error) {
        console.error('sUndoClose: Startup error:', error);
    }
});

chrome.runtime.onInstalled.addListener(async function(runInfo) {
    try {
        if (runInfo.reason === "install") {
            await initializeFreshInstall();
        }
        if (runInfo.reason === "update") {
            await settingsUpdate();
        }
        await chrome.storage.session.set({ restoreCountSession: 0 });
        await setBadge();
        await updateIcon();
    } catch (error) {
        console.error('sUndoClose: Install/update error:', error);
    }
});

chrome.tabs.onUpdated.addListener(function(tabId, changeInfo, tab){
	if(tab.url){ 
		addNewTab(tab).catch(e => console.error('sUndoClose: Failed to add tab:', e)); 
	}
});

chrome.tabs.onRemoved.addListener(function(tabId, info) {
	addClosedTab(tabId, 0).catch(error => {
        console.error('sUndoClose: Failed to record closed tab:', error);
    });
});

chrome.tabs.onReplaced.addListener(async function(addedTabId, removedTabId) {
	await navigator.locks.request('sUndoClose_data', async (lock) => {
		const oldKey = TABLIST_PREFIX + removedTabId;
		const newKey = TABLIST_PREFIX + addedTabId;
		
		let data = await getStorage([oldKey, newKey, 'TabListIndex']);
		
		// Update Index
		let tabListIndex = data.TabListIndex || [];
		let oldIdx = tabListIndex.indexOf(removedTabId);
		let newIdx = tabListIndex.indexOf(addedTabId);
		
		let indexChanged = false;
		if (oldIdx !== -1) {
			tabListIndex.splice(oldIdx, 1);
			indexChanged = true;
		}
		if (newIdx === -1) {
			tabListIndex.push(addedTabId);
			indexChanged = true;
		}
		
		let storageUpdate = {};
		if(indexChanged) storageUpdate.TabListIndex = tabListIndex;

		// Move Data if new key doesn't exist yet
		if (data[oldKey]) {
			if (!data[newKey]) {
				storageUpdate[newKey] = data[oldKey];
			}
			await setStorage(storageUpdate);
			await removeStorage([oldKey]);
		} else if (indexChanged) {
			await setStorage(storageUpdate);
		}
	});
});

chrome.commands.onCommand.addListener(function(command) {
	if(command === "undo-latest") getLatestCTab();
});

// Only for fresh install - destructive, wipes all data
async function initializeFreshInstall(){
	await setStorage({
        settings: defaultSettings,
        TabListIndex: [],
        ClosedTabIndex: [],
        SearchIndex: [],
        restoreCountAllTime: 0,
        installDate: Date.now()
    });
	await regExistingTabs();
}

// For startup/update - non-destructive, preserves existing data
async function ensureDefaults(){
    const existing = await getStorage([
        'settings', 'TabListIndex', 'ClosedTabIndex', 
        'SearchIndex', 'restoreCountAllTime', 'installDate'
    ]);
    
    const updates = {};
    if (!existing.settings) updates.settings = defaultSettings;
    if (!existing.TabListIndex) updates.TabListIndex = [];
    if (!existing.ClosedTabIndex) updates.ClosedTabIndex = [];
    if (!existing.SearchIndex) updates.SearchIndex = [];
    if (existing.restoreCountAllTime === undefined) updates.restoreCountAllTime = 0;
    if (!existing.installDate) updates.installDate = Date.now();
    
    if (Object.keys(updates).length > 0) {
        await setStorage(updates);
    }
}

async function settingsUpdate(){
    let needsInit = false;
	await navigator.locks.request('sUndoClose_data', async (lock) => {
		let data = await getStorage(['settings']);
		
		if(!data.settings){ 
            needsInit = true;
            return; 
        }

        let settings = data.settings;
        const currDefKeys = Object.keys(defaultSettings);
        let settingsChanged = false;
        
        // Sync Keys: Add missing defaults
        for(let i=0; i < currDefKeys.length; i++){
            if (!settings.hasOwnProperty(currDefKeys[i])) {
                settings[currDefKeys[i]] = defaultSettings[currDefKeys[i]];
                settingsChanged = true;
            }
        }
        
        // Note: We do not remove extra keys to preserve user's potential future/other settings 
        // unless strictly required. The original code did remove extras, but preserving is safer for forward compatibility.
        // However, to match strict cleanup:
        const localKeys = Object.keys(settings);
        for(let i=0; i < localKeys.length; i++){
            if (!defaultSettings.hasOwnProperty(localKeys[i])) {
                delete settings[localKeys[i]];
                settingsChanged = true;
            }
        }

        if (settingsChanged) {
            await setStorage({ settings: settings });
        }
        
        let checks = await getStorage(['TabListIndex', 'ClosedTabIndex', 'SearchIndex', 'restoreCountAllTime', 'installDate']);
        if(!checks.TabListIndex){ await setStorage({ TabListIndex: [] }); }
        if(!checks.ClosedTabIndex){ await setStorage({ ClosedTabIndex: [] }); }
        if(!checks.restoreCountAllTime && checks.restoreCountAllTime !== 0){ await setStorage({ restoreCountAllTime: 0 }); }
        if(!checks.installDate){ await setStorage({ installDate: Date.now() }); }
        
        if(!checks.SearchIndex && checks.ClosedTabIndex && checks.ClosedTabIndex.length > 0){
            await rebuildSearchIndex();
        } else if (!checks.SearchIndex) {
            await setStorage({ SearchIndex: [] });
        }
	});

    if (needsInit) {
        await ensureDefaults();
    }
}

async function addClosedTab(tabId, mode){
    await navigator.locks.request('sUndoClose_data', async (lock) => {
        await addClosedTabInternal(tabId, mode);
    });
}

async function addClosedTabInternal(tabId, mode){
	const key = TABLIST_PREFIX + tabId;
	let data = await getStorage([key, 'settings', 'ClosedTabIndex', 'TabListIndex']);

	if(data[key] != undefined){
		const settings = data.settings || defaultSettings;
		const closedTabIndex = data.ClosedTabIndex || [];
		const tabListIndex = data.TabListIndex || [];
		
		let storageUpdates = {};
		let keysToRemove = [key];
        let idsToRemoveIndex = [];

		const tIdx = tabListIndex.indexOf(tabId);
		if (tIdx > -1) {
			tabListIndex.splice(tIdx, 1);
			storageUpdates.TabListIndex = tabListIndex;
		}

        const tabData = data[key];
		const url = tabData.url;
		const re = /^(http:|https:|chrome-extension:|file:)/;
		
		if (url && re.test(url)) {
			let exists = -1;
			const closedTabKeys = closedTabIndex.map(id => CLOSEDTAB_PREFIX + id);
			const closedTabsData = await getStorage(closedTabKeys);

			for(let i = closedTabIndex.length-1; i>=0; i--){
				const closedTab = closedTabsData[CLOSEDTAB_PREFIX + closedTabIndex[i]];
				if (closedTab){
                    const cTab = closedTab;
					if (cTab.url === url){
						exists=closedTabIndex[i];
						break;
					}
				}
			}

            const createObj = {
                time: Date.now(),
                url: tabData.url,
                title: tabData.title
            };

			if (exists!=-1){
				keysToRemove.push(CLOSEDTAB_PREFIX+exists);
                idsToRemoveIndex.push(exists);
				closedTabIndex.splice(closedTabIndex.indexOf(exists),1);
			}

			const rId = crypto.randomUUID();
			storageUpdates[CLOSEDTAB_PREFIX+rId] = createObj;
			closedTabIndex.push(rId);

			if (closedTabIndex.length > settings.numLimit){
				const evictId = closedTabIndex.shift();
				keysToRemove.push(CLOSEDTAB_PREFIX + evictId);
				idsToRemoveIndex.push(evictId);
			}
			storageUpdates.ClosedTabIndex = closedTabIndex;
            
            // Perform writes
            await setStorage(storageUpdates);
            await removeStorage(keysToRemove);
            
            // Update Index (Wait for storage write first to be safe, or concurrent)
            // Remove old/evicted from index
            if(idsToRemoveIndex.length > 0) {
                await removeFromSearchIndex(idsToRemoveIndex);
            }
            // Add new to index
            await updateSearchIndex(rId, createObj.title, createObj.url);
		} else {
            // URL is not restorable: still persist the TabListIndex change and
            // drop the orphaned TabList- entry so it doesn't leak in storage.
            if (storageUpdates.TabListIndex) {
                await setStorage({ TabListIndex: storageUpdates.TabListIndex });
            }
            await removeStorage([key]);
        }

		await setBadge();
	}
}

async function tabListProcessing() {
    await navigator.locks.request('sUndoClose_data', async (lock) => {
        let allData = await getStorage(null);
        let tabListIndex = allData.TabListIndex || [];
        
        for (const key in allData) {
            if(key.startsWith(TABLIST_PREFIX)) {
                const tabListId = parseInt(key.substring(TABLIST_PREFIX.length), 10);
                if(tabListIndex.includes(tabListId)){
                    await addClosedTabInternal(tabListId,1);
                }else{
                    await removeStorage([key]);
                }
            }
        }
    });
}

async function cleanClosedTabs() {
    await navigator.locks.request('sUndoClose_data', async (lock) => {
        let data = await getStorage(['ClosedTabIndex']);
        const indexList = data.ClosedTabIndex || [];
        const db = {};
        for (let i = 0; i < indexList.length; i++) {
            db[indexList[i]] = true;
        }

        let allData = await getStorage(null);
        
        for (let key in allData) {
            if (key.startsWith(CLOSEDTAB_PREFIX)) {
                const uuid = key.substring(CLOSEDTAB_PREFIX.length);
                if (!db.hasOwnProperty(uuid)) {
                    await removeStorage([key]);
                }
            }
        }

        let newIndexList = [];
        let indexChanged = false;
        for (let i = 0; i < indexList.length; i++) {
            if (allData[CLOSEDTAB_PREFIX + indexList[i]]) {
                newIndexList.push(indexList[i]);
            } else {
                indexChanged = true;
            }
        }

        if (indexChanged) {
            await setStorage({ ClosedTabIndex: newIndexList });
            await rebuildSearchIndex();
        } else {
            let searchData = await getStorage(['SearchIndex']);
            let searchIndex = searchData.SearchIndex || [];
            let newSearchIndex = searchIndex.filter(item => db[item.id]);
            
            if (newSearchIndex.length !== searchIndex.length) {
                await setStorage({ SearchIndex: newSearchIndex });
            }
        }
    });
}
