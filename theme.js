document.addEventListener('DOMContentLoaded', async function () {
	let data = await getStorage(['settings']);
	let settings = data.settings;
	if (!settings) return;

	var linkTag = document.getElementById('dark');
	if (!linkTag) return;
	
	if(settings.theme=="2"){
		linkTag.removeAttribute("href");
	}
	
	if(settings.theme=="3"){
		linkTag.removeAttribute("media");
	}
});
