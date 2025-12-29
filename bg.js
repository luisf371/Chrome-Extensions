importScripts('common.js');

const defaultSettings = {
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
		await regExistingTabs();
		await updateIcon();
	}
});

chrome.runtime.onInstalled.addListener(async function(runInfo) {
	if (runInfo.reason === "install") {
		await initialize();
	}
	if (runInfo.reason === "update") {
		await setStorage({ dcTime: Date.now() });
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
	const manifest = chrome.runtime.getManifest();
	await setStorage({
        settings: defaultSettings,
        dcTime: Date.now(),
        updatedTill: manifest.version,
        TabListIndex: [],
        ClosedTabIndex: []
    });
	await regExistingTabs();
}

async function settingsUpdate(){
	await navigator.locks.request('simpleUndoClose_data', async (lock) => {
		let data = await getStorage(['settings', 'updatedTill']);
		
		if(!data.settings){ await initialize(); return; }

		const manifest = chrome.runtime.getManifest();
		if(data.settings && (!data.updatedTill || needUpdateOrNot(data.updatedTill, "1.3.11"))){
			let settings = data.settings;
			const localKeys = Object.keys(settings).sort();
			const currDefKeys = Object.keys(defaultSettings).sort();
			
			if(localKeys.length != currDefKeys.length){
				if(localKeys.length < currDefKeys.length){
					for(let i=0; i < currDefKeys.length; i++){
						if (!settings.hasOwnProperty(currDefKeys[i])) {
							settings[currDefKeys[i]] = defaultSettings[currDefKeys[i]];
						}
					}
				} else {
					for(let i=0; i < localKeys.length; i++){
						let found = false;
						for(let j=0; j < currDefKeys.length; j++){
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
			
			await setStorage({ updatedTill: manifest.version });
		}
	});
}

function needUpdateOrNot(localVersion, specVer){
	let need = false;
	if(localVersion === undefined){need = true;}
	else if(localVersion !== undefined && specVer !== "skip"){
		if(localVersion !== specVer){
			const spcVer = specVer.split(".").map(Number);
			const tillVer = localVersion.split(".").map(Number);
			const len = Math.max(spcVer.length, tillVer.length);
			for(let i = 0; i<len; i++){
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
	const key = "TabList-" + tabId;
	let data = await getStorage([key, 'settings', 'ClosedTabIndex', 'TabListIndex']);

	if(data[key] != undefined){
		const settings = data.settings || defaultSettings;
		const closedTabIndex = data.ClosedTabIndex || [];
		
		let storageUpdates = {};
		let keysToRemove = [key];

		const splitValue = data[key].split("|!|");
		const url = splitValue[0];
		const re = /^(http:|https:|chrome-extension:|file:)/;
		
		if (url && re.test(url)) {
			let exists = -1;
			const closedTabKeys = closedTabIndex.map(id => "ClosedTab-" + id);
			const closedTabsData = await getStorage(closedTabKeys);

			for(let i = closedTabIndex.length-1; i>=0; i--){
				const closedTab = closedTabsData["ClosedTab-" + closedTabIndex[i]];
				if (closedTab){
					const split = closedTab.split("|!|");
					if (split[1]===url){
						exists=closedTabIndex[i];
						break;
					}
				}
			}

			const createStr = Date.now() + "|!|" + data[key];
			if (exists!=-1){
				keysToRemove.push("ClosedTab-"+exists);
				closedTabIndex.splice(closedTabIndex.indexOf(exists),1);
			}

			const rId = crypto.randomUUID();
			storageUpdates["ClosedTab-"+rId] = createStr;
			closedTabIndex.push(rId);

			if (closedTabIndex.length > settings.numLimit){
				for(let i = 0; i<closedTabIndex.length; i++){
					const cTabKey = "ClosedTab-" + closedTabIndex[i];
					const closedTab = closedTabsData[cTabKey]; 
					
					if (closedTab || closedTabsData[cTabKey] === undefined){ 
						keysToRemove.push(cTabKey);
						closedTabIndex.splice(closedTabIndex.indexOf(closedTabIndex[i]),1);
						break;
					}
				}
			}
			storageUpdates.ClosedTabIndex = closedTabIndex;
		}
		
		const tabListIndex = data.TabListIndex || [];
		const tIdx = tabListIndex.indexOf(tabId);
		if (tIdx > -1) {
			tabListIndex.splice(tIdx, 1);
			storageUpdates.TabListIndex = tabListIndex;
		}

		await setStorage(storageUpdates);
		await removeStorage(keysToRemove);
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
    });
}