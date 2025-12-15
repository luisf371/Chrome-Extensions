var settings = JSON.parse(localStorage.settings);

var pageNo = 0;

var filterTimeOut;
var filterStrings;
var filterRegEx;

var currentTime;
var content;
var noTabs;

var tWidth, tWidth2, tWidth3;

var delType = settings.style;
var longpress = false;
var lpdVal = settings.lpDelay * 1000;
var chkArray;
//dClickHandler();

//--Detect double click
//Wake the background page and do the stuff there
function dClickHandler() {
	if (!settings.disableDClick){
		chrome.runtime.sendMessage("dclick");
	}
}

function createLink(id, url, pgTitle) {
	var link = document.createElement('a');
	var animate = "longpress "+settings.lpDelay+"s";
	link.href="javascript:void(0);";
	
	//modified long click code from http://stackoverflow.com/questions/2625210/long-press-in-javascript
	var presstimer = null;
	var longtarget = null;

	var cancel = function(e) {
		if (presstimer !== null) {
			clearTimeout(presstimer);
			presstimer = null;
		}
		
		this.style.animation = "none";
	};

	var click = function(e) {
		if (presstimer !== null) {
			clearTimeout(presstimer);
			presstimer = null;
		}
		
		this.style.animation = "none";
		
		if (longpress) {
			return false;
		}
		
		if (e.button == 0){ 
			createTab(id,true);
			setup();
		}
	};
	
	var mclick = function(e) {	
		//if middle mouse button click
		if (e.button == 1){ 
			createTab(id,false); 
			if(!settings.mClickClose) {setup();}
			else {window.close();}
		}	
	};

	var start = function(e) {
		//console.log(e);
		longpress = false;
		
		if(e.button==0){
			this.style.animation = animate;
		
			presstimer = setTimeout(function() {
				//alert("long click");
				longpress = true;
				setup();
			}, lpdVal);
		}
		
		return false;
	};
  
	link.addEventListener("mousedown", start);
	link.addEventListener("touchstart", start);
	link.addEventListener("click", click);
	link.addEventListener("auxclick", mclick);
	link.addEventListener("mouseout", cancel);
	link.addEventListener("touchend", cancel);
	link.addEventListener("touchleave", cancel);
	link.addEventListener("touchcancel", cancel);
  
	if(settings.tooltipText){
		link.href = "javascript:void(0);";
		link.title = pgTitle;
	}else{
		link.title = url;
	}
	return link;
}
function encodeHtml(str) {
    return str
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

function setup(){

	content = document.getElementById("content");

	if (settings.menuTop == true) content = document.getElementById("content2");
	if (settings.boldFont == true) content.className+=" bold";
	
	populate();
	
	if(!noTabs && (settings.showSearch == true || settings.showClear == true || settings.numLimit > settings.numItems || longpress)) {
	//console.log("Controls show..");
		document.getElementById("controls").style.display="";
		
		if (settings.showSearch == false || longpress){
			document.getElementById("searchholder").style.display="none";
		}else{
			document.getElementById("searchholder").style.display="";
		}
		if (settings.showClear == false || longpress) {
			document.getElementById("clrholder").style.display="none";
		}else {
			document.getElementById("clr").style.display="inline";
		}

		if (filterStrings!=null) {
			document.getElementById("tailenders").className="tailendersShow";
			document.getElementById("delete").style.display="inline";
			document.getElementById("prev").style.display="none";
			document.getElementById("next").style.display="none";
			document.getElementById("clrholder").style.display="none";
		}else{
			document.getElementById("delete").style.display="none";
			if(settings.showClear&&!longpress) document.getElementById("clrholder").style.display="table-cell";
			document.getElementById("prev").style.display="inline";
			document.getElementById("next").style.display="inline";
		}
		
		if(!longpress){
			document.getElementById("lpholder").style.display="none";
		}else{
			document.getElementById("lpholder").style.display="";
		}
	
	}
	else{ document.getElementById("controls").style.display="none"; }
}

function populate(){
	
	var closedTabIndex = JSON.parse(localStorage.ClosedTabIndex);	
	if (closedTabIndex.length == 0){
		//console.log("No tabs");
		content.innerHTML=chrome.i18n.getMessage("popup_noTabsMsg");
		document.getElementById("controls").style.display="none";
		noTabs = true;
	}else{
		//console.log("LOAD PAGE");
		noTabs = false;
		content.innerHTML="";
		
		var closedTabIndex = JSON.parse(localStorage.ClosedTabIndex);
		var disp_per_pg=settings.numItems;
		if (filterStrings!=null) disp_per_pg=1000;

		currentTime = Date.now(); 
		
		var i = closedTabIndex.length - 1;
		for(var j = 0; i>=0 && j<pageNo*disp_per_pg; i--){ if (localStorage["ClosedTab-"+closedTabIndex[i]]) j++;}

		for(var j = 0; i>=0 && j<disp_per_pg; i--){
			var closedTab = localStorage["ClosedTab-"+closedTabIndex[i]];
			if (closedTab){
				if (filterStrings==null || (filterStrings!=null && closedTab.multiFind(filterStrings))){
					createEntry(closedTabIndex[i],closedTab);
					j++;
				}
			}
		}

		if (filterStrings==null) {
			//console.log("No search");
			document.getElementById("tailenders").className="tailendersHide";
			document.getElementById("prev").style.visibility="hidden";
			document.getElementById("next").style.visibility="hidden";
			if (pageNo > 0) {
			//console.log("tailenders4");
			document.getElementById("tailenders").className="tailendersShow";
			document.getElementById("prev").style.visibility="visible";
			}
			if (closedTabIndex.length > (pageNo+1) * settings.numItems) {
			//console.log("tailenders5");
			document.getElementById("tailenders").className="tailendersShow";
			document.getElementById("next").style.visibility="visible";
			}
		}else{
			if (j==0) content.innerHTML="<center>"+chrome.i18n.getMessage("popup_noSearchResult")+" \'"+unescape(filterStrings.join(" "))+"\'</center>";
		}
	}
	
}

function createEntry(i,closedTab) {

	var split = closedTab.split("|!|");
	var tabTime = split[0];
	var tabUrl = split[1];
	var tabTitle = encodeHtml(split[2]);

	var text_link = createLink(i, tabUrl, tabTitle);
	var html="";
	var fragment = document.createDocumentFragment();

	html+="<img class=\"icon\" src=\"chrome://favicon/"+tabUrl+"\" alt=\""+tabUrl+"\">"; 

	if (filterStrings!=null) tabTitle=tabTitle.multiReplace(filterStrings);
	
	html+="<div class=\"titleTxt";
	if (settings.numLines!=0 && !isNaN(settings.numLines) && filterStrings==null) html+=" maxh"+settings.numLines+"";
	if(longpress && delType!=2 && !settings.sexy) {
		tWidth3 = tWidth - 28;
		html+="\" style=\"width:"+tWidth3+"px\"> "+ tabTitle +"</div>";
	}else if((longpress || delType==2) && settings.sexy) {
		tWidth3 = tWidth - 28;
		html+="\" style=\"width:"+tWidth3+"px\"> "+ tabTitle +"</div>";
	}else{
		html+="\" style=\"width:"+tWidth+"px\"> "+ tabTitle +"</div>";
	}
	
	if(settings.showTime){ 
		var spanClass = "nxtLine";
		if(settings.sexy) spanClass = "nxtLine smeLine delTxt";
		html+="<span class=\""+spanClass+"\">"+getElapsedTime(currentTime - tabTime)+"</span>";
	}
	
	var itm = document.createElement("div");
	itm.innerHTML=html;
	
	if(!longpress){
		if(delType == 1){
			itm.className = "item";
			itm.appendChild(buildDelBtn(i));
			text_link.appendChild(itm);
			text_link.classList.add("link");
			content.appendChild(text_link);
		}
		if(delType == 2){
			var itm2 = document.createElement("div");
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
		var itm3 = document.createElement("div");
		itm3.className = "item2";
		
		var chkbx = document.createElement("input");
		chkbx.type = "checkbox";
		chkbx.name = "deleteList";
		chkbx.value = i;
		chkbx.id = "cb-"+i;
		chkbx.className = "chkbx";	
		var chkHandler = function(e) {
			//create a list and store ids
			var id = e.target.value;
			var alreadyIn = false;
			for(var i = chkArray.length - 1; i >= 0; i--) {
				if(chkArray[i] === id) {
					alreadyIn = true;
					chkArray.splice(i, 1);
				}
			}
			if(!alreadyIn) chkArray.push(id);
			//console.log(chkArray);
		}
		chkbx.addEventListener("click", chkHandler);
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
  var fragment = document.createDocumentFragment();
  
	 if(delType == 1){
		var delBtn = document.createElement("div");
		delBtn.id = "del-"+i;
		delBtn.className = "del";
		delBtn.title = chrome.i18n.getMessage("popup_delbtn");
		delBtn.innerHTML = "<p class=\"delTxt\">×</p>";
		delBtn.addEventListener('click',function(event){ 
		  event.stopPropagation(); //click-shield!
		  removeClosedTab(i); 
		  populate();
		},false);
		delBtn.addEventListener('mousedown',function(event){ 
		  event.stopPropagation(); //click-shield!
		});
		
		var delBg = document.createElement("div");
		delBg.className = "delBg";
		
		fragment.appendChild(delBtn);
		fragment.appendChild(delBg);
	}
	
	if(delType == 2){
		var delBtn = document.createElement("div");
		delBtn.id = "del-"+i;
		delBtn.className = "del2";
		delBtn.title = chrome.i18n.getMessage("popup_delbtn");
		delBtn.innerHTML = "<p class=\"delTxt2\">×</p>";
		delBtn.addEventListener('click',function(event){ 
		  event.stopPropagation(); //click-shield!
		  removeClosedTab(i); 
		  populate();
		},false);
		
		fragment.appendChild(delBtn);
	}
	
	return fragment;
}

function searchFor(string) {
	string = string.replace(/(\%)/g, "%25");
	string = string.replace(/^\s\s*/, '').replace(/\s\s*$/, '');
	string = stripVowelAccent(string);

	if ((filterStrings==null && string=="") || (filterStrings!=null && string==filterStrings.join(" "))) return;

	if (string==""){
		pageNo=0;
		filterStrings = null;
	}else{
		pageNo=0;
		//for(var i=0; i < filterStrings.length-1; i=i+1) { 
		string=string.toLowerCase();
		filterStrings = string.split(" "); 
	}
	clearTimeout(filterTimeOut);
	filterTimeOut=setTimeout(setup,200);
}
function next() {
	var closedTabIndex = JSON.parse(localStorage.ClosedTabIndex);
	if (closedTabIndex.length > (pageNo+1) * settings.numItems) pageNo++;
	setup();
}

function prev() {
	if (pageNo > 0) pageNo--;
	setup();
}

function reset(){
	if (document.getElementById("searchQ").value!=""){
		document.getElementById("searchQ").value="";
		searchFor("");
	}else{
		resetData();
		pageNo = 0;
		setup();
	}
}

function deleteFoundTabs(){
	if (filterStrings==null) return;
	var closedTabIndex = JSON.parse(localStorage.ClosedTabIndex);
	for(i = closedTabIndex.length - 1; i>=0; i--){
		var closedTab = localStorage["ClosedTab-"+closedTabIndex[i]];
		if (closedTab){
			if (filterStrings!=null && closedTab.multiFind(filterStrings)){
				removeClosedTab(closedTabIndex[i]);
			}
		}
	}
	document.getElementById('searchQ').value = "";
	filterStrings = null;
	setup();
}

//math from http://stackoverflow.com/questions/8211744/convert-time-interval-given-in-seconds-into-more-human-readable-form
function getElapsedTime(ms){
	var text = "<b>";
	var s,min,h,days,x;
    x = ms / 1000;
    s = Math.floor(x % 60);
    x /= 60;
    min = Math.floor(x % 60);
    x /= 60;
    h = Math.floor(x % 24);
    x /= 24;
    days = Math.floor(x);
	// console.log(days+":"+h+":"+min+":"+s);
		
	if(days!=0) {text += days+" day"; if(days>1) text+="s";}
	else if((h!=0&&h<2)&&min!=0) {text += h+"h "+min+"min "}
	else if(h!=0) {text += h+"h "}
	else if(min!=0) {text += min+"min "}
	else if(s!=0) {text += s+"s "}	
	else {text += "0s "}
	text+="</b> ago";
	
	return text;
}

function cleanInvalidTabs(){
	chrome.tabs.query({"url":"*://*/*"}, function(tabs) {
		var tabListIndex = JSON.parse(localStorage.TabListIndex);
		// console.log(tabs.length+" tabs vs "+tabListIndex.length+" indexed");
		if(tabListIndex.length>tabs.length){
			var tabsToClean = tabListIndex.length-tabs.length;
			for(var t = 0; t<tabsToClean; t++){
				delete localStorage["TabList-"+tabListIndex[t]];
			}
			tabListIndex.splice(0,tabsToClean);
			localStorage.TabListIndex = JSON.stringify(tabListIndex);
		}
	});
}

function findTabCBM(id){
	var found = false;
	if(chkArray.length>0){
		for(var i = chkArray.length - 1; i >= 0; i--) {
			if(chkArray[i] === id) {
				found = true;
			}
		}
	}
	return found;
}

function stripVowelAccent(str)
{
	var rExps=[ /[\xC0-\xC2]/g, /[\xE0-\xE2]/g,
		/[\xC8-\xCA]/g, /[\xE8-\xEB]/g,
		/[\xCC-\xCE]/g, /[\xEC-\xEE]/g,
		/[\xD2-\xD4]/g, /[\xF2-\xF4]/g,
		/[\xD9-\xDB]/g, /[\xF9-\xFB]/g ];

	var repChar=['A','a','E','e','I','i','O','o','U','u'];

	for(var i=0, j=rExps.length; i<j; ++i)
		str=str.replace(rExps[i],repChar[i]);

	return str;
}

function btnLangAdj(){
	var lang = chrome.i18n.getUILanguage();
	if(lang=="ru"){
		document.getElementById('clr').style.width="75px";
		document.getElementById('open1').style.fontSize="8px";
		document.getElementById('open2').style.fontSize="8px";
		document.getElementById('open2').style.padding="0px 4px";
		document.getElementById('delete2').style.fontSize="8px";
	}
	if(lang=="sr"){
		document.getElementById('open1').style.fontSize="8px";
		document.getElementById('open1').style.padding="0px 5px";
		document.getElementById('open2').style.fontSize="8px";
		document.getElementById('open2').style.padding="0px 5px";
		document.getElementById('delete2').style.fontSize="8px";
		document.getElementById('delete2').style.padding="0px 5px";
	}
}

String.prototype.multiFind = function ( strings ) {
//console.log("this-"+this);
	var str = this, i;
	str = stripVowelAccent(str);
	str = str.toLowerCase();
	if(settings.searchMode!=3){
		var splitStr = str.split("|!|");
		if(settings.searchMode==1) str = splitStr[2];
		if(settings.searchMode==2) str = splitStr[1];
	}
	var foundAmount=0;
	for(i = 0, j = strings.length; i < j; i++ ) {
	//console.log("str-"+str+"||strings[i]-"+strings[i]);
		if (str.indexOf(strings[i])!= -1) foundAmount++;
	}
	return (foundAmount==strings.length);
};
String.prototype.multiReplace = function ( strings ) {
	var str_real = this, i;
	var str = str_real;
	str = stripVowelAccent(str);
	str = str.toLowerCase();
	var position=-1;
	for(i = 0, j = strings.length; i < j; i++ ) {
		position = str.indexOf(strings[i]);
		if (position!= -1) {
			str_real = str_real.substr(0,position) + "<u>" + str_real.substr(position, strings[i].length) + "</u>" + str_real.substr(position + strings[i].length); 
			str = stripVowelAccent(str_real).toLowerCase();
		}
		//str = str.replace(new RegExp('(' + strings[i] + ')','gi'), replaceBy);
	}
	return str_real;
};

//keyboard navigation
var selLink = -1;
document.onkeydown = function(evt) {
    evt = evt || window.event;
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
        if (evt.keyCode == 38) { 
           if(selLink>0) selLink--;
		   else selLink=(document.links.length-1);
        }
        if (evt.keyCode == 40) { 
           if(selLink<(document.links.length-1)) selLink++;
		   else selLink=(0);
        }
		document.links[selLink].focus();
	}
	//enter
	else if (evt.keyCode == 13) {
		document.links[selLink].click();
	}
	else {
		document.getElementById('searchQ').focus();
	}
};

//populate popup and bind functions to buttons on popup load
document.addEventListener('DOMContentLoaded', function () {

document.body.style.width = settings.wPop+'px';
tWidth = settings.wPop - 30-5;
if(settings.sexy) tWidth -= 91;
if(!settings.sexy && delType == 2) tWidth -= 28;
tWidth2 = settings.wPop - 28;

chkArray = [];

btnLangAdj();
setup();

document.getElementById('clr').addEventListener('click',reset);
document.getElementById('clr').title = chrome.i18n.getMessage("popup_clrbtn_tooltip");
document.getElementById('clr').innerHTML = chrome.i18n.getMessage("popup_clrbtn");
document.getElementById('searchQ').addEventListener('input',function(){
 searchFor(document.getElementById('searchQ').value);
});
document.getElementById('searchQ').title = chrome.i18n.getMessage("popup_search_tooltip");
document.getElementById('delete').addEventListener('click',deleteFoundTabs);
document.getElementById('delete').title = chrome.i18n.getMessage("popup_delbtn_tooltip");
document.getElementById('delete').innerHTML = chrome.i18n.getMessage("popup_delbtn");
document.getElementById('prev').addEventListener('click',prev);
document.getElementById('prev').title = chrome.i18n.getMessage("popup_prvbtn_tooltip");
document.getElementById('next').addEventListener('click',next);
document.getElementById('next').title = chrome.i18n.getMessage("popup_nxtbtn_tooltip");

document.getElementById('open1').innerHTML = chrome.i18n.getMessage("popup_open1_btn");
document.getElementById('open1').title = chrome.i18n.getMessage("popup_open1_tooltip");
document.getElementById('open1').addEventListener('click',function(e){
	if(chkArray.length>0){
		for(var i = chkArray.length - 1; i >= 0; i--) {
			createTab(chkArray[i]);
		}
		window.close();
	}
},false);
document.getElementById('open2').innerHTML = chrome.i18n.getMessage("popup_open2_btn");
document.getElementById('open2').title = chrome.i18n.getMessage("popup_open2_tooltip");
document.getElementById('open2').addEventListener('click',function(e){
	chrome.windows.create(function(newWin){	
		if(chkArray.length>0){
			for(var i = chkArray.length - 1; i >= 0; i--) {
				createTabWindow(chkArray[i],newWin.id);
			}
			window.close();
		}
	});
},false);
document.getElementById('delete2').innerHTML = chrome.i18n.getMessage("popup_delbtn");
document.getElementById('delete2').title = chrome.i18n.getMessage("popup_delete2_tooltip");
document.getElementById('delete2').addEventListener('click',function(e){
	if(chkArray.length>0){
		for(var i = chkArray.length - 1; i >= 0; i--) {
			removeClosedTab(chkArray[i]);
		}
		chkArray = [];
		setup();
	}
},false);
document.getElementById('cancel').title = chrome.i18n.getMessage("popup_cancel_tooltip");
document.getElementById('cancel').addEventListener('click',function(e){
	longpress = false;
	chkArray = [];
	setup();
},false);

cleanInvalidTabs();

});