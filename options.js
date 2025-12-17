var settings = {};

async function save() {
	if(!document.getElementById('showTime').checked) {document.getElementById('sexyBack').style.display = "none";}
	else {document.getElementById('sexyBack').style.display = "block";}

	settings.showClear = document.getElementById('showClear').checked;
	settings.showBadge = document.getElementById('showBadge').checked;
	settings.showTime = document.getElementById('showTime').checked;
	settings.sexy = document.getElementById('sexy').checked;
	settings.showSearch = document.getElementById('showSearch').checked;
	settings.boldFont = document.getElementById('bold').checked;
	settings.saveHistory = document.getElementById('saveHistory').checked;
	settings.menuTop = document.getElementById('menuTop').checked;
	settings.disableDClick = document.getElementById('disableDClick').checked;
	settings.tooltipText = document.getElementById('tooltipText').checked;
	settings.altBut = document.getElementById('altBut').checked;
	
	settings.searchMode = getRadioValue('searchIn');
	settings.style = getRadioValue('styleIn');
	settings.theme = getRadioValue('theme');
	
	settings.lpDelay = document.getElementById("lpdValue").value;
	settings.mClickClose = document.getElementById('mClickClose').checked;
	
	settings.wPop = parseInt(document.getElementById('wPop-value').textContent,10);
	settings.numLimit = parseInt(document.getElementById('numLimit-value').textContent,10);
	settings.numItems = document.getElementById("numItems").value;
	settings.numLines = parseInt(document.getElementById("numLines").value,10);
	
	await setStorage({ settings: settings });

	let data = await getStorage(['ClosedTabIndex']);
	let closedTabIndex = data.ClosedTabIndex || [];

	if (closedTabIndex.length>settings.numLimit){
	  await trimTabs(settings.numLimit);
	}
	await setBadge();
	await updateIcon();
}

