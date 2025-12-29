importScripts('common.js');

var defaultSettings = {
	"showClear" : true,
	"showBadge" : false,
	"showTime" : true,
	"showSearch" : true,
	"searchMode" : 1,
	"boldFont" : false,
	"saveHistory" : true,
	"menuTop" : false,
	"disableDClick" : true,
	"tooltipText" : true,
	"numLimit" : 10,
	"numItems" : 10,
	"numLines" : 1,
	"altBut" : false,
	"wPop" : 300,
	"sexy" : false,
	"style" : 1,
	"lpDelay" : 3,
	"mClickClose" : false,
	"theme" : "1"
};

chrome.runtime.onStartup.addListener(async function() {
	let data = await getStorage(['settings']);
	let settings = data.settings;
	if (settings && !settings.saveHistory) {
		await resetData(); 
	}
	else if (settings) {
		await tabListProcessing();
		await cleanClosedTabs();
		await setBadge();
		regExistingTabs();
		await updateIcon();
	}
});

chrome.runtime.onInstalled.addListener(async function(runInfo) {
	if (runInfo.reason=="install") {
		await initialize();
	}
	if (runInfo.reason=="update") {
		await setStorage({ dcTime: Date.now() });
		await settingsUpdate();
		// resetData(); 
	}
	await setBadge();
	await updateIcon();
});

chrome.tabs.onUpdated.addListener(function(tabId,changeInfo,tab){
	if(tab.url){addNewTab(tab);}
});

chrome.tabs.onRemoved.addListener(function(tabId, info)  {
	addClosedTab(tabId,0);
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
	if(command==="undo-latest") getLatestCTab();
});

async function initialize(){
	const manifest = chrome.runtime.getManifest();
	await setStorage({
        settings: defaultSettings,
        dcTime: Date.now(),
        updatedTill: manifest.version,
        TabListIndex: [],
        ClosedTabIndex: []
    });
	regExistingTabs();
}

async function settingsUpdate(){
	await navigator.locks.request('simpleUndoClose_data', async (lock) => {
		let data = await getStorage(['settings', 'updatedTill']);
		
		if(!data.settings){ await initialize(); return; }

		const manifest = chrome.runtime.getManifest();
		if(data.settings && (!data.updatedTill || needUpdateOrNot(data.updatedTill, "1.3.11"))){
			// console.log("Updating...");
			
			let settings = data.settings;
			var localKeys = Object.keys(settings).sort();
			var currDefKeys = Object.keys(defaultSettings).sort();
			
			if(localKeys.length != currDefKeys.length){
				
				if(localKeys.length < currDefKeys.length){
					// console.log("Updating settings...type 1");
					for(var i=0; i < currDefKeys.length; i++){
						if (!settings.hasOwnProperty(currDefKeys[i])) {
							settings[currDefKeys[i]] = defaultSettings[currDefKeys[i]];
						}
					}
					
				}else{
					// console.log("Updating settings...type 2");
					for(var i=0; i < localKeys.length; i++){
						var found = false;
						for(var j=0; j < currDefKeys.length; j++){
							if(localKeys[i] === currDefKeys[j]) {found = true; break;}
						}
						if(!found) {delete settings[localKeys[i]];}
					}
				}
				
				await setStorage({ settings: settings });
			}
			
			let checks = await getStorage(['TabListIndex', 'ClosedTabIndex']);
			if(!checks.TabListIndex){ await setStorage({ TabListIndex: [] }); }
			if(!checks.ClosedTabIndex){ await setStorage({ ClosedTabIndex: [] }); }
			
			//updateCTabs();
			
			await setStorage({ updatedTill: manifest.version });
		}
	});
}

//compare updatedTill with specified version, if greater true
function needUpdateOrNot(localVersion, specVer){
	var need = false;
	if(localVersion === undefined){need = true;}
	else if(localVersion !== undefined && specVer !== "skip"){
		if(localVersion !== specVer){
			var spcVer = specVer.split(".").map(Number);
			var tillVer = localVersion.split(".").map(Number);
			var len = Math.max(spcVer.length, tillVer.length);
			for(var i = 0; i<len; i++){
				if(spcVer[i]===undefined){spcVer[i]=0;}
				if(tillVer[i]===undefined){tillVer[i]=0;}
				if(spcVer[i]>tillVer[i]){need = true; break;} 
			}
		}	
	}
	return need;
}

async function addClosedTab(tabId, mode){
    await navigator.locks.request('simpleUndoClose_data', async (lock) => {
        await addClosedTabInternal(tabId, mode);
    });
}

