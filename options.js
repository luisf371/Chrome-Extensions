(async function() {
    const settings = await chrome.storage.local.get(null);
    const setSetting = (key, value) => {
        if (value === null || value === undefined) {
            delete settings[key];
            chrome.storage.local.remove(key);
        } else {
            settings[key] = value;
            chrome.storage.local.set({ [key]: value });
        }
    };

    window.addEventListener('load', init, false);

    function init() {
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
        const linkGithubGist = '<a href="http://gist.github.com/">GitHub Gist</a>';
        $('customStylesText').innerHTML = chrome.i18n.getMessage('customStylesText', [linkGithubGist]);
        const neaterEmail = '<a href="mailto:neaterbookmarks@gmail.com?body=%0d%0dSent from Neater Bookmarks Options page">neaterbookmarks@gmail.com</a>';
        $('optionsFooterText1').innerHTML = chrome.i18n.getMessage('optionsFooterText1', [neaterEmail]);
        const neaterGithub = 'GitHub: <a href="http://goo.gl/s2kVi">http://goo.gl/s2kVi</a>';
        $('optionsFooterText2').innerHTML = chrome.i18n.getMessage('optionsFooterText2', [extName, neaterGithub]);
        const neaterFaq = '<a href="http://goo.gl/DDMqE">http://goo.gl/DDMqE</a>';
        $('optionsFooterText3').innerHTML = chrome.i18n.getMessage('optionsFooterText3', [neaterFaq]);
        const neaterIssues = '<a href="http://goo.gl/Ct39y">http://goo.gl/Ct39y</a>';
        $('optionsFooterText4').innerHTML = chrome.i18n.getMessage('optionsFooterText4', [neaterIssues]);
        const neaterIcons = '<a href="http://goo.gl/0xQNp">http://goo.gl/0xQNp</a>';
        $('optionsFooterText5').innerHTML = chrome.i18n.getMessage('optionsFooterText5', [neaterIcons]);
        const neaterTranslate = 'WebTranslateIt: <a href="http://goo.gl/oDXMm">http://goo.gl/oDXMm</a>';
        $('optionsFooterText6').innerHTML = chrome.i18n.getMessage('optionsFooterText6', [extName, neaterTranslate]);
        const neatGithub = '<a href="http://github.com/cheeaun/neat-bookmarks">Neat Bookmarks</a>';
        const linkCheeAun = '<a href="http://twitter.com/cheeaun">Lim Chee Aun</a>';
        $('optionsFooterText7').innerHTML = chrome.i18n.getMessage('optionsFooterText7', [neatGithub, linkCheeAun]);
    };

    const _m = chrome.i18n.getMessage;

    document.addEventListener('DOMContentLoaded', function(){
        document.title = _m('extName') + ' ' + _m('options');
        
        const clickNewTab = $('click-new-tab');
        clickNewTab.checked = !!settings.leftClickNewTab;
        clickNewTab.addEventListener('change', function(){
            setSetting('leftClickNewTab', clickNewTab.checked ? '1' : '');
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
        
        const popupStayOpen = $('popup-stay-open');
        popupStayOpen.checked = !!settings.bookmarkClickStayOpen;
        popupStayOpen.addEventListener('change', function(){
            setSetting('bookmarkClickStayOpen', popupStayOpen.checked ? '1' : '');
        });
        
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
        setInterval(function(){
            zoom.value = settings.zoom || 100;
        }, 1000);
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
        
        const textareaUserstyle = $('userstyle');
        if (settings.userstyle) textareaUserstyle.value = settings.userstyle;
        
        // CodeMirror might not be loaded or accessible? Assumed global.
        if (window.CodeMirror) {
            CodeMirror.fromTextArea(textareaUserstyle, {
                onChange: function(c){
                    setSetting('userstyle', c.getValue());
                }
            });
        } else {
            // Fallback if CodeMirror fails or is removed
            textareaUserstyle.addEventListener('input', function() {
                setSetting('userstyle', textareaUserstyle.value);
            });
        }
    });

    onerror = function(){
        chrome.runtime.sendMessage({error: [].slice.call(arguments)})
    };
})();
