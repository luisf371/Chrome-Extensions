// Service Worker for sNeatBookmarks

// Error reporting
const reportError = function(msg, url, line) {
    console.error('sNeatBookmarks Error:', msg, 'URL:', url, 'Line:', line);
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

    // text and value are plain (not escaped); the returned text is XML-encoded
    const matcher = (text, value) => {
        let matched = false;
        const escaped = value.trim().replace(/([-.*+?^${}()|[\]/\\])/g, '\\$1');
        if (!escaped) return { text: xmlEncode(text), matched: false };
        const exp = new RegExp(escaped.replace(/\s+/g, '|'), 'ig');
        let result = '';
        let last = 0;
        text.replace(exp, (m, offset) => {
            matched = true;
            result += xmlEncode(text.slice(last, offset)) + '<match>' + xmlEncode(m) + '</match>';
            last = offset + m.length;
            return m;
        });
        result += xmlEncode(text.slice(last));
        return {
            text: result,
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
            // folders have no url, only suggest real bookmarks
            let results = (await chrome.bookmarks.search(value)).filter((r) => r.url);
            if (!results.length) {
                resetSuggest();
                return;
            }
            const v = value.toLowerCase();
            const escaped = value.replace(/([-.*+?^${}()|[\]/\\])/g, '\\$1');
            const vPattern = new RegExp('^' + escaped.replace(/\s+/g, '.*'), 'i');
            
            if (results.length > 1) {
                results.sort((a, b) => {
                    const aTitle = a.title;
                    const bTitle = b.title;
                    let aIndexTitle = aTitle.toLowerCase().indexOf(v);
                    let bIndexTitle = bTitle.toLowerCase().indexOf(v);
                    
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
            firstResult._query = value;
            const firstTitle = matcher(firstResult.title, value);
            let firstURL = { text: xmlEncode(firstResult.url) };
            if (!firstTitle.matched) firstURL = matcher(firstResult.url, value);
            setSuggest(firstTitle.text + ' <dim>-</dim> <url>' + firstURL.text + '</url>');

            const suggestions = [];
            for (const result of results) {
                const title = matcher(result.title, value);
                const URL = result.url;
                let url = { text: xmlEncode(URL) };
                if (!title.matched) url = matcher(URL, value);
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

    chrome.omnibox.onInputEntered.addListener((text, disposition) => {
        if (!text || !firstResult) {
            resetSuggest();
            return;
        }
        const url = (text == omniboxValue && firstResult._query === text) ? firstResult.url : text;
        if (disposition === 'newForegroundTab' || disposition === 'newBackgroundTab') {
            chrome.tabs.create({ url: url, active: disposition === 'newForegroundTab' }).catch((error) => {
                reportError(error.message, 'background.js', 'onInputEntered');
            });
            return;
        }
        chrome.tabs.query({ active: true, currentWindow: true }).then((tabs) => {
            if (tabs && tabs.length > 0) {
                return chrome.tabs.update(tabs[0].id, {
                    url: url,
                    active: true
                });
            }
        }).catch((error) => {
            reportError(error.message, 'background.js', 'onInputEntered');
        });
    });
}

// Restore custom icon from storage
const restoreIcon = () => chrome.storage.local.get('customIcon').then((result) => {
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
restoreIcon();
// The icon is not kept across browser restarts or updates, so set it again
chrome.runtime.onStartup.addListener(restoreIcon);
chrome.runtime.onInstalled.addListener(restoreIcon);
