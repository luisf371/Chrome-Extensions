function linkSwitcher(link) {
	const extIDc = "emhohdghchmjepmigjojkehidlielknj";
	const extIDo = "simpleundoclose";
	
	const chr = "https://chrome.google.com/webstore/detail/"+extIDo+"/"+extIDc+"/support";
	const opr = "https://addons.opera.com/";
	let locale = window.navigator.language;
	const vendor = navigator.userAgent;
	
	if (vendor.indexOf("OPR") === -1) {
		link.href = chr + "?hl=" + locale;
	}
	if (vendor.indexOf("OPR") > -1) {
		if (locale.substr(0, 2) === "en")
			locale = "en";
		link.href = opr + locale.toLowerCase() + "/extensions/details/" + extIDo +"/?display="+ locale.toLowerCase() +"&reports#feedback-container";
	}
}

document.addEventListener('DOMContentLoaded', function () {
	const el = document.getElementById('feedbkLnk');
    if (el) {
        el.textContent = chrome.i18n.getMessage("feed_text2");
	    linkSwitcher(el);
    }
});
