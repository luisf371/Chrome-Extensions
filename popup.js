let settings = {};

let pageNo = 0;

let filterTimeOut;
let filterStrings;

let currentTime;
let content;
let noTabs;

let tWidth, tWidth2, tWidth3;

let delType;
let longpress = false;
let lpdVal;
let chkArray;

// Variables for Long Press Logic (Delegated)
let presstimer = null;
let longTarget = null;

function createLink(id, url, pgTitle) {
	const link = document.createElement('a');
	link.href = "#";
	link.dataset.id = id;
    link.className = "link-entry"; // Marker for delegation

	if(settings.tooltipText){
		link.title = pgTitle;
	}else{
		link.title = url;
	}
	return link;
}

// Replaced encodeHtml with the version in common.js (assumed present)

async function setup(){

	content = document.getElementById("content");

	if (settings.menuTop === true) content = document.getElementById("content2");
	if (settings.boldFont === true) content.classList.add("bold");
	
	await populate();
	
	if(!noTabs && (settings.showSearch === true || settings.showClear === true || settings.numLimit > settings.numItems || longpress)) {
		document.getElementById("controls").style.display = "";
		
		if (settings.showSearch === false || longpress){
			document.getElementById("searchholder").style.display = "none";
		}else{
			document.getElementById("searchholder").style.display = "";
		}
		if (settings.showClear === false || longpress) {
			document.getElementById("clrholder").style.display = "none";
		}else {
			document.getElementById("clr").style.display = "inline";
		}

		if (filterStrings != null) {
			document.getElementById("tailenders").className = "tailendersShow";
			document.getElementById("delete").style.display = "inline";
			document.getElementById("prev").style.display = "none";
			document.getElementById("next").style.display = "none";
			document.getElementById("clrholder").style.display = "none";
		}else{
			document.getElementById("delete").style.display = "none";
			if(settings.showClear && !longpress) document.getElementById("clrholder").style.display = "table-cell";
			document.getElementById("prev").style.display = "inline";
			document.getElementById("next").style.display = "inline";
		}
		
		if(!longpress){
			document.getElementById("lpholder").style.display = "none";
		}else{
			document.getElementById("lpholder").style.display = "";
		}
	
	}
	else{ document.getElementById("controls").style.display = "none"; }
}

async function populate(){
	
	let data = await getStorage(['ClosedTabIndex']);
	let closedTabIndex = data.ClosedTabIndex || [];

	// Clear existing content safely
    while (content.firstChild) {
        content.removeChild(content.firstChild);
    }

	if (closedTabIndex.length === 0){
		const msg = chrome.i18n.getMessage("popup_noTabsMsg");
		const div = document.createElement('div');
		div.style.textAlign = 'center';
		div.innerHTML = msg;
		content.appendChild(div);

		document.getElementById("controls").style.display = "none";
		noTabs = true;
	}else{
		noTabs = false;
		
		let disp_per_pg = settings.numItems;
		if (filterStrings != null) disp_per_pg = 1000;

		currentTime = Date.now(); 
		
		let allKeys = closedTabIndex.map(id => "ClosedTab-" + id);
		let closedTabsMap = await getStorage(allKeys);

		let missingIds = [];
		for(let id of closedTabIndex){
			if(!closedTabsMap["ClosedTab-"+id]){
				missingIds.push(id);
			}
		}

		if(missingIds.length > 0){
			await removeClosedTabBatch(missingIds);
			closedTabIndex = closedTabIndex.filter(id => !missingIds.includes(id));
			if (closedTabIndex.length === 0){
				const msg = chrome.i18n.getMessage("popup_noTabsMsg");
				const div = document.createElement('div');
				div.style.textAlign = 'center';
				div.innerHTML = msg;
				content.appendChild(div);

				document.getElementById("controls").style.display = "none";
				noTabs = true;
				return;
			}
		}

		let i = closedTabIndex.length - 1;
		let j = 0;
        // Skip pages
		for(; i>=0 && j<pageNo*disp_per_pg; i--){ 
            if (closedTabsMap["ClosedTab-"+closedTabIndex[i]]) j++;
        }

        j = 0;
		for(; i>=0 && j<disp_per_pg; i--){
			let key = "ClosedTab-"+closedTabIndex[i];
			let closedTab = closedTabsMap[key];
			if (closedTab){
				if (filterStrings == null || (filterStrings != null && multiFind(closedTab, filterStrings, settings))){
					createEntry(closedTabIndex[i], closedTab);
					j++;
				}
			}
		}

		if (filterStrings == null) {
			document.getElementById("tailenders").className = "tailendersHide";
			document.getElementById("prev").style.visibility = "hidden";
			document.getElementById("next").style.visibility = "hidden";
			if (pageNo > 0) {
    			document.getElementById("tailenders").className = "tailendersShow";
    			document.getElementById("prev").style.visibility = "visible";
			}
			if (closedTabIndex.length > (pageNo+1) * settings.numItems) {
    			document.getElementById("tailenders").className = "tailendersShow";
    			document.getElementById("next").style.visibility = "visible";
			}
		}else{
			if (j === 0) {
                const center = document.createElement('center');
                center.textContent = chrome.i18n.getMessage("popup_noSearchResult") + " '" + filterStrings.join(" ") + "'";
                content.appendChild(center);
            }
		}
	}
}