// Make sure the options gets properly initialized from the
// saved preference.
document.addEventListener('DOMContentLoaded', async function () {
	let data = await getStorage(['settings']);
	settings = data.settings;
	if (!settings) return;
	
	document.getElementById('doubleClickFunc').style.display = 'none'; //hide dclick for now
	
	document.getElementById('showClear').checked = settings.showClear;
	document.getElementById('showClear').addEventListener('click', save);

	document.getElementById('showBadge').checked = settings.showBadge;
	document.getElementById('showBadge').addEventListener('click', save);

	document.getElementById('showTime').checked = settings.showTime;
	document.getElementById('showTime').addEventListener('click', save);
	if(!settings.showTime) document.getElementById('sexyBack').style.display = "none";
	
	document.getElementById('sexy').checked = settings.sexy;
	document.getElementById('sexy').addEventListener('click', save);

	document.getElementById('showSearch').checked = settings.showSearch;
	document.getElementById('showSearch').addEventListener('click', save);

	document.getElementById('bold').checked = settings.boldFont;
	document.getElementById('bold').addEventListener('click', save);

	document.getElementById('saveHistory').checked = settings.saveHistory;
	document.getElementById('saveHistory').addEventListener('click', save);

	document.getElementById('menuTop').checked = settings.menuTop;
	document.getElementById('menuTop').addEventListener('click', save);

	document.getElementById('disableDClick').checked = settings.disableDClick;
	document.getElementById('disableDClick').addEventListener('click', save);
	
	document.getElementById('tooltipText').checked = settings.tooltipText;
	document.getElementById('tooltipText').addEventListener('click', save);
	
	document.getElementById('altBut').checked = settings.altBut;
	document.getElementById('altBut').addEventListener('click', save);
	
	document.getElementById('searchIn'+settings.searchMode).checked = true;
	document.getElementById('searchIn1').addEventListener('click', save);
	document.getElementById('searchIn2').addEventListener('click', save);
	document.getElementById('searchIn3').addEventListener('click', save);
	
	document.getElementById('style'+settings.style).checked = true;
	document.getElementById('style1').addEventListener('click', save);
	document.getElementById('style2').addEventListener('click', save);
	document.getElementById('style3').addEventListener('click', save);
	
	document.getElementById('lpdValue').value = settings.lpDelay; chkLPval();
	document.getElementById('lpdValue').addEventListener('input', save);
	document.getElementById('mClickClose').checked = settings.mClickClose;
	document.getElementById('mClickClose').addEventListener('click', save);
	
	document.getElementById('theme'+settings.theme).checked = true;
	document.getElementById('theme1').addEventListener('click', function(){save();location.reload();});
	document.getElementById('theme2').addEventListener('click', function(){save();location.reload();});
	document.getElementById('theme3').addEventListener('click', function(){save();location.reload();});
	
	var popWidth = document.getElementById('wPop');
	var popWidthValue = document.getElementById('wPop-value');
	popWidth.value = popWidthValue.textContent = parseInt(settings.wPop,10);
	popWidth.addEventListener('input', function(event) { popWidthValue.textContent = event.target.value;save();}, false);

	var limitValue = document.getElementById('numLimit-value');
	document.getElementById('numLimit').value = parseInt(Math.pow((((settings.numLimit-5)*Math.pow(600,5))/99994),0.2),10);
	limitValue.textContent = settings.numLimit;
	document.getElementById('numLimit').addEventListener('input', function(event) {limitValue.textContent = 5+  parseInt((Math.pow(event.target.value,5)/Math.pow(600,5)) * 99994,10);save();}, false);

	var widthValue = document.getElementById('numItems-value');
	document.getElementById('numItems').value = widthValue.textContent = settings.numItems;
	document.getElementById('numItems').addEventListener('input', function(event) {widthValue.textContent = event.target.value;save();}, false);

	var lines = document.getElementById('numLines');
	var linesValue = document.getElementById('numLines-value');
	lines.value = linesValue.textContent = parseInt(settings.numLines,10);

	if (lines.value==0) linesValue.textContent="No Limit";
	lines.addEventListener('input', function(event) { if (event.target.value==0) linesValue.textContent="No Limit"; else linesValue.textContent = event.target.value;save();}, false);

	document.getElementById('resetButton').addEventListener('click', clearMemory);

	document.getElementById('searchOpt').title = chrome.i18n.getMessage("opt_func_opt1_tooltip");
	document.getElementById('ctrlzOpt').title = chrome.i18n.getMessage("opt_func_opt5_tooltip");
	
	document.getElementById('openKBshort').addEventListener('click', openKBshortConfig);
	document.getElementById('lpdValue').addEventListener('blur', chkLPval);
});

async function trimTabs(tablimit){
	// Trim off the excess saved closed tabs
	let data = await getStorage(['ClosedTabIndex']);
	let closedTabIndex = data.ClosedTabIndex || [];

	var noToDelete = closedTabIndex.length - tablimit;
	for(var i = 0; i<noToDelete; i++){
		let key = "ClosedTab-"+closedTabIndex[i];
		let cData = await getStorage([key]);
		if(cData[key]){
			await removeStorage([key]);
			closedTabIndex.splice(closedTabIndex.indexOf(closedTabIndex[i]),1);
		}
	}
	await setStorage({ ClosedTabIndex: closedTabIndex });
}

function informHotkeyChange(){
	// Removed or needs update if used. Not called in original code effectively.
}

function getRadioValue(radioGroup){
	var rGrp = document.getElementsByName(radioGroup);
    for(var i = 0, j = rGrp.length; i < j; i++){
        if (rGrp[i].checked){
			return rGrp[i].value;
        }
    }
}

function selectItemByValue(elmnt, value){
	for(var i=0; i < elmnt.options.length; i++){
	  if(elmnt.options[i].value == value) elmnt.selectedIndex = i;
	}
}

function openKBshortConfig() { 
	if(window.navigator.vendor === "Opera Software ASA"||(window.navigator.userAgent).indexOf("OPR/")!=-1){
		chrome.tabs.create({url: 'chrome://settings/configureCommands'});
	}else{
		chrome.tabs.create({url: 'chrome://extensions/configureCommands'});
	}
}

function chkLPval(){
	if (document.getElementById('lpdValue').value === "") {document.getElementById('lpdValue').value = "1";save();}
}

function clearMemory(){
	var sure=confirm(chrome.i18n.getMessage("opt_resetbtn_popupMsg"));
	if (sure==true) resetData();
}