(async function() {
    const settings = await chrome.storage.local.get(null);
    
    // =====================
    // Utility Functions
    // =====================
    const setSetting = (key, value, showToast = true) => {
        if (value === null || value === undefined) {
            delete settings[key];
            chrome.storage.local.remove([key]);
        } else {
            settings[key] = value;
            chrome.storage.local.set({ [key]: value });
        }
        if (showToast && key !== 'optionsTheme') {
            queueToast();
        }
    };

    // =====================
    // Toast Notification
    // =====================
    let toastTimeout = null;
    let toastVisible = false;
    let saveDebounce = null;

    function showToast(message = 'Saved', type = 'success') {
        const toast = document.getElementById('toast');
        const toastIcon = toast.querySelector('.toast-icon');
        const toastMessage = toast.querySelector('.toast-message');
        
        if (!toast) return;

        if (toastTimeout) clearTimeout(toastTimeout);
        
        if (toastVisible) {
            toast.classList.remove('show');
            setTimeout(() => displayToast(), 100);
        } else {
            displayToast();
        }
        
        function displayToast() {
            toastMessage.textContent = message;
            toastIcon.textContent = type === 'success' ? '\u2713' : '\u2717';
            toast.className = 'toast ' + type;
            
            requestAnimationFrame(() => {
                toast.classList.add('show');
                toastVisible = true;
            });
            
            toastTimeout = setTimeout(() => {
                toast.classList.remove('show');
                toastVisible = false;
            }, 1500);
        }
    }

    function queueToast() {
        if (saveDebounce) clearTimeout(saveDebounce);
        saveDebounce = setTimeout(() => {
            const msg = chrome.i18n.getMessage('statusSaved') || 'Saved';
            showToast(msg, 'success');
        }, 300);
    }

    // =====================
    // Theme Support (Options Page)
    // =====================
    function initOptionsTheme() {
        const themeToggle = document.getElementById('themeToggle');
        
        chrome.storage.local.get(['optionsTheme'], (result) => {
            const theme = result.optionsTheme || 'dark';
            document.body.setAttribute('data-theme', theme);
        });
        
        if (themeToggle) {
            themeToggle.addEventListener('click', () => {
                const currentTheme = document.body.getAttribute('data-theme') || 'dark';
                const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
                document.body.setAttribute('data-theme', newTheme);
                chrome.storage.local.set({ optionsTheme: newTheme });
            });
        }
    }

    // =====================
    // i18n Support
    // =====================
    const _m = chrome.i18n.getMessage;

    function initI18n() {
        document.querySelectorAll('[data-i18n]').forEach(el => {
            const key = el.getAttribute('data-i18n');
            const message = _m(key);
            if (message) {
                if (el.children.length === 0 || el.tagName === 'OPTION') {
                    el.textContent = message;
                }
            }
        });
        
        // Version badge
        const versionEl = document.getElementById('version');
        if (versionEl) {
            versionEl.textContent = 'v' + chrome.runtime.getManifest().version;
        }
        
        // Document title
        const extName = _m('extName') || 'sNeatBookmarks';
        const options = _m('options') || 'Options';
        document.title = extName + ' - ' + options;
    }

    // =====================
    // CSS Template
    // =====================
    const CSS_TEMPLATE = `/* Baseline Theme Template */
body {
    background-color: #ffffff;
    color: #000000;
}

#search {
    background-color: #f2f2f2;
    border-bottom: 1px solid #cccccc;
}

#search-input {
    background-color: #ffffff;
    color: #000000;
    border: 1px solid #cccccc;
}

li.parent > span { color: #000000; }
li.child > a     { color: #000000; }

li.parent > span:hover,
li.child > a:hover {
    background-color: #e6e6e6;
    color: #000000;
}`;

    // =====================
    // Popup Themes
    // =====================
    const THEMES = {
        light: '',
        'light-modern': `/* Light (Modern) Theme */
body {
    background-color: #ffffff !important;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif !important;
    color: #333333 !important;
}
#search { background-color: #ffffff !important; border-bottom: 1px solid #f0f0f0 !important; padding: 8px !important; box-shadow: 0 2px 10px rgba(0,0,0,0.03); }
#search-input { background-color: #f5f5f7 !important; color: #1d1d1f !important; border: 1px solid transparent !important; border-radius: 6px !important; padding: 6px 10px !important; }
#search-input:focus { background-color: #ffffff !important; border-color: #007aff !important; box-shadow: 0 0 0 3px rgba(0,122,255,0.1) !important; }
#tree, #results { background-color: #ffffff !important; color: #333333 !important; text-shadow: none !important; }
li.parent > span, li.child > a { color: #333333 !important; text-shadow: none !important; border-radius: 4px; margin: 0 2px !important; }
li.parent > span:hover, li.child > a:hover { background-color: #f2f2f7 !important; color: #000000 !important; }
#tree ul li span .twisty { border-color: transparent transparent transparent #8e8e93 !important; }
::-webkit-scrollbar { width: 8px; background-color: transparent; }
::-webkit-scrollbar-thumb { background-color: #d1d1d6; border-radius: 4px; }`,
        dark: `/* Dark Mode */
body { background-color: #2b2b2b !important; color: #cccccc !important; }
#search { background-color: #333333 !important; border-bottom: 1px solid #444444 !important; }
#search-input { background-color: #444444 !important; color: #ffffff !important; border: 1px solid #555555 !important; }
#tree, #results { background-color: #2b2b2b !important; color: #cccccc !important; text-shadow: none !important; }
li.parent > span, li.child > a { color: #cccccc !important; text-shadow: none !important; }
li.parent > span:hover, li.child > a:hover { background-color: #444444 !important; color: #ffffff !important; }
#tree ul li span .twisty { border-color: transparent transparent transparent #888888 !important; }
.context-menu { background-color: #333333 !important; border: 1px solid #444444 !important; }
.context-menu .command { color: #cccccc !important; text-shadow: none !important; }
.context-menu .command:hover { background-color: #444444 !important; color: #ffffff !important; background-image: none !important; }
.dialog { background-color: #2b2b2b !important; color: #cccccc !important; border-bottom: 1px solid #444444 !important; }
.dialog input { background-color: #333333 !important; color: #ffffff !important; border: 1px solid #444444 !important; }
.dialog button { background-color: #444444 !important; color: #ffffff !important; border: 1px solid #555555 !important; }
::-webkit-scrollbar { width: 10px; background-color: #2b2b2b; }
::-webkit-scrollbar-thumb { background-color: #555555; }`,
        neon: `/* Neon Night */
body { background-color: #0f172a !important; font-family: 'Segoe UI', sans-serif !important; }
#tree, #results, a, span, i, li { color: #38bdf8 !important; text-shadow: none !important; }
li.parent > span, li.parent > span i { color: #f472b6 !important; font-weight: bold !important; }
li.child > a:hover, li.parent > span:hover { background-color: #334155 !important; color: #ffffff !important; }
#search { background-color: #1e293b !important; border-bottom: 2px solid #38bdf8 !important; }
#search-input { background-color: #0f172a !important; color: #ffffff !important; border: 1px solid #38bdf8 !important; }
#tree ul li span .twisty { border-color: transparent transparent transparent #94a3b8 !important; }`,
        vintage: `/* Vintage Parchment */
body { background-color: #f5f5dc !important; font-family: 'Georgia', 'Times New Roman', serif !important; }
#tree, #results, a, span, i, li { color: #3e2723 !important; text-shadow: none !important; }
#search { background-color: #e8e0c5 !important; border-bottom: 2px solid #8d6e63 !important; padding: 8px !important; }
#search-input { background-color: #fffbf0 !important; color: #3e2723 !important; border: 1px solid #8d6e63 !important; font-family: 'Georgia', serif !important; font-style: italic !important; }
li.parent > span { color: #8b0000 !important; font-weight: bold !important; font-variant: small-caps !important; }
li.child > a:hover, li.parent > span:hover { background-color: #d7ccc8 !important; color: #000 !important; }
#tree ul li span .twisty { border-color: transparent transparent transparent #5d4037 !important; }
img { filter: sepia(100%) contrast(1.2) !important; opacity: 0.9 !important; }
::-webkit-scrollbar-thumb { background: #a1887f !important; }`
    };

    // =====================
    // Initialize
    // =====================
    function init() {
        initI18n();
        initOptionsTheme();
        
        // CSS Template
        const cssTemplateEl = document.getElementById('css-template');
        if (cssTemplateEl) {
            cssTemplateEl.textContent = CSS_TEMPLATE;
        }
        
        // Reset text
        const extName = _m('extName') || 'sNeatBookmarks';
        const resetTextEl = document.getElementById('resetText');
        if (resetTextEl) {
            resetTextEl.textContent = _m('resetText', [extName]) || 'Reset all options to default.';
        }
    }

    // =====================
    // Setup Listeners
    // =====================
    function setupListeners() {
        // General Settings
        const clickNewTab = $('click-new-tab');
        const popupStayOpen = $('popup-stay-open');
        const popupStayContainer = $('popup-stay-container');
        
        const togglePopupStayOption = () => {
            if (clickNewTab.checked) {
                popupStayContainer.classList.add('disabled');
            } else {
                popupStayContainer.classList.remove('disabled');
            }
        };

        clickNewTab.checked = !!settings.leftClickNewTab;
        clickNewTab.addEventListener('change', function() {
            setSetting('leftClickNewTab', clickNewTab.checked ? '1' : '');
            togglePopupStayOption();
        });
        
        popupStayOpen.checked = !!settings.bookmarkClickStayOpen;
        popupStayOpen.addEventListener('change', function() {
            setSetting('bookmarkClickStayOpen', popupStayOpen.checked ? '1' : '');
        });
        togglePopupStayOption();
        
        const openNewTabBg = $('open-new-tab-bg');
        openNewTabBg.checked = !!settings.middleClickBgTab;
        openNewTabBg.addEventListener('change', function() {
            setSetting('middleClickBgTab', openNewTabBg.checked ? '1' : '');
        });
        
        const closeUnusedFolders = $('close-unused-folders');
        closeUnusedFolders.checked = !!settings.closeUnusedFolders;
        closeUnusedFolders.addEventListener('change', function() {
            setSetting('closeUnusedFolders', closeUnusedFolders.checked ? '1' : '');
        });
        
        const confirmOpenFolder = $('confirm-open-folder');
        confirmOpenFolder.checked = !settings.dontConfirmOpenFolder;
        confirmOpenFolder.addEventListener('change', function() {
            setSetting('dontConfirmOpenFolder', confirmOpenFolder.checked ? '' : '1');
        });
        
        const rememberPrevState = $('remember-prev-state');
        rememberPrevState.checked = !settings.dontRememberState;
        rememberPrevState.addEventListener('change', function() {
            setSetting('dontRememberState', rememberPrevState.checked ? '' : '1');
        });
        
        // Zoom
        const zoom = $('zoom-input');
        zoom.value = settings.zoom || 100;
        zoom.addEventListener('change', function() {
            const val = Utils.toInt(zoom.value);
            if (val == 100) {
                setSetting('zoom', null);
            } else {
                setSetting('zoom', val);
            }
        });
        
        // Popup Theme
        const themeSelect = $('theme-select');
        const customCssContainer = $('custom-css-container');
        const textareaUserstyle = $('userstyle');
        
        const currentTheme = settings.theme || 'light';
        const currentCustomCSS = settings.customCSS || '';
        
        themeSelect.value = currentTheme;
        textareaUserstyle.value = currentCustomCSS;
        
        if (currentTheme === 'custom') {
            customCssContainer.classList.add('show');
        }
        
        themeSelect.addEventListener('change', function() {
            const selectedTheme = themeSelect.value;
            setSetting('theme', selectedTheme);
            
            if (selectedTheme === 'custom') {
                customCssContainer.classList.add('show');
                setSetting('userstyle', textareaUserstyle.value, false);
            } else {
                customCssContainer.classList.remove('show');
                setSetting('userstyle', THEMES[selectedTheme], false);
            }
        });
        
        textareaUserstyle.addEventListener('input', function() {
            const css = textareaUserstyle.value;
            setSetting('customCSS', css, false);
            if (themeSelect.value === 'custom') {
                setSetting('userstyle', css);
            }
        });
        
        // Custom Icon
        const customIconPreview = $('custom-icon-preview').querySelector('img');
        const canvas = document.createElement('canvas');
        canvas.width = canvas.height = 19;
        const ctx = canvas.getContext('2d');
        let dontLoad = true;
        
        customIconPreview.onload = function() {
            if (dontLoad) {
                dontLoad = false;
                return;
            }
            ctx.clearRect(0, 0, 19, 19);
            ctx.drawImage(customIconPreview, 0, 0, 19, 19);
            const imageData = ctx.getImageData(0, 0, 19, 19);
            chrome.action.setIcon({ imageData: imageData });
            const dataObj = {};
            for (let i = 0; i < imageData.data.length; i++) {
                dataObj[i] = imageData.data[i];
            }
            setSetting('customIcon', dataObj);
        };

        customIconPreview.onerror = function() {
            // The placeholder image failing to load must still clear the guard,
            // otherwise the user's first uploaded icon is swallowed by the
            // initial-load skip above.
            dontLoad = false;
        };

        if (settings.customIcon) {
            const customIcon = settings.customIcon;
            const imageData = ctx.getImageData(0, 0, 19, 19);
            for (const key in customIcon) imageData.data[key] = customIcon[key];
            ctx.putImageData(imageData, 0, 0);
            customIconPreview.src = canvas.toDataURL();
        }
        
        const customIconFile = $('custom-icon-file');
        customIconFile.addEventListener('change', function() {
            const files = this.files;
            if (files && files.length) {
                const file = files[0];
                if (/image\/[a-z]+/i.test(file.type)) {
                    const reader = new FileReader();
                    reader.onload = function(e) {
                        customIconPreview.src = e.target.result;
                    };
                    reader.readAsDataURL(files[0]);
                } else {
                    alert('Not an image. Try another one.');
                }
            }
        });
        
        // Reset Button
        $('reset-button').addEventListener('click', function() {
            if (confirm(_m('resetText', [_m('extName')]) + '\n\nAre you sure?')) {
                chrome.storage.local.clear();
                chrome.action.setIcon({ path: 'icons/icon.png' });
                location.reload();
            }
        });
    }

    // =====================
    // Run
    // =====================
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => {
            init();
            setupListeners();
        });
    } else {
        init();
        setupListeners();
    }

    onerror = function(...args) {
        chrome.runtime.sendMessage({ error: args });
    };
})();