function createEntry(i, closedTab) {

	const split = closedTab.split("|!|");
	const tabTime = split[0];
	const tabUrl = split[1];
	let tabTitle = split[2];

	const text_link = createLink(i, tabUrl, tabTitle);

    // V3 favicon URL
    const faviconUrl = `_favicon/?pageUrl=${encodeURIComponent(tabUrl)}&size=16`;
    
    const icon = document.createElement('img');
    icon.className = "icon";
    icon.src = faviconUrl;
    icon.alt = tabUrl; // Safe assignment

    let titleDiv = document.createElement('div');
    titleDiv.className = "titleTxt";
    
	if (settings.numLines != 0 && !isNaN(settings.numLines) && filterStrings == null) {
        titleDiv.classList.add("maxh" + settings.numLines);
    }

	if (filterStrings != null) {
        // Use multiReplace from common.js which returns safe HTML with <u> tags
        titleDiv.innerHTML = multiReplace(tabTitle, filterStrings); 
    } else {
	    titleDiv.textContent = tabTitle; // Safe assignment
    }
	
	if(longpress && delType != 2 && !settings.sexy) {
		tWidth3 = tWidth - 28;
	} else if((longpress || delType == 2) && settings.sexy) {
		tWidth3 = tWidth - 28;
	} else {
        tWidth3 = tWidth;
	}
    titleDiv.style.width = tWidth3 + "px";
	
    let timeSpan = null;
	if(settings.showTime){ 
		timeSpan = document.createElement('span');
        timeSpan.className = "nxtLine";
		if(settings.sexy) {
            timeSpan.className = "nxtLine smeLine delTxt";
        }
		timeSpan.innerHTML = getElapsedTime(currentTime - tabTime); // getElapsedTime returns bold tags
	}
	
	let itm = document.createElement("div");
    // Compose item
    itm.appendChild(icon);
    itm.appendChild(titleDiv);
    if(timeSpan) itm.appendChild(timeSpan);
	
	if(!longpress){
		if(delType == 1){
			itm.className = "item";
			itm.appendChild(buildDelBtn(i));
			text_link.appendChild(itm);
			text_link.classList.add("link");
			content.appendChild(text_link);
		}
		if(delType == 2){
			const itm2 = document.createElement("div");
			itm2.className = "item2";
		
			text_link.appendChild(itm);
			text_link.style.width = tWidth2+"px";
			text_link.classList.add("classicExpand");
			itm2.appendChild(buildDelBtn(i));
			itm2.appendChild(text_link);
			content.appendChild(itm2);
		}
		if(delType == 3){
			itm.className = "item";
			text_link.appendChild(itm);
			text_link.classList.add("link");
			content.appendChild(text_link);
		}
	}else{
		const itm3 = document.createElement("div");
		itm3.className = "item2";
		
		const chkbx = document.createElement("input");
		chkbx.type = "checkbox";
		chkbx.name = "deleteList";
		chkbx.value = i;
		chkbx.id = "cb-"+i;
		chkbx.className = "chkbx";	
		
        // Note: Checkbox listener is now delegated
		chkbx.checked = findTabCBM(i);
		
		text_link.appendChild(itm);
		text_link.style.width = tWidth2+"px";
		text_link.classList.add("classicExpand");
		
		itm3.appendChild(text_link);
		itm3.appendChild(chkbx);
		content.appendChild(itm3);
	}
}

