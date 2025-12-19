// Service Worker for Neater Bookmarks

// Error reporting - replaced with console logging for V3 compliance (no DOM access)
const reportError = function(msg, url, line){
    console.error('Error reported:', msg, 'URL:', url, 'Line:', line);
    // V3: You could use fetch() here if you have a valid endpoint
};

chrome.runtime.onMessage.addListener(function(request, sender, sendResponse){
	if (request.error) reportError.apply(null, request.error);
});

if (chrome.omnibox){
	const setSuggest = function(description){
		chrome.omnibox.setDefaultSuggestion({
			description: description
		});
	};
	
	let omniboxValue = null;
	let firstResult = null;
	const resetSuggest = function(){
		omniboxValue = null;
		firstResult = null;
		setSuggest('<url><match>*</match></url> ' + chrome.i18n.getMessage('searchBookmarks'));
		
	};
	resetSuggest();

	const xmlEncode = function (text){
		return text.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/\'/g, '&apos;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
	}

	const matcher = function(text, value){
		let matched = false;
		const exp = new RegExp(value.replace(/\s+/g, '|'), 'ig');
		const matchedText = text.replace(exp, function(m){
			matched = true;
			return '<match>' + m + '</match>';
		});
		return {
			text: matchedText,
			matched: matched
		};
	};

	chrome.omnibox.onInputChanged.addListener(function(value, suggest){
		if (!value){
			resetSuggest();
			return;
		}
		omniboxValue = value;
		chrome.bookmarks.search(value, function(results){
			if (!results.length){
				resetSuggest();
				return;
			}
			const v = value.replace(/([-.*+?^${}()|[\/\\])/g, '\\$1');
			const vPattern = new RegExp('^' + v.replace(/\s+/g, '.*'), 'ig');
			if (results.length > 1){
				results.sort(function(a, b){
					const aTitle = a.title;
					const bTitle = b.title;
					let aIndexTitle = aTitle.toLowerCase().indexOf(v);
					let bIndexTitle = bTitle.toLowerCase().indexOf(v);
					if (aIndexTitle >= 0 || bIndexTitle >= 0){
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
			let firstURL = {text: xmlEncode(firstResult.url)};
			if (!firstTitle.matched) firstURL = matcher(firstURL.text, v);
			setSuggest(firstTitle.text + ' <dim>-</dim> <url>' + firstURL.text + '</url>');
			
            const suggestions = [];
			for (let i=0, l=results.length; i<l; i++){
				const result = results[i];
				const title = matcher(xmlEncode(result.title), v);
				const URL = result.url;
				let url = {text: xmlEncode(URL)};
				if (!title.matched) url = matcher(url.text, v);
				suggestions.push({
					content: URL,
					description: title.text + ' <dim>-</dim> <url>' + url.text + '</url>'
				});
			}
			suggest(suggestions);
			// Cleanup not strictly necessary in modern JS engines, but good practice
            // suggestions = null;
			// results = null;
			// vPattern = null;
		});
	});

	chrome.omnibox.onInputEntered.addListener(function(text){
		if (!text || !firstResult){
			resetSuggest();
			return;
		}
		const url = (text == omniboxValue) ? firstResult.url : text;
		chrome.tabs.query({active: true, currentWindow: true}, function(tabs){
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
chrome.storage.local.get('customIcon', function(result){
    if (result.customIcon){
        const customIcon = result.customIcon; // Assuming it's the raw pixel data array
        
        // Use OffscreenCanvas to create ImageData
        const canvas = new OffscreenCanvas(19, 19);
        const ctx = canvas.getContext('2d');
        const imageData = ctx.createImageData(19, 19);
        
        for (const key in customIcon) {
            imageData.data[key] = customIcon[key];
        }
        
        chrome.action.setIcon({imageData: imageData});
    }
});