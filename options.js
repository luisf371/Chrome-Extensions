let settings = {};

async function save() {
	if(!document.getElementById('showTime').checked) {
        document.getElementById('enhancedStylingContainer').style.display = "none";
    } else {
        document.getElementById('enhancedStylingContainer').style.display = "block";
    }

	settings.showClear = document.getElementById('showClear').checked;
	settings.showBadge = document.getElementById('showBadge').checked;
	settings.showTime = document.getElementById('showTime').checked;
	settings.enhancedStyling = document.getElementById('enhancedStyling').checked;
	settings.showSearch = document.getElementById('showSearch').checked;
	settings.boldFont = document.getElementById('bold').checked;
	settings.saveHistory = document.getElementById('saveHistory').checked;
	settings.menuTop = document.getElementById('menuTop').checked;
	settings.tooltipText = document.getElementById('tooltipText').checked;
	settings.useAlternateIcon = document.getElementById('useAlternateIcon').checked;
	
	settings.searchMode = getRadioValue('searchIn');
	settings.style = getRadioValue('styleIn');
	settings.theme = getRadioValue('theme');
	
	settings.longPressDelay = document.getElementById("longPressDelay").value;
	settings.mClickClose = document.getElementById('mClickClose').checked;
	
	settings.popupWidth = parseInt(document.getElementById('popupWidth-value').textContent, 10);
	settings.numLimit = parseInt(document.getElementById('numLimit-value').textContent, 10);
	settings.numItems = document.getElementById("numItems").value;
	settings.numLines = parseInt(document.getElementById("numLines").value, 10);
	
	await setStorage({ settings: settings });

	let data = await getStorage(['ClosedTabIndex']);
	let closedTabIndex = data.ClosedTabIndex || [];

	if (closedTabIndex.length > settings.numLimit){
	  await trimTabs(settings.numLimit);
	}
	await setBadge();
	await updateIcon();
}