function buildDelBtn(i){
    const fragment = document.createDocumentFragment();
  
    if(delType == 1){
		const delBtn = document.createElement("div");
		delBtn.dataset.id = i;
		delBtn.className = "del";
		delBtn.title = chrome.i18n.getMessage("popup_delbtn");
		
        const delTxt = document.createElement("p");
        delTxt.className = "delTxt";
        delTxt.innerHTML = "&times;";
        delBtn.appendChild(delTxt);
		
		const delBg = document.createElement("div");
		delBg.className = "delBg";
		
		fragment.appendChild(delBtn);
		fragment.appendChild(delBg);
	}
	
	if(delType == 2){
		const delBtn = document.createElement("div");
		delBtn.dataset.id = i;
		delBtn.className = "del2";
		delBtn.title = chrome.i18n.getMessage("popup_delbtn");

        const delTxt = document.createElement("p");
        delTxt.className = "delTxt2";
        delTxt.innerHTML = "&times;";
        delBtn.appendChild(delTxt);
		
		fragment.appendChild(delBtn);
	}
	
	return fragment;
}

function searchFor(string) {
	string = string.replace(/^\s\s*/, '').replace(/\s\s*$/, '');
	string = stripVowelAccent(string);

	if ((filterStrings == null && string === "") || (filterStrings != null && string == filterStrings.join(" "))) return;

	if (string === ""){
		pageNo = 0;
		filterStrings = null;
	}else{
		pageNo = 0;
		string = string.toLowerCase();
		filterStrings = string.split(" "); 
	}
	clearTimeout(filterTimeOut);
	filterTimeOut = setTimeout(setup, 200);
}

function next() {
    (async () => {
        let data = await getStorage(['ClosedTabIndex']);
        let closedTabIndex = data.ClosedTabIndex || [];
        if (closedTabIndex.length > (pageNo+1) * settings.numItems) pageNo++;
        await setup();
    })();
}

function prev() {
    (async () => {
        if (pageNo > 0) pageNo--;
        await setup();
    })();
}

function reset(){
	if (document.getElementById("searchQ").value !== ""){
		document.getElementById("searchQ").value = "";
		searchFor("");
	}else{
		resetData().then(() => {
            pageNo = 0;
            setup();
        });
	}
}

async function deleteFoundTabs(){
	if (filterStrings == null) return;
	let data = await getStorage(['ClosedTabIndex']);
    let closedTabIndex = data.ClosedTabIndex || [];
    let keys = closedTabIndex.map(id => "ClosedTab-" + id);
    let closedTabsMap = await getStorage(keys);
    
	let idsToRemove = [];
	for(let i = closedTabIndex.length - 1; i>=0; i--){
		let closedTab = closedTabsMap["ClosedTab-"+closedTabIndex[i]];
		if (closedTab){
			if (filterStrings != null && multiFind(closedTab, filterStrings, settings)){
				idsToRemove.push(closedTabIndex[i]);
			}
		}
	}
	if (idsToRemove.length > 0) {
		await removeClosedTabBatch(idsToRemove);
	}
	document.getElementById('searchQ').value = "";
	filterStrings = null;
	await setup();
}

function getElapsedTime(ms){
	let text = "<b>";
	let s,min,h,days,x;
    x = ms / 1000;
    s = Math.floor(x % 60);
    x /= 60;
    min = Math.floor(x % 60);
    x /= 60;
    h = Math.floor(x % 24);
    x /= 24;
    days = Math.floor(x);
		
	if(days != 0) {text += days+" day"; if(days>1) text+="s";}
	else if((h!=0 && h<2) && min!=0) {text += h+"h "+min+"min "}
	else if(h!=0) {text += h+"h "}
	else if(min!=0) {text += min+"min "}
	else if(s!=0) {text += s+"s "}	
	else {text += "0s "}
	text+="</b> ago";
	
	return text;
}

function cleanInvalidTabs(){
	chrome.tabs.query({}, async function(tabs) {
		await navigator.locks.request('simpleUndoClose_data', async (lock) => {
			let data = await getStorage(['TabListIndex']);
			let tabListIndex = data.TabListIndex || [];
			
			let currentTabIds = new Set(tabs.map(t => t.id));
			
			let newTabListIndex = [];
			let invalidTabIds = [];

			for(let i = 0; i < tabListIndex.length; i++){
				let tId = tabListIndex[i];
				if(currentTabIds.has(tId)){
					newTabListIndex.push(tId);
				} else {
					invalidTabIds.push(tId);
				}
			}

			if(invalidTabIds.length > 0){
				let keysToRemove = invalidTabIds.map(id => "TabList-" + id);
				await removeStorage(keysToRemove);
				
				await setStorage({ TabListIndex: newTabListIndex });
			}
		});
	});
}

