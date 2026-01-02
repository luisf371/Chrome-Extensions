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

            // Update stats when switching to General section
            if (targetId === 'general') {
                updateStatsCard();
            }
        });
    });

    // Listen for storage changes to update stats in real-time
    chrome.storage.onChanged.addListener((changes, areaName) => {
        const generalSection = document.getElementById('general');
        if (!generalSection || !generalSection.classList.contains('active')) return;

        if (areaName === 'local' && (changes.restoreCountAllTime || changes.installDate)) {
            updateStatsCard();
        }
        if (areaName === 'session' && changes.restoreCountSession) {
            updateStatsCard();
        }
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
    // Capture values
	settings.showClear = document.getElementById('showClear').checked;
	settings.showBadge = document.getElementById('showBadge').checked;
	settings.showTime = document.getElementById('showTime').checked;
	settings.showSearch = document.getElementById('showSearch').checked;
	settings.saveHistory = document.getElementById('saveHistory').checked;
	settings.removeHistory = document.getElementById('removeHistory').checked;
	settings.menuTop = document.getElementById('menuTop').checked;
	settings.tooltipText = document.getElementById('tooltipText').checked;
	settings.useAlternateIcon = document.getElementById('useAlternateIcon').checked;
	
	settings.searchMode = getRadioValue('searchIn');
	settings.style = getRadioValue('styleIn');
	settings.theme = getRadioValue('theme');
	
	settings.longPressDelay = document.getElementById("longPressDelay").value;
	settings.mClickClose = document.getElementById('mClickClose').checked;
	
    settings.popupWidth = Math.min(700, Math.max(300, parseInt(document.getElementById('popupWidth-value').textContent, 10)));
	settings.numLimit = parseInt(document.getElementById('numLimit-value').textContent, 10);
	settings.numItems = Math.min(80, Math.max(3, parseInt(document.getElementById("numItems").value, 10)));
	settings.numLines = Math.min(3, Math.max(1, parseInt(document.getElementById("numLines").value, 10)));
	
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

	// NEW: Update stats after saving
    updateStatsCard();

    // NEW: Show save indicator
    const saveIndicator = document.getElementById('saveIndicator');
    if (saveIndicator) {
        saveIndicator.classList.add('show');
        setTimeout(() => {
            saveIndicator.classList.remove('show');
        }, 2000);
    }
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
    setChecked('showSearch', settings.showSearch);
    setChecked('saveHistory', settings.saveHistory);
    setChecked('removeHistory', settings.removeHistory);
    setChecked('menuTop', settings.menuTop);
    setChecked('tooltipText', settings.tooltipText);
    setChecked('useAlternateIcon', settings.useAlternateIcon);
    setChecked('mClickClose', settings.mClickClose);

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
            display.textContent = val + suffix;
            
            input.addEventListener('input', (e) => {
                const v = e.target.value;
                display.textContent = v + suffix;
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
	
    const resetSessionBtn = document.getElementById('resetSessionButton');
    if (resetSessionBtn) {
        resetSessionBtn.addEventListener('click', async () => {
            const sure = confirm('Reset the restored tab counter for this session?');
            if (!sure) return;
            await chrome.storage.session.set({ restoreCountSession: 0 });
            updateStatsCard();
            showToast('Counter Reset', 'Restored tab counter set to 0 for this session.', 'success');
        });
    }
	
    const kbBtn = document.getElementById('openKBshort');
    if(kbBtn) kbBtn.addEventListener('click', openKBshortConfig);

	await updateIcon();

    // NEW: Initialize stats card and welcome toast
    updateStatsCard();
    showWelcomeToast();
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

// ========================================
// NEW: Stats Card Functionality
// ========================================

function updateStatsCard() {
    Promise.all([
        getStorage(['restoreCountAllTime', 'installDate']),
        chrome.storage.session.get(['restoreCountSession'])
    ]).then(([localData, sessionData]) => {
        const allTimeCount = Number(localData.restoreCountAllTime) || 0;
        const sessionCount = Number(sessionData.restoreCountSession) || 0;

        document.getElementById('stat-closed').textContent = allTimeCount;
        document.getElementById('stat-session').textContent = sessionCount;

        if (localData.installDate) {
            const installDate = new Date(localData.installDate);
            const today = new Date();
            const daysActive = Math.floor((today - installDate) / (1000 * 60 * 60 * 24));
            document.getElementById('stat-days').textContent = daysActive > 0 ? daysActive : 1;
        } else {
            document.getElementById('stat-days').textContent = '1';
        }
    });
}

// ========================================
// NEW: Toast Notification System
// ========================================

function showToast(title, message, type = 'info') {
    const container = document.getElementById('toastContainer');
    if (!container) return;

    const toast = document.createElement('div');
    toast.className = 'toast';

    const icon = document.createElement('div');
    icon.className = `toast-icon ${type}`;
    icon.textContent = type === 'success' ? '✓' : type === 'error' ? '✕' : 'i';

    const content = document.createElement('div');
    content.className = 'toast-content';

    const titleEl = document.createElement('div');
    titleEl.className = 'toast-title';
    titleEl.textContent = title;

    const messageEl = document.createElement('div');
    messageEl.className = 'toast-message';
    messageEl.textContent = message;

    content.appendChild(titleEl);
    content.appendChild(messageEl);

    toast.appendChild(icon);
    toast.appendChild(content);
    container.appendChild(toast);

    // Auto remove after 4 seconds
    setTimeout(() => {
        toast.classList.add('removing');
        setTimeout(() => {
            toast.remove();
        }, 300);
    }, 4000);
}

// Demo: Show welcome toast when page loads
function showWelcomeToast() {
    // Only show once per session
    if (!sessionStorage.getItem('welcomeToastShown')) {
        setTimeout(() => {
            showToast('Welcome!', 'Settings have been loaded successfully.', 'success');
            sessionStorage.setItem('welcomeToastShown', 'true');
        }, 1000);
    }
}
