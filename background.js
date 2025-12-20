// Service Worker for Neater Bookmarks

// Error reporting
const reportError = function(msg, url, line) {
    console.error('Neater Bookmarks Error:', msg, 'URL:', url, 'Line:', line);
};

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.error) {
        reportError(...request.error);
    }
});

// Omnibox
if (chrome.omnibox) {
    const setSuggest = (description) => {
        chrome.omnibox.setDefaultSuggestion({
            description: description
        });
    };

    let omniboxValue = null;
    let firstResult = null;

    const resetSuggest = () => {
        omniboxValue = null;
        firstResult = null;
        setSuggest('<url><match>*</match></url> ' + chrome.i18n.getMessage('searchBookmarks'));
    };
    resetSuggest();

    const xmlEncode = (text) => {
        return text.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/'/g, '&apos;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    };

    const matcher = (text, value) => {
        let matched = false;
        const exp = new RegExp(value.replace(/\s+/g, '|'), 'ig');
        const matchedText = text.replace(exp, (m) => {
            matched = true;
            return '<match>' + m + '</match>';
        });
        return {
            text: matchedText,
            matched: matched
        };
    };

    chrome.omnibox.onInputChanged.addListener(async (value, suggest) => {
        if (!value) {
            resetSuggest();
            return;
        }
        omniboxValue = value;
        try {
            let results = await chrome.bookmarks.search(value);
            if (!results.length) {
                resetSuggest();
                return;
            }
            const v = value.replace(/([-.*+?^${}()|[\]/\\])/g, '\\$1');
            const vPattern = new RegExp('^' + v.replace(/\s+/g, '.*'), 'ig');
            
            if (results.length > 1) {
                results.sort((a, b) => {
                    const aTitle = a.title;
                    const bTitle = b.title;
                    let aIndexTitle = aTitle.toLowerCase().indexOf(v.toLowerCase());
                    let bIndexTitle = bTitle.toLowerCase().indexOf(v.toLowerCase());
                    
                    if (aIndexTitle >= 0 || bIndexTitle >= 0) {
                        if (aIndexTitle < 0) aIndexTitle = Infinity;
                        if (bIndexTitle < 0) bIndexTitle = Infinity;
                        return aIndexTitle - bIndexTitle;
                    }
                    
                    const aTestTitle = vPattern.test(aTitle);
                    const bTestTitle = vPattern.test(bTitle);
                    if (aTestTitle && !bTestTitle) return -1;
                    if (!aTestTitle && bTestTitle) return 1;
                    return b.dateAdded - a.dateAdded;
                });
                results = results.slice(0, 6);
            }
            
            firstResult = results.shift();
            const firstTitle = matcher(xmlEncode(firstResult.title), v);
            let firstURL = { text: xmlEncode(firstResult.url) };
            if (!firstTitle.matched) firstURL = matcher(firstURL.text, v);
            setSuggest(firstTitle.text + ' <dim>-</dim> <url>' + firstURL.text + '</url>');

            const suggestions = [];
            for (const result of results) {
                const title = matcher(xmlEncode(result.title), v);
                const URL = result.url;
                let url = { text: xmlEncode(URL) };
                if (!title.matched) url = matcher(url.text, v);
                suggestions.push({
                    content: URL,
                    description: title.text + ' <dim>-</dim> <url>' + url.text + '</url>'
                });
            }
            suggest(suggestions);
        } catch (error) {
            reportError(error.message, 'background.js', 'onInputChanged');
        }
    });

    chrome.omnibox.onInputEntered.addListener((text) => {
        if (!text || !firstResult) {
            resetSuggest();
            return;
        }
        const url = (text == omniboxValue) ? firstResult.url : text;
        chrome.tabs.query({ active: true, currentWindow: true }).then((tabs) => {
            if (tabs && tabs.length > 0) {
                chrome.tabs.update(tabs[0].id, {
                    url: url,
                    active: true
                });
            }
        });
    });
}

// Restore custom icon from storage
chrome.storage.local.get('customIcon').then((result) => {
    if (result.customIcon) {
        const customIcon = result.customIcon;
        // Check if OffscreenCanvas is available (Service Worker)
        if (typeof OffscreenCanvas !== 'undefined') {
            const canvas = new OffscreenCanvas(19, 19);
            const ctx = canvas.getContext('2d');
            const imageData = ctx.createImageData(19, 19);
            
            for (const key in customIcon) {
                imageData.data[key] = customIcon[key];
            }
            ctx.putImageData(imageData, 0, 0); // Not strictly needed for setIcon with imageData, but good for completeness
            
            chrome.action.setIcon({ imageData: imageData });
        }
    }
});