function findTabCBM(id){
	let found = false;
	if(chkArray.length > 0){
		for(let i = chkArray.length - 1; i >= 0; i--) {
			if(chkArray[i] == id) {
				found = true;
			}
		}
	}
	return found;
}

function btnLangAdj(){
	const lang = chrome.i18n.getUILanguage();
	if(lang == "ru"){
		document.getElementById('clr').style.width="75px";
		document.getElementById('open1').style.fontSize="8px";
		document.getElementById('open2').style.fontSize="8px";
		document.getElementById('open2').style.padding="0px 4px";
		document.getElementById('delete2').style.fontSize="8px";
	}
	if(lang == "sr"){
		document.getElementById('open1').style.fontSize="8px";
		document.getElementById('open1').style.padding="0px 5px";
		document.getElementById('open2').style.fontSize="8px";
		document.getElementById('open2').style.padding="0px 5px";
		document.getElementById('delete2').style.fontSize="8px";
		document.getElementById('delete2').style.padding="0px 5px";
	}
}

// Global Event Handlers for Delegation
function handleGlobalClick(e) {
    // Delete Button
    const delBtn = e.target.closest('.del, .del2');
    if (delBtn) {
        e.stopPropagation();
        (async () => {
             await removeClosedTab(delBtn.dataset.id); 
             await populate();
        })();
        return;
    }

    // Checkbox
    if (e.target.classList.contains('chkbx')) {
        const id = e.target.value;
        const index = chkArray.indexOf(id);
        if (index > -1) {
            chkArray.splice(index, 1);
        } else {
            chkArray.push(id);
        }
        return;
    }

    // Link
    const link = e.target.closest('.link-entry');
    if (link) {
        e.preventDefault();
        
        cancelLongPress(); // Clear timer just in case
        link.style.animation = "none";

        if (longpress) {
            return;
        }

        createTab(link.dataset.id, true);
        setup();
    }
}

function handleGlobalAuxClick(e) {
     // Middle Click
    if (e.button == 1) {
        const link = e.target.closest('.link-entry');
        if (link) {
            e.preventDefault();
            (async () => {
                await createTab(link.dataset.id, false);
                if(!settings.mClickClose) {
                    setup();
                } else {
                    window.close();
                }
            })();
        }
    }
}

function handleGlobalMouseDown(e) {
    if (e.button === 0) {
        const link = e.target.closest('.link-entry');
        if (link) {
            longpress = false;
            longTarget = link;
            
            const animate = "longpress " + settings.lpDelay + "s";
            link.style.animation = animate;

            presstimer = setTimeout(function() {
                longpress = true;
                setup();
            }, lpdVal);
        }
    }
}

function handleGlobalCancel(e) {
    cancelLongPress();
}

function cancelLongPress() {
    if (presstimer !== null) {
        clearTimeout(presstimer);
        presstimer = null;
    }
    if (longTarget) {
        longTarget.style.animation = "none";
        longTarget = null;
    }
}

// Keyboard navigation
let selLink = -1;
document.onkeydown = function(evt) {
    evt = evt || window.event;
    // ... logic for keyboard nav needs to find links since we generate them differently?
    // document.links returns all <a> tags, which we still use.
    
	//left right
	if (evt.keyCode == 37||evt.keyCode == 39) { 
		if (evt.keyCode == 37) { 
           prev();
        }
        if (evt.keyCode == 39) { 
           next();
        }
	}
	//up down
	else if (evt.keyCode == 38||evt.keyCode == 40) {
        // Filter out non-entry links if necessary, but document.links usually grabs everything
        // We might want to filter by class .link-entry
        const entries = document.querySelectorAll('.link-entry');
        
        if (evt.keyCode == 38) { 
           if(selLink>0) selLink--;
		   else selLink = (entries.length-1);
        }
        if (evt.keyCode == 40) { 
           if(selLink < (entries.length-1)) selLink++;
		   else selLink = 0;
        }
        if (entries[selLink]) entries[selLink].focus();
	}
	//enter
	else if (evt.keyCode == 13) {
        const entries = document.querySelectorAll('.link-entry');
        if (entries[selLink]) entries[selLink].click();
	}
	else {
		document.getElementById('searchQ').focus();
	}
};

