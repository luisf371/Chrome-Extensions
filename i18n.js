document.addEventListener('DOMContentLoaded', function () {
	
	//translates tooptips of the 3 top buttons
    const setTooltip = (id, msg) => {
        const el = document.getElementById(id);
        if(el) el.title = chrome.i18n.getMessage(msg);
    };

	setTooltip('topbtn1', "html_topbtn_tooltip1");
	setTooltip('topbtn2', "html_topbtn_tooltip2");
    setTooltip('topbtn3', "html_topbtn_tooltip3");
	setTooltip('blogbtn', "opt_blogbtn_tooltip");
	
	// auto-translate all elements with i18n attributes
	const elements = document.querySelectorAll('[i18n]');
    for (const el of elements) {
        const label = el.getAttribute('i18n');
        if (label) {
            const msg = chrome.i18n.getMessage(label);
            if (msg) el.innerHTML = msg;
        }
    }
	
	if(window.navigator.vendor === "Opera Software ASA"){
        const el = document.getElementById('disableDClickLbl');
        if(el) el.textContent = chrome.i18n.getMessage("opt_func_opt6b");
    }

});
