import { getStorage } from './common.js';

document.addEventListener('DOMContentLoaded', async function () {
	let data = await getStorage(['settings']);
	let settings = data.settings;
	if (!settings) return;

	// Remove any existing theme classes
	document.body.classList.remove('theme-light', 'theme-dark');

	// Apply theme based on settings
	if(settings.theme === "light"){
		// Light mode
		document.body.classList.add('theme-light');
	}

	if(settings.theme === "dark"){
		// Dark mode
		document.body.classList.add('theme-dark');
	}

	// Otherwise (e.g. "system"), let CSS @media handle it
});