document.addEventListener('DOMContentLoaded', async function () {
	let data = await getStorage(['settings']);
	settings = data.settings;
	if (!settings) return;
	
	document.getElementById('showClear').checked = settings.showClear;
	document.getElementById('showClear').addEventListener('click', save);

	document.getElementById('showBadge').checked = settings.showBadge;
	document.getElementById('showBadge').addEventListener('click', save);

	document.getElementById('showTime').checked = settings.showTime;
	document.getElementById('showTime').addEventListener('click', save);
	if(!settings.showTime) document.getElementById('enhancedStylingContainer').style.display = "none";
	
	document.getElementById('enhancedStyling').checked = settings.enhancedStyling;
	document.getElementById('enhancedStyling').addEventListener('click', save);

	document.getElementById('showSearch').checked = settings.showSearch;
	document.getElementById('showSearch').addEventListener('click', save);

	document.getElementById('bold').checked = settings.boldFont;
	document.getElementById('bold').addEventListener('click', save);

	document.getElementById('saveHistory').checked = settings.saveHistory;
	document.getElementById('saveHistory').addEventListener('click', save);

	document.getElementById('menuTop').checked = settings.menuTop;
	document.getElementById('menuTop').addEventListener('click', save);
	
	document.getElementById('tooltipText').checked = settings.tooltipText;
	document.getElementById('tooltipText').addEventListener('click', save);
	
	document.getElementById('useAlternateIcon').checked = settings.useAlternateIcon;
	document.getElementById('useAlternateIcon').addEventListener('click', save);
	
	document.getElementById('searchIn'+settings.searchMode).checked = true;
	document.getElementById('searchIn1').addEventListener('click', save);
	document.getElementById('searchIn2').addEventListener('click', save);
	document.getElementById('searchIn3').addEventListener('click', save);
	
	document.getElementById('style'+settings.style).checked = true;
	document.getElementById('style1').addEventListener('click', save);
	document.getElementById('style2').addEventListener('click', save);
	document.getElementById('style3').addEventListener('click', save);
	
	document.getElementById('longPressDelay').value = settings.longPressDelay; chkLPval();
	document.getElementById('longPressDelay').addEventListener('change', save);
	document.getElementById('mClickClose').checked = settings.mClickClose;
	document.getElementById('mClickClose').addEventListener('click', save);
	
	document.getElementById('theme'+settings.theme).checked = true;
	document.getElementById('theme1').addEventListener('click', async function(){ await save(); location.reload(); });
	document.getElementById('theme2').addEventListener('click', async function(){ await save(); location.reload(); });
	document.getElementById('theme3').addEventListener('click', async function(){ await save(); location.reload(); });
	
	const popWidth = document.getElementById('popupWidth');
	const popWidthValue = document.getElementById('popupWidth-value');
	popWidth.value = popWidthValue.textContent = parseInt(settings.popupWidth, 10);
	popWidth.addEventListener('input', function(event) { popWidthValue.textContent = event.target.value; }, false);
	popWidth.addEventListener('change', save, false);

	await updateIcon();

	const limitValue = document.getElementById('numLimit-value');
	document.getElementById('numLimit').value = settings.numLimit;
	limitValue.textContent = settings.numLimit;
	document.getElementById('numLimit').addEventListener('input', function(event) {
        limitValue.textContent = event.target.value;
    }, false);
	document.getElementById('numLimit').addEventListener('change', save, false);

	const widthValue = document.getElementById('numItems-value');
	document.getElementById('numItems').value = widthValue.textContent = settings.numItems;
	document.getElementById('numItems').addEventListener('input', function(event) {
        widthValue.textContent = event.target.value;
    }, false);
	document.getElementById('numItems').addEventListener('change', save, false);

	const lines = document.getElementById('numLines');
	const linesValue = document.getElementById('numLines-value');
	lines.value = linesValue.textContent = parseInt(settings.numLines, 10);

	if (lines.value == 0) linesValue.textContent = "No Limit";
	lines.addEventListener('input', function(event) { 
        if (event.target.value == 0) linesValue.textContent = "No Limit"; 
        else linesValue.textContent = event.target.value;
    }, false);
	lines.addEventListener('change', save, false);

	document.getElementById('resetButton').addEventListener('click', clearMemory);

	document.getElementById('searchOpt').title = chrome.i18n.getMessage("opt_func_opt1_tooltip");
	document.getElementById('ctrlzOpt').title = chrome.i18n.getMessage("opt_func_opt5_tooltip");
	
	document.getElementById('openKBshort').addEventListener('click', openKBshortConfig);
	document.getElementById('longPressDelay').addEventListener('blur', chkLPval);
});

async function trimTabs(tablimit){
	let data = await getStorage(['ClosedTabIndex']);
	let closedTabIndex = data.ClosedTabIndex || [];

	const noToDelete = closedTabIndex.length - tablimit;
	
	if (noToDelete <= 0) {
		return;
	}

	let keysToRemove = [];
	for(let i = 0; i < noToDelete; i++){
		if (closedTabIndex.length > 0) { 
			keysToRemove.push("ClosedTab-" + closedTabIndex[0]);
			closedTabIndex.shift();
		} else {
			break; 
		}
	}

	if (keysToRemove.length > 0) {
		await removeStorage(keysToRemove);
	}
	await setStorage({ ClosedTabIndex: closedTabIndex });
}

function informHotkeyChange(){
	// Placeholder
}

function getRadioValue(radioGroup){
	const rGrp = document.getElementsByName(radioGroup);
    for(let i = 0; i < rGrp.length; i++){
        if (rGrp[i].checked){
			return rGrp[i].value;
        }
    }
}

function openKBshortConfig() { 
	if(window.navigator.vendor === "Opera Software ASA" || (window.navigator.userAgent).indexOf("OPR/") != -1){
		chrome.tabs.create({url: 'chrome://settings/configureCommands'});
	}else{
		chrome.tabs.create({url: 'chrome://extensions/configureCommands'});
	}
}

function chkLPval(){
	if (document.getElementById('longPressDelay').value === "") {
        document.getElementById('longPressDelay').value = "1";
        save();
    }
}

function clearMemory(){
	const sure = confirm(chrome.i18n.getMessage("opt_resetbtn_popupMsg"));
	if (sure === true) resetData();
}