async function addClosedTabInternal(tabId, mode){
	// console.log("REMOVED: "+tabId+"==="+(localStorage["TabList-"+tabId]!=undefined));
	const key = "TabList-" + tabId;
	// Fetch all necessary data at once
	let data = await getStorage([key, 'settings', 'ClosedTabIndex', 'TabListIndex']);

	if(data[key] != undefined){
		var settings = data.settings || defaultSettings;
		var closedTabIndex = data.ClosedTabIndex || [];
		
		let storageUpdates = {};
		let keysToRemove = [key]; // Always remove the TabList entry

		// Should we record this tab?
		var splitValue = data[key].split("|!|");
		var url = splitValue[0];
		var re = /^(http:|https:|chrome-extension:|file:)/;
		
		//if url is valid?
		if (url && re.test(url)) {
			var exists = -1;
			
			// Batch get all closed tabs to check existence
			let closedTabKeys = closedTabIndex.map(id => "ClosedTab-" + id);
			let closedTabsData = await getStorage(closedTabKeys);

			//go through all saved closed tabs
			for(var i = closedTabIndex.length-1; i>=0; i--){
				var closedTab = closedTabsData["ClosedTab-" + closedTabIndex[i]];
				if (closedTab){
					var split = closedTab.split("|!|");
					//if new removed exists in saved closed tabs
					if (split[1]===url){
						exists=closedTabIndex[i];
						break;
					}
				}
			}

			var createStr = Date.now() + "|!|" + data[key];
			//if new removed exists in saved closed tabs, mark for removal
			if (exists!=-1){
				keysToRemove.push("ClosedTab-"+exists);
				closedTabIndex.splice(closedTabIndex.indexOf(exists),1);
			}

			var rId = crypto.randomUUID();
			storageUpdates["ClosedTab-"+rId] = createStr;
			closedTabIndex.push(rId);

			// Code for managing overflow
			if (closedTabIndex.length > settings.numLimit){
				// console.log("OVERFLOW - "+closedTabIndex.length+">"+settings.numLimit);
				// We need to fetch data for the item we might delete to ensure we don't leave garbage? 
				// Actually we can just assume the first index is the oldest.
				// But original logic checked for existence. We already fetched closedTabsData.
				
				for(var i = 0; i<closedTabIndex.length; i++){
					let cTabKey = "ClosedTab-" + closedTabIndex[i];
					let closedTab = closedTabsData[cTabKey]; // Use cached data
					// If it wasn't in cache, maybe we should fetch? 
					// But we fetched all keys based on closedTabIndex at start.
					
					if (closedTab || closedTabsData[cTabKey] === undefined){ 
						// Original logic: if(closedTab). If it's in index but not data, we should probably just remove index.
						// Here we trust the index for overflow logic.
						
						keysToRemove.push(cTabKey);
						closedTabIndex.splice(closedTabIndex.indexOf(closedTabIndex[i]),1);
						break;
					}
				}
			}
			storageUpdates.ClosedTabIndex = closedTabIndex;
		}
		
		// Remove from TabListIndex
		var tabListIndex = data.TabListIndex || [];
		const tIdx = tabListIndex.indexOf(tabId);
		if (tIdx > -1) {
			tabListIndex.splice(tIdx, 1);
			storageUpdates.TabListIndex = tabListIndex;
		}

		// Perform Atomic Updates
		await setStorage(storageUpdates);
		await removeStorage(keysToRemove);
		await setBadge();
	}
}

//check for open tabs of previous browser close and make them closed tabs
async function tabListProcessing() {
    await navigator.locks.request('simpleUndoClose_data', async (lock) => {
        let allData = await getStorage(null);
        let tabListIndex = allData.TabListIndex || [];
        
        for (const key in allData) {
        // console.log("TLC"+i+" of "+storageSize+": "+localStorage.key(i));
            if(key.indexOf("TabList-")!=-1) {
                var tabListId = parseInt(key.substr(8));
                if(tabListIndex.indexOf(tabListId)!=-1){
                    await addClosedTabInternal(tabListId,1);
                }else{
                    await removeStorage([key]);
                }
            }
        }
    });
}

//thanks to Ehsan Kia, deletes orphaned ClosedTab entries
async function cleanClosedTabs() {
    await navigator.locks.request('simpleUndoClose_data', async (lock) => {
        let data = await getStorage(['ClosedTabIndex']);
        var indexList = data.ClosedTabIndex || [];
        var db = {};
        for (var i = 0; i < indexList.length; i++) {
            db[indexList[i]] = true;
        }

        let allData = await getStorage(null);
        
        // Remove orphaned data (Data exists, Index missing)
        for (let key in allData) {
            var parts = key.split('-');
            if (parts[0] === 'ClosedTab' && !db.hasOwnProperty(parts[1])) {
                await removeStorage([key]);
            }
        }

        // Remove orphaned index (Index exists, Data missing)
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
    });
}