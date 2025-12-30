import { getStorage, setStorage, removeStorage, setBadge, updateIcon } from './common.js';

let settings = {};

// Sidebar Toggle Logic
function setupSidebarToggle() {
    const toggleBtn = document.getElementById('sidebarToggle');
    const sidebar = document.querySelector('.sidebar');
    
    // Load state
    const isCollapsed = localStorage.getItem('sidebarCollapsed') === 'true';
    if (isCollapsed) {
        sidebar.classList.add('collapsed');
    }

    toggleBtn.addEventListener('click', () => {
        sidebar.classList.toggle('collapsed');
        localStorage.setItem('sidebarCollapsed', sidebar.classList.contains('collapsed'));
    });
}

// Navigation Logic
function setupNavigation() {
    const navButtons = document.querySelectorAll('.nav-item');
    const sections = document.querySelectorAll('.content-section');

    navButtons.forEach(btn => {
        btn.addEventListener('click', () => {
            const targetId = btn.getAttribute('data-section');
            
            // Update buttons
            navButtons.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');

            // Update sections
            sections.forEach(s => {
                s.classList.remove('active');
                if (s.id === targetId) {
                    s.classList.add('active');
                }
            });
        });
    });
}

// Theme Logic
function applyTheme(themeValue) {
    document.body.classList.remove('theme-light', 'theme-dark');
    if (themeValue === "2") {
        document.body.classList.add('theme-light');
    } else if (themeValue === "3") {
        document.body.classList.add('theme-dark');
    }
}

async function save() {
    // Visibility toggles
	if(!document.getElementById('showTime').checked) {
        document.getElementById('enhancedStylingContainer').style.display = "none";
    } else {
        document.getElementById('enhancedStylingContainer').style.display = "block";
    }

    // Capture values
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

    // Apply theme immediately
    applyTheme(settings.theme);

    // Update background/badge state
	let data = await getStorage(['ClosedTabIndex']);
	let closedTabIndex = data.ClosedTabIndex || [];

	if (closedTabIndex.length > settings.numLimit){
	  await trimTabs(settings.numLimit);
	}
	await setBadge();
	await updateIcon();
}

document.addEventListener('DOMContentLoaded', async function () {
    setupNavigation();
    setupSidebarToggle();

	let data = await getStorage(['settings']);
	settings = data.settings || {};
	
    // Initialize Inputs
	const setChecked = (id, val) => {
        const el = document.getElementById(id);
        if(el) {
            el.checked = val;
            el.addEventListener('change', save); // Changed from 'click' to 'change' for consistency
        }
    };

    setChecked('showClear', settings.showClear);
    setChecked('showBadge', settings.showBadge);
    setChecked('showTime', settings.showTime);
    setChecked('enhancedStyling', settings.enhancedStyling);
    setChecked('showSearch', settings.showSearch);
    setChecked('bold', settings.boldFont);
    setChecked('saveHistory', settings.saveHistory);
    setChecked('menuTop', settings.menuTop);
    setChecked('tooltipText', settings.tooltipText);
    setChecked('useAlternateIcon', settings.useAlternateIcon);
    setChecked('mClickClose', settings.mClickClose);

    // Handle conditional display immediately
	if(!settings.showTime && document.getElementById('enhancedStylingContainer')) {
        document.getElementById('enhancedStylingContainer').style.display = "none";
    }

    // Radio Groups
    const setRadio = (name, val) => {
        if(val) {
            const el = document.getElementById(name + val);
            if(el) el.checked = true;
        }
        document.getElementsByName(name).forEach(r => r.addEventListener('change', save));
    };

    setRadio('searchIn', settings.searchMode);
    setRadio('styleIn', settings.style);
    setRadio('theme', settings.theme); // Logic simplified, no reload needed now

    // Theme Initial Apply
    applyTheme(settings.theme);

    // Inputs with Logic
	const lpDelay = document.getElementById('longPressDelay');
    if(lpDelay) {
        lpDelay.value = settings.longPressDelay;
        lpDelay.addEventListener('change', () => { chkLPval(); save(); });
        lpDelay.addEventListener('blur', chkLPval);
    }

    // Sliders
    const setupSlider = (id, val, suffix = "") => {
        const input = document.getElementById(id);
        const display = document.getElementById(id + '-value');
        if(input && display) {
            input.value = val;
            display.textContent = val === 0 && id === 'numLines' ? "No Limit" : val + suffix;
            
            input.addEventListener('input', (e) => {
                const v = e.target.value;
                display.textContent = (v == 0 && id === 'numLines') ? "No Limit" : v + suffix;
            });
            input.addEventListener('change', save);
        }
    };

    setupSlider('popupWidth', parseInt(settings.popupWidth, 10));
    setupSlider('numLimit', settings.numLimit);
    setupSlider('numItems', settings.numItems);
    setupSlider('numLines', parseInt(settings.numLines, 10));


    // Buttons
	document.getElementById('resetButton').addEventListener('click', clearMemory);
	
    const kbBtn = document.getElementById('openKBshort');
    if(kbBtn) kbBtn.addEventListener('click', openKBshortConfig);

	await updateIcon();
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
    const el = document.getElementById('longPressDelay');
	if (el.value === "" || parseInt(el.value) < 1) {
        el.value = "1";
    }
}

function clearMemory(){
	const sure = confirm(chrome.i18n.getMessage("opt_resetbtn_popupMsg"));
	if (sure === true) resetData();
}