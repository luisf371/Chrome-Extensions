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
    removeFromSearchIndex
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
	"numLimit" : 10,
	"numItems" : 10,
	"numLines" : 1,
	"useAlternateIcon" : false,
	"popupWidth" : 300,
	"style" : 1,
	"longPressDelay" : 3,
	"mClickClose" : false,
	"theme" : "1"
};

chrome.runtime.onStartup.addListener(async function() {
	let data = await getStorage(['settings']);
	let settings = data.settings;

    if (!settings) {
        await initialize();
        data = await getStorage(['settings']);
        settings = data.settings;
    }

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
});

chrome.runtime.onInstalled.addListener(async function(runInfo) {
	if (runInfo.reason === "install") {
		await initialize();
	}
	if (runInfo.reason === "update") {
		await settingsUpdate();
	}
	await setBadge();
	await updateIcon();
});

chrome.tabs.onUpdated.addListener(function(tabId, changeInfo, tab){
	if(tab.url){ addNewTab(tab); }
});

chrome.tabs.onRemoved.addListener(function(tabId, info) {
	addClosedTab(tabId, 0);
});

chrome.tabs.onReplaced.addListener(async function(addedTabId, removedTabId) {
	await navigator.locks.request('simpleUndoClose_data', async (lock) => {
		const oldKey = "TabList-" + removedTabId;
		const newKey = "TabList-" + addedTabId;
		
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

async function initialize(){
	await setStorage({
        settings: defaultSettings,
        TabListIndex: [],
        ClosedTabIndex: [],
        SearchIndex: []
    });
	await regExistingTabs();
}

async function settingsUpdate(){
    let needsInit = false;
	await navigator.locks.request('simpleUndoClose_data', async (lock) => {
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
        
        let checks = await getStorage(['TabListIndex', 'ClosedTabIndex', 'SearchIndex']);
        if(!checks.TabListIndex){ await setStorage({ TabListIndex: [] }); }
        if(!checks.ClosedTabIndex){ await setStorage({ ClosedTabIndex: [] }); }
        
        // Migration: Build SearchIndex if missing but items exist
        if(!checks.SearchIndex && checks.ClosedTabIndex && checks.ClosedTabIndex.length > 0){
             let newIndex = [];
             const ids = checks.ClosedTabIndex;
             const keys = ids.map(id => "ClosedTab-" + id);
             const tabsData = await getStorage(keys);
             
             for(let id of ids){
                 const t = tabsData["ClosedTab-"+id];
                 if(t){
                     newIndex.push({ id: id, t: t.title, u: t.url });
                 }
             }
             await setStorage({ SearchIndex: newIndex });
        } else if (!checks.SearchIndex) {
             await setStorage({ SearchIndex: [] });
        }
	});

    if (needsInit) {
        await initialize();
    }
}

async function addClosedTab(tabId, mode){
    await navigator.locks.request('simpleUndoClose_data', async (lock) => {
        await addClosedTabInternal(tabId, mode);
    });
}

async function addClosedTabInternal(tabId, mode){
	const key = "TabList-" + tabId;
	let data = await getStorage([key, 'settings', 'ClosedTabIndex', 'TabListIndex']);

	if(data[key] != undefined){
		const settings = data.settings || defaultSettings;
		const closedTabIndex = data.ClosedTabIndex || [];
		
		let storageUpdates = {};
		let keysToRemove = [key];
        let idsToRemoveIndex = [];

        const tabData = data[key];
		const url = tabData.url;
		const re = /^(http:|https:|chrome-extension:|file:)/;
		
		if (url && re.test(url)) {
			let exists = -1;
			const closedTabKeys = closedTabIndex.map(id => "ClosedTab-" + id);
			const closedTabsData = await getStorage(closedTabKeys);

			for(let i = closedTabIndex.length-1; i>=0; i--){
				const closedTab = closedTabsData["ClosedTab-" + closedTabIndex[i]];
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
				keysToRemove.push("ClosedTab-"+exists);
                idsToRemoveIndex.push(exists);
				closedTabIndex.splice(closedTabIndex.indexOf(exists),1);
			}

			const rId = crypto.randomUUID();
			storageUpdates["ClosedTab-"+rId] = createObj;
			closedTabIndex.push(rId);

			if (closedTabIndex.length > settings.numLimit){
				for(let i = 0; i<closedTabIndex.length; i++){
					const cTabKey = "ClosedTab-" + closedTabIndex[i];
					const closedTab = closedTabsData[cTabKey]; 
					
					if (closedTab || closedTabsData[cTabKey] === undefined){ 
						keysToRemove.push(cTabKey);
                        idsToRemoveIndex.push(closedTabIndex[i]);
						closedTabIndex.splice(closedTabIndex.indexOf(closedTabIndex[i]),1);
						break;
					}
				}
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
		}
		
		const tabListIndex = data.TabListIndex || [];
		const tIdx = tabListIndex.indexOf(tabId);
		if (tIdx > -1) {
			tabListIndex.splice(tIdx, 1);
			storageUpdates.TabListIndex = tabListIndex;
            // Note: we might set TabListIndex twice in updates, but that's fine, last one wins or merge
            await setStorage({ TabListIndex: tabListIndex });
		}

		await setBadge();
	}
}

async function tabListProcessing() {
    await navigator.locks.request('simpleUndoClose_data', async (lock) => {
        let allData = await getStorage(null);
        let tabListIndex = allData.TabListIndex || [];
        
        for (const key in allData) {
            if(key.indexOf("TabList-")!=-1) {
                const tabListId = parseInt(key.substr(8));
                if(tabListIndex.indexOf(tabListId)!=-1){
                    await addClosedTabInternal(tabListId,1);
                }else{
                    await removeStorage([key]);
                }
            }
        }
    });
}

async function cleanClosedTabs() {
    await navigator.locks.request('simpleUndoClose_data', async (lock) => {
        let data = await getStorage(['ClosedTabIndex']);
        const indexList = data.ClosedTabIndex || [];
        const db = {};
        for (let i = 0; i < indexList.length; i++) {
            db[indexList[i]] = true;
        }

        let allData = await getStorage(null);
        
        for (let key in allData) {
            const parts = key.split('-');
            if (parts[0] === 'ClosedTab' && !db.hasOwnProperty(parts[1])) {
                await removeStorage([key]);
            }
        }

        let newIndexList = [];
        let indexChanged = false;
        for (let i = 0; i < indexList.length; i++) {
            if (allData["ClosedTab-" + indexList[i]]) {
                newIndexList.push(indexList[i]);
            } else {
                indexChanged = true;
            }
        }

        if (indexChanged) {
            await setStorage({ ClosedTabIndex: newIndexList });
        }
        
        // Sync SearchIndex
        let searchData = await getStorage(['SearchIndex']);
        let searchIndex = searchData.SearchIndex || [];
        let newSearchIndex = searchIndex.filter(item => db[item.id]); // Keep only if in valid ID list
        
        if (newSearchIndex.length !== searchIndex.length) {
            await setStorage({ SearchIndex: newSearchIndex });
        }
    });
}
