(async function() {
    const settings = await chrome.storage.local.get(null);
    const setSetting = (key, value) => {
        if (value === null || value === undefined) {
            delete settings[key];
            chrome.storage.local.remove([key]);
        } else {
            settings[key] = value;
            chrome.storage.local.set({ [key]: value });
        }
    };

    const init = () => {
        // i18n of text strings
        $('extName').innerHTML = chrome.i18n.getMessage('extName');
        $('version').innerHTML = chrome.runtime.getManifest().version;
        $('options').innerHTML = chrome.i18n.getMessage('options');
        $('general').innerHTML = chrome.i18n.getMessage('general');
        $('optionClickNewTab').innerHTML = chrome.i18n.getMessage('optionClickNewTab');
        $('optionOpenNewTab').innerHTML = chrome.i18n.getMessage('optionOpenNewTab');
        $('optionCloseUnusedFolders').innerHTML = chrome.i18n.getMessage('optionCloseUnusedFolders');
        $('optionPopupStays').innerHTML = chrome.i18n.getMessage('optionPopupStays');
        $('optionConfirmOpenFolder').innerHTML = chrome.i18n.getMessage('optionConfirmOpenFolder');
        $('optionRememberPrevState').innerHTML = chrome.i18n.getMessage('optionRememberPrevState');
        $('accessibility').innerHTML = chrome.i18n.getMessage('accessibility');
        $('optionZoom').innerHTML = chrome.i18n.getMessage('optionZoom');
        $('customIcon').innerHTML = chrome.i18n.getMessage('customIcon');
        $('customIconText').innerHTML = chrome.i18n.getMessage('customIconText');
        $('resetSettings').innerHTML = chrome.i18n.getMessage('resetSettings');
        const extName = chrome.i18n.getMessage('extName');
        const version = chrome.i18n.getMessage('version');
        $('resetText').innerHTML = chrome.i18n.getMessage('resetText', [extName]);
        $('reset').innerHTML = chrome.i18n.getMessage('reset');
        $('customStyles').innerHTML = chrome.i18n.getMessage('customStyles');
        $('customStylesDesc').innerHTML = chrome.i18n.getMessage('customStylesDesc');

        const CSS_TEMPLATE = `/* Baseline Theme Template - Copy & Paste below */
body {
    background-color: #ffffff; /* Main Background */
    color: #000000;            /* Main Text */
}

/* Search Bar */
#search {
    background-color: #f2f2f2;
    border-bottom: 1px solid #cccccc;
}
#search-input {
    background-color: #ffffff;
    color: #000000;
    border: 1px solid #cccccc;
}

/* Bookmarks & Folders */
li.parent > span { color: #000000; } /* Folder Name */
li.child > a     { color: #000000; } /* Bookmark Name */

/* Hover Effects */
li.parent > span:hover,
li.child > a:hover {
    background-color: #e6e6e6; /* Highlight Background */
    color: #000000;            /* Highlight Text */
}`;
        $('css-template').textContent = CSS_TEMPLATE;
        
        const neaterEmail = '<a href="mailto:neaterbookmarks@gmail.com?body=%0d%0dSent from Neater Bookmarks Options page">neaterbookmarks@gmail.com</a>';
        $('optionsFooterText1').innerHTML = chrome.i18n.getMessage('optionsFooterText1', [neaterEmail]);
        const neaterGithub = 'GitHub: <a href="https://github.com/cheeaun/neat-bookmarks">https://github.com/cheeaun/neat-bookmarks</a>';
        $('optionsFooterText2').innerHTML = chrome.i18n.getMessage('optionsFooterText2', [extName, neaterGithub]);
        const neaterFaq = '';
        $('optionsFooterText3').innerHTML = ''; // FAQ link was broken
        const neaterIssues = '<a href="https://github.com/cheeaun/neat-bookmarks/issues">https://github.com/cheeaun/neat-bookmarks/issues</a>';
        $('optionsFooterText4').innerHTML = chrome.i18n.getMessage('optionsFooterText4', [neaterIssues]);
        const neaterIcons = '';
        $('optionsFooterText5').innerHTML = ''; // Icons link broken
        const neaterTranslate = '';
        $('optionsFooterText6').innerHTML = ''; // Translation link broken
        const neatGithub = '<a href="http://github.com/cheeaun/neat-bookmarks">Neat Bookmarks</a>';
        const linkCheeAun = '<a href="http://twitter.com/cheeaun">Lim Chee Aun</a>';
        $('optionsFooterText7').innerHTML = chrome.i18n.getMessage('optionsFooterText7', [neatGithub, linkCheeAun]);
    };

    const setupListeners = () => {
        const THEMES = {
            light: '',
            'light-modern': `/* Light (Modern) Theme */
body {
    background-color: #ffffff !important;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif !important;
    color: #333333 !important;
}

/* Search Bar - Floating Style */
#search {
    background-color: #ffffff !important;
    border-bottom: 1px solid #f0f0f0 !important;
    padding: 8px !important;
    box-shadow: 0 2px 10px rgba(0,0,0,0.03);
}

#search-input {
    background-color: #f5f5f7 !important;
    color: #1d1d1f !important;
    border: 1px solid transparent !important;
    border-radius: 6px !important;
    padding: 6px 10px !important;
    transition: all 0.2s ease;
}

#search-input:focus {
    background-color: #ffffff !important;
    border-color: #007aff !important;
    box-shadow: 0 0 0 3px rgba(0,122,255,0.1) !important;
}

/* Tree & Results */
#tree, #results {
    background-color: #ffffff !important;
    color: #333333 !important;
    text-shadow: none !important;
}

/* List Items */
li {
    padding: 0 !important;
}

li.parent > span, li.child > a {
    color: #333333 !important;
    text-shadow: none !important;
    border-radius: 4px;
    margin: 0 2px !important;
    transition: background-color 0.1s ease;
}

/* Hover Effects */
li.parent > span:hover, li.child > a:hover {
    background-color: #f2f2f7 !important;
    color: #000000 !important;
    text-shadow: none !important;
}

/* Focused Item */
.focus {
    background-color: #e5f1fb !important;
    color: #007aff !important;
}

/* Folder Icons & Text */
li.parent > span i {
    font-weight: 600 !important;
    color: #444 !important;
}

/* Twisties (Arrows) */
#tree ul li span .twisty {
    border-color: transparent transparent transparent #8e8e93 !important;
    opacity: 0.7;
}

/* Scrollbar */
::-webkit-scrollbar {
    width: 8px;
    background-color: transparent;
}
::-webkit-scrollbar-thumb {
    background-color: #d1d1d6;
    border-radius: 4px;
}
::-webkit-scrollbar-thumb:hover {
    background-color: #b0b0b5;
}`,
            dark: `/* Dark Mode */
body {
    background-color: #2b2b2b !important;
    color: #cccccc !important;
}
#search {
    background-color: #333333 !important;
    border-bottom: 1px solid #444444 !important;
}
#search-input {
    background-color: #444444 !important;
    color: #ffffff !important;
    border: 1px solid #555555 !important;
}
#tree, #results {
    background-color: #2b2b2b !important;
    color: #cccccc !important;
    text-shadow: none !important;
}
li.parent > span, li.child > a {
    color: #cccccc !important;
    text-shadow: none !important;
}
li.parent > span:hover, li.child > a:hover {
    background-color: #444444 !important;
    color: #ffffff !important;
    text-shadow: none !important;
}
#tree ul li span .twisty {
    border-color: transparent transparent transparent #888888 !important;
}
/* Context Menu */
.context-menu {
    background-color: #333333 !important;
    border: 1px solid #444444 !important;
    box-shadow: 0 2px 10px rgba(0,0,0,0.5) !important;
}
.context-menu .command {
    color: #cccccc !important;
    text-shadow: none !important;
}
.context-menu .command:hover, .context-menu .command:focus {
    background-color: #444444 !important;
    color: #ffffff !important;
    background-image: none !important;
    box-shadow: none !important;
}
.context-menu hr {
    background-color: #444444 !important;
}
.dialog {
    background-color: #2b2b2b !important;
    color: #cccccc !important;
    border-bottom: 1px solid #444444 !important;
    box-shadow: 0 0 100px rgba(0,0,0,0.5) !important;
}
.dialog-text {
    color: #cccccc !important;
}
.dialog input {
    background-color: #333333 !important;
    color: #ffffff !important;
    border: 1px solid #444444 !important;
}
.dialog button {
    background-color: #444444 !important;
    color: #ffffff !important;
    border: 1px solid #555555 !important;
}
.dialog button:hover {
    background-color: #555555 !important;
}
#confirm-dialog-button-1, #edit-dialog-button {
    background-color: #4687cb !important;
    background-image: linear-gradient(to bottom, #6fa6de, #1e6cbb) !important;
    border-color: #1e6cbb !important;
}
::-webkit-scrollbar {
    width: 10px;
    background-color: #2b2b2b;
}
::-webkit-scrollbar-thumb {
    background-color: #555555;
}
`,
            neon: `/* Neon Night - High Contrast Version */
body {
    background-color: #0f172a !important; 
    font-family: 'Segoe UI', sans-serif !important;
}

/* Force ALL text to be Cyan by default and remove shadows */
#tree, #results, a, span, i, li {
    color: #38bdf8 !important; /* Bright Cyan */
    text-shadow: none !important;
}

/* Folders: Bright Magenta */
li.parent > span, 
li.parent > span i {
    color: #f472b6 !important; 
    font-weight: bold !important;
}

/* Hover: White text on a lighter slate background */
li.child > a:hover, 
li.parent > span:hover,
li.child > a:hover i {
    background-color: #334155 !important;
    color: #ffffff !important;
}

/* Search Area */
#search {
    background-color: #1e293b !important;
    border-bottom: 2px solid #38bdf8 !important;
}

#search-input {
    background-color: #0f172a !important;
    color: #ffffff !important;
    border: 1px solid #38bdf8 !important;
}

/* Tree Twisty (the arrow) - make it light so it's visible */
#tree ul li span .twisty {
    border-color: transparent transparent transparent #94a3b8 !important;
}

/* Focused/Active items */
#tree ul li a:focus, 
#tree ul li span:focus {
    background-color: #38bdf8 !important;
    color: #0f172a !important;
}
`,
            vintage: `/* Vintage Parchment Theme */
body {
    background-color: #f5f5dc !important; /* Cream/Beige */
    font-family: 'Georgia', 'Times New Roman', serif !important; /* Serif font for "Book" feel */
}

/* Base Text - Dark Coffee Brown & No Shadows */
#tree, #results, a, span, i, li {
    color: #3e2723 !important; 
    text-shadow: none !important;
}

/* Search Area - Darker paper tone */
#search {
    background-color: #e8e0c5 !important;
    border-bottom: 2px solid #8d6e63 !important;
    padding: 8px !important;
}

#search-input {
    background-color: #fffbf0 !important;
    color: #3e2723 !important;
    border: 1px solid #8d6e63 !important;
    border-radius: 0 !important; /* Sharp corners */
    font-family: 'Georgia', serif !important;
    font-style: italic !important;
}

/* Folders - Dark Red "Chapter Headers" */
li.parent > span {
    color: #8b0000 !important; /* Deep Maroon */
    font-weight: bold !important;
    font-variant: small-caps !important; /* "Small Caps" style */
    letter-spacing: 0.5px !important;
}

/* Hover Effect - Light Brown "Highlighter" */
li.child > a:hover, 
li.parent > span:hover {
    background-color: #d7ccc8 !important;
    color: #000 !important;
}

/* Twisties (Arrows) - Make them dark brown */
#tree ul li span .twisty {
    border-color: transparent transparent transparent #5d4037 !important;
}

/* Icons - Sepia Filter to make favicons look vintage */
img {
    filter: sepia(100%) contrast(1.2) !important;
    opacity: 0.9 !important;
}

/* Scrollbar (Chrome Webkit) - Matching Brown */
::-webkit-scrollbar {
    width: 8px;
}
::-webkit-scrollbar-thumb {
    background: #a1887f !important;
}
`
        };

        document.title = _m('extName') + ' ' + _m('options');
        
        const clickNewTab = $('click-new-tab');
        const popupStayOpen = $('popup-stay-open');
        
        const togglePopupStayOpen = () => {
            const label = $('optionPopupStays');
            if (clickNewTab.checked) {
                popupStayOpen.disabled = true;
                label.style.opacity = '0.5';
            } else {
                popupStayOpen.disabled = false;
                label.style.opacity = '1';
            }
        };

        clickNewTab.checked = !!settings.leftClickNewTab;
        clickNewTab.addEventListener('change', function(){
            setSetting('leftClickNewTab', clickNewTab.checked ? '1' : '');
            togglePopupStayOpen();
        });
        
        const openNewTabBg = $('open-new-tab-bg');
        openNewTabBg.checked = !!settings.middleClickBgTab;
        openNewTabBg.addEventListener('change', function(){
            setSetting('middleClickBgTab', openNewTabBg.checked ? '1' : '');
        });
        
        const closeUnusedFolders = $('close-unused-folders');
        closeUnusedFolders.checked = !!settings.closeUnusedFolders;
        closeUnusedFolders.addEventListener('change', function(){
            setSetting('closeUnusedFolders', closeUnusedFolders.checked ? '1' : '');
        });
        
        popupStayOpen.checked = !!settings.bookmarkClickStayOpen;
        popupStayOpen.addEventListener('change', function(){
            setSetting('bookmarkClickStayOpen', popupStayOpen.checked ? '1' : '');
        });
        
        togglePopupStayOpen();
        
        const confirmOpenFolder = $('confirm-open-folder');
        confirmOpenFolder.checked = !settings.dontConfirmOpenFolder;
        confirmOpenFolder.addEventListener('change', function(){
            setSetting('dontConfirmOpenFolder', confirmOpenFolder.checked ? '' : '1');
        });
        
        const rememberPrevState = $('remember-prev-state');
        rememberPrevState.checked = !settings.dontRememberState;
        rememberPrevState.addEventListener('change', function(){
            setSetting('dontRememberState', rememberPrevState.checked ? '' : '1');
        });
        
        const zoom = $('zoom-input');
        const zoomInterval = setInterval(function(){
            zoom.value = settings.zoom || 100;
        }, 1000);
        window.addEventListener('beforeunload', () => clearInterval(zoomInterval));
        zoom.addEventListener('input', function(){
            const val = Utils.toInt(zoom.value);
            if (val == 100){
                setSetting('zoom', null);
            } else {
                setSetting('zoom', val);
            }
        });
        
        const customIconPreview = $('custom-icon-preview').firstElementChild;
        const canvas = document.createElement('canvas');
        canvas.width = canvas.height = 19;
        const ctx = canvas.getContext('2d');
        let dontLoad = true;
        customIconPreview.onload = function(){
            if (dontLoad){
                dontLoad = false;
                return;
            }
            ctx.clearRect(0, 0, 19, 19);
            ctx.drawImage(customIconPreview, 0, 0, 19, 19);
            const imageData = ctx.getImageData(0, 0, 19, 19);
            chrome.action.setIcon({imageData: imageData});
            // Convert Uint8ClampedArray to a standard object/array for storage
            const dataObj = {};
            for (let i = 0; i < imageData.data.length; i++) {
                dataObj[i] = imageData.data[i];
            }
            setSetting('customIcon', dataObj);
        };
        
        // Custom icon logic unified
        if (settings.customIcon){
            const customIcon = settings.customIcon;
            const imageData = ctx.getImageData(0, 0, 19, 19);
            for (const key in customIcon) imageData.data[key] = customIcon[key];
            ctx.putImageData(imageData, 0, 0);
            customIconPreview.src = canvas.toDataURL();
        }
        
        const customIconFile = $('custom-icon-file');
        customIconFile.addEventListener('change', function(){
            const files = this.files;
            if (files && files.length){
                const file = files[0];
                if (/image\/[a-z]+/i.test(file.type)){
                    const reader = new FileReader();
                    reader.onload = function(e){
                        const result = e.target.result;
                        customIconPreview.src = result;
                    };
                    reader.readAsDataURL(files[0]);
                } else {
                    alert('Not an image. Try another one.');
                }
            }
        });
        
        $('reset-button').addEventListener('click', function(){
            chrome.storage.local.clear();
            chrome.action.setIcon({path: 'icon.png'});
            customIconPreview.src = 'icon.png';
            dontLoad = true;
            location.reload();
            alert(_m('extName') + ' has been reset.');
        }, false);
        
        // Theme and Custom CSS Logic
        const themeSelect = $('theme-select');
        const customCssContainer = $('custom-css-container');
        const textareaUserstyle = $('userstyle');

        // Initial State
        const currentTheme = settings.theme || 'light';
        const currentCustomCSS = settings.customCSS || '';
        
        themeSelect.value = currentTheme;
        textareaUserstyle.value = currentCustomCSS;
        
        if (currentTheme === 'custom') {
            customCssContainer.style.display = 'block';
        } else {
            customCssContainer.style.display = 'none';
        }

        themeSelect.addEventListener('change', function() {
            const selectedTheme = themeSelect.value;
            setSetting('theme', selectedTheme);

            if (selectedTheme === 'custom') {
                customCssContainer.style.display = 'block';
                setSetting('userstyle', textareaUserstyle.value);
            } else {
                customCssContainer.style.display = 'none';
                setSetting('userstyle', THEMES[selectedTheme]);
            }
        });

        textareaUserstyle.addEventListener('input', function() {
            const css = textareaUserstyle.value;
            setSetting('customCSS', css);
            if (themeSelect.value === 'custom') {
                setSetting('userstyle', css);
            }
        });
    };

    const _m = chrome.i18n.getMessage;

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => {
            init();
            setupListeners();
        });
    } else {
        init();
        setupListeners();
    }

    onerror = function(...args){
        chrome.runtime.sendMessage({error: args});
    };
})();