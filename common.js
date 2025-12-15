// Show |url| in a new tab.
function createTab(id,selected) {
	var url = localStorage["ClosedTab-"+id].split("|!|")[1];
	if (selected==true){
		chrome.tabs.create({"url": url,"active":true});  
		window.close();
	}else{
		chrome.tabs.create({"url": url,"active":false});  
	}
	
	removeClosedTab(id);
}

function createTabWindow(id,wId) {
	var url = localStorage["ClosedTab-"+id].split("|!|")[1];
	chrome.tabs.create({"url": url,"windowId": wId});
	
	removeClosedTab(id);
}

function addNewTab(tab) {
// console.log("ADD NEW "+tab.url+"|!|"+tab.title+"|!|"+tab.status);
	// var re = /^(http:|https:|ftp:|file:)/;
	var re = /^(http:|https:|chrome-extension:)/;
	if (re.test(tab.url)) {
		if(chkNewTab(tab)){
			var insertThis = tab.url+"|!|";
			insertThis += tab.title;
			localStorage["TabList-"+tab.id] = insertThis;
			var tabListIndex = JSON.parse(localStorage.TabListIndex);
			if(tabListIndex.indexOf(tab.id)==-1) {tabListIndex.push(tab.id);
			localStorage.TabListIndex = JSON.stringify(tabListIndex);}
		}
	}
}

//check if url same, not same than pass
function chkNewTab(tab){
	var pass = false;
	var inList = localStorage["TabList-"+tab.id];
	if(inList===undefined||inList&&(inList.split("|!|")[0]!==tab.url||(inList.split("|!|")[0]===tab.url&&inList.split("|!|")[1]!==tab.title))) pass = true;
	return pass;
}

function removeClosedTab(id){
	var closedTabIndex = JSON.parse(localStorage.ClosedTabIndex);
	delete localStorage["ClosedTab-"+id];
	closedTabIndex.splice(closedTabIndex.indexOf(id),1);
	localStorage.ClosedTabIndex = JSON.stringify(closedTabIndex);
	setBadge();
}

function setBadge() {
	var settings = JSON.parse(localStorage.settings);
	if(settings.showBadge){
		var closedTabIndex = JSON.parse(localStorage.ClosedTabIndex);
		var n = closedTabIndex.length;
		if (n > 0){
			chrome.browserAction.setBadgeBackgroundColor({color:[15, 161, 211, 255]});
			chrome.browserAction.setBadgeText({text: n.toString()});
		}else{
			chrome.browserAction.setBadgeText({text: ""});
		}
	}else{
		chrome.browserAction.setBadgeText({text: ""});
	}
}

function resetData() {	
	//console.log("RESET");
	var settings = JSON.parse(localStorage.settings);
	var oldUpdTill = localStorage.updatedTill;
	localStorage.clear();
	
	localStorage.settings = JSON.stringify(settings);
	localStorage.updatedTill = oldUpdTill;
	
	localStorage.setItem("TabListIndex",JSON.stringify([]));
	localStorage.setItem("ClosedTabIndex",JSON.stringify([]));
	// localStorage.lastCloseTime = 0;
	
	regExistingTabs();
	setBadge(); 
}

function updateIcon() {
	var settings = JSON.parse(localStorage["settings"]);
	
	if(settings.altBut){
		chrome.browserAction.setIcon({path:{"19": "icon-19-1.png","38": "icon-38-1.png"}});
	}else{
		if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
			// dark mode
			chrome.browserAction.setIcon({
				path : {
					"19" : "icon-19-2.png",
					"38" : "icon-38-2.png"
				}
			});
		}
		else{
			chrome.browserAction.setIcon({
				path : {
					"19" : "icon-19-0.png",
					"38" : "icon-38-0.png"
				}
			});
		}
	}
}

function regExistingTabs(){
	chrome.tabs.query({"url":"*://*/*"}, function(tabs) {
	// console.log(tabs.length+" tabs");
		for(var t = 0; t<tabs.length; t++){
		// console.log("add tab "+t);
			addNewTab(tabs[t]);
		}
	});
}

function getLatestCTab(){
	// console.log("LAST CLOSED TAB");
	var closedTabIndex = JSON.parse(localStorage.ClosedTabIndex);
	if(closedTabIndex.length>0) createTab(closedTabIndex[closedTabIndex.length-1],true);
}