document.addEventListener('DOMContentLoaded', async function () {

    let data = await getStorage(['settings']);
    settings = data.settings;
    if (!settings) return;

    delType = settings.style;
    lpdVal = settings.lpDelay * 1000;

    document.body.style.width = settings.wPop+'px';
    tWidth = settings.wPop - 30-5;
    if(settings.sexy) tWidth -= 91;
    if(!settings.sexy && delType == 2) tWidth -= 28;
    tWidth2 = settings.wPop - 28;

    chkArray = [];

    btnLangAdj();
    
    // Attach Delegated Listeners to Content Container (or Body)
    // Using content2 as well if it exists? 
    // Best to attach to a common parent or iterate. 
    // The setup() function switches 'content' var between element 'content' and 'content2'.
    // We can just attach to document.body to be safe and cover all dynamic areas.
    
    document.body.addEventListener('click', handleGlobalClick);
    document.body.addEventListener('auxclick', handleGlobalAuxClick);
    document.body.addEventListener('mousedown', handleGlobalMouseDown);
    document.body.addEventListener('touchstart', handleGlobalMouseDown, {passive: true}); // map touch to mousedown logic
    document.body.addEventListener('mouseout', handleGlobalCancel);
    document.body.addEventListener('touchend', handleGlobalCancel);
    document.body.addEventListener('touchleave', handleGlobalCancel);
    document.body.addEventListener('touchcancel', handleGlobalCancel);

    await setup();

    document.getElementById('clr').addEventListener('click', reset);
    document.getElementById('clr').title = chrome.i18n.getMessage("popup_clrbtn_tooltip");
    document.getElementById('clr').textContent = chrome.i18n.getMessage("popup_clrbtn");
    
    document.getElementById('searchQ').addEventListener('input', function(){
        searchFor(document.getElementById('searchQ').value);
    });
    document.getElementById('searchQ').title = chrome.i18n.getMessage("popup_search_tooltip");
    
    document.getElementById('delete').addEventListener('click', deleteFoundTabs);
    document.getElementById('delete').title = chrome.i18n.getMessage("popup_delbtn_tooltip");
    document.getElementById('delete').textContent = chrome.i18n.getMessage("popup_delbtn");
    
    document.getElementById('prev').addEventListener('click', prev);
    document.getElementById('prev').title = chrome.i18n.getMessage("popup_prvbtn_tooltip");
    document.getElementById('next').addEventListener('click', next);
    document.getElementById('next').title = chrome.i18n.getMessage("popup_nxtbtn_tooltip");

    document.getElementById('open1').textContent = chrome.i18n.getMessage("popup_open1_btn");
    document.getElementById('open1').title = chrome.i18n.getMessage("popup_open1_tooltip");
    document.getElementById('open1').addEventListener('click', async function(e){
        if(chkArray.length>0){
            for(let i = chkArray.length - 1; i >= 0; i--) {
                await createTab(chkArray[i]);
            }
            window.close();
        }
    },false);
    
    document.getElementById('open2').textContent = chrome.i18n.getMessage("popup_open2_btn");
    document.getElementById('open2').title = chrome.i18n.getMessage("popup_open2_tooltip");
    document.getElementById('open2').addEventListener('click', function(e){
        chrome.windows.create(async function(newWin){    
            if(chkArray.length>0){
                for(let i = chkArray.length - 1; i >= 0; i--) {
                    await createTabWindow(chkArray[i], newWin.id);
                }
                window.close();
            }
        });
    },false);
    
    document.getElementById('delete2').textContent = chrome.i18n.getMessage("popup_delbtn");
    document.getElementById('delete2').title = chrome.i18n.getMessage("popup_delete2_tooltip");
    document.getElementById('delete2').addEventListener('click', async function(e){
        if(chkArray.length>0){
            await removeClosedTabBatch(chkArray);
            chkArray = [];
            await setup();
        }
    },false);
    
    document.getElementById('cancel').title = chrome.i18n.getMessage("popup_cancel_tooltip");
    document.getElementById('cancel').addEventListener('click', async function(e){
        longpress = false;
        chkArray = [];
        await setup();
    },false);

    cleanInvalidTabs();

});
