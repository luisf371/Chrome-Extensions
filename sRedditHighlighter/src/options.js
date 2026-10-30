(async function() {
  'use strict';

  const DEFAULT_SETTINGS = {
    maxHistory: 10000,
    highlightColor: '#FFFDCC',
    darkModeColor: '#3d3d00',
    useSystemTheme: false,
    useDarkTheme: false,
    autoChangeTheme: false,
    themeStartTime: '18:00',
    themeEndTime: '08:00',
  };

  const elements = {
    highlightColor: document.getElementById('highlightColor'),
    highlightColorText: document.getElementById('highlightColorText'),
    darkModeColor: document.getElementById('darkModeColor'),
    darkModeColorText: document.getElementById('darkModeColorText'),
    useSystemTheme: document.getElementById('useSystemTheme'),
    useDarkTheme: document.getElementById('useDarkTheme'),
    autoChangeTheme: document.getElementById('autoChangeTheme'),
    themeStartTime: document.getElementById('themeStartTime'),
    themeEndTime: document.getElementById('themeEndTime'),
    maxHistory: document.getElementById('maxHistory'),
    manualThemeGroup: document.getElementById('manualThemeGroup'),
    timeRangeGroup: document.getElementById('timeRangeGroup'),
    clearHistory: document.getElementById('clearHistory'),
    save: document.getElementById('save'),
    status: document.getElementById('status'),
  };

  function syncColorInputs(colorPicker, textInput) {
    colorPicker.addEventListener('input', () => {
      textInput.value = colorPicker.value.toUpperCase();
    });
    
    textInput.addEventListener('input', () => {
      const value = textInput.value;
      if (/^#[0-9A-Fa-f]{6}$/.test(value)) {
        colorPicker.value = value;
      }
    });
  }

  function updateUIState() {
    const useSystem = elements.useSystemTheme.checked;
    const autoChange = elements.autoChangeTheme.checked;
    
    elements.manualThemeGroup.classList.toggle('disabled', useSystem || autoChange);
    elements.useDarkTheme.disabled = useSystem || autoChange;
    
    elements.timeRangeGroup.classList.toggle('hidden', !autoChange);
    elements.themeStartTime.disabled = !autoChange;
    elements.themeEndTime.disabled = !autoChange;
  }

  function showStatus(message, duration = 2000) {
    elements.status.textContent = message;
    elements.status.classList.add('visible');
    setTimeout(() => elements.status.classList.remove('visible'), duration);
  }

  async function loadSettings() {
    const { settings = DEFAULT_SETTINGS } = await chrome.storage.local.get('settings');
    const merged = { ...DEFAULT_SETTINGS, ...settings };
    
    elements.highlightColor.value = merged.highlightColor;
    elements.highlightColorText.value = merged.highlightColor.toUpperCase();
    elements.darkModeColor.value = merged.darkModeColor;
    elements.darkModeColorText.value = merged.darkModeColor.toUpperCase();
    elements.useSystemTheme.checked = merged.useSystemTheme;
    elements.useDarkTheme.checked = merged.useDarkTheme;
    elements.autoChangeTheme.checked = merged.autoChangeTheme;
    if (merged.autoChangeTheme) elements.useSystemTheme.checked = false;
    elements.themeStartTime.value = merged.themeStartTime;
    elements.themeEndTime.value = merged.themeEndTime;
    elements.maxHistory.value = merged.maxHistory;
    
    updateUIState();
  }

  // Accepts #RRGGBB, RRGGBB, #RGB and RGB; returns '#RRGGBB' or null.
  function normalizeHex(value) {
    const match = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec((value || '').trim());
    if (!match) return null;
    let hex = match[1];
    if (hex.length === 3) hex = hex.split('').map(c => c + c).join('');
    return '#' + hex.toLowerCase();
  }

  function clampMaxHistory(value) {
    const parsed = parseInt(value, 10);
    if (!Number.isFinite(parsed)) return DEFAULT_SETTINGS.maxHistory;
    return Math.min(50000, Math.max(100, parsed));
  }

  async function saveSettings() {
    // The text boxes are what the user sees, so read them (the pickers only
    // follow exact #RRGGBB input).
    const highlightColor = normalizeHex(elements.highlightColorText.value);
    const darkModeColor = normalizeHex(elements.darkModeColorText.value);
    if (!highlightColor || !darkModeColor) {
      showStatus('Enter colors as #RRGGBB, for example #FFFDCC.', 3500);
      return;
    }

    const maxHistory = clampMaxHistory(elements.maxHistory.value);
    const themeStartTime = elements.themeStartTime.value || DEFAULT_SETTINGS.themeStartTime;
    const themeEndTime = elements.themeEndTime.value || DEFAULT_SETTINGS.themeEndTime;

    // Show what is actually stored.
    elements.highlightColor.value = highlightColor;
    elements.highlightColorText.value = highlightColor.toUpperCase();
    elements.darkModeColor.value = darkModeColor;
    elements.darkModeColorText.value = darkModeColor.toUpperCase();
    elements.maxHistory.value = maxHistory;
    elements.themeStartTime.value = themeStartTime;
    elements.themeEndTime.value = themeEndTime;

    const settings = {
      highlightColor,
      darkModeColor,
      useSystemTheme: elements.useSystemTheme.checked,
      useDarkTheme: elements.useDarkTheme.checked,
      autoChangeTheme: elements.autoChangeTheme.checked,
      themeStartTime,
      themeEndTime,
      maxHistory,
    };
    
    await chrome.storage.local.set({ settings });
    showStatus('Settings saved!');
  }

  async function clearHistory() {
    if (!confirm('This will clear all remembered threads. You will see all comments as new on your next visit. Continue?')) {
      return;
    }
    
    await chrome.storage.local.set({ threads: {} });
    showStatus('History cleared!');
  }

  syncColorInputs(elements.highlightColor, elements.highlightColorText);
  syncColorInputs(elements.darkModeColor, elements.darkModeColorText);
  
  // Auto-switch by time takes priority over the system theme, so only one of
  // the two can be on.
  elements.useSystemTheme.addEventListener('change', () => {
    if (elements.useSystemTheme.checked) elements.autoChangeTheme.checked = false;
    updateUIState();
  });
  elements.autoChangeTheme.addEventListener('change', () => {
    if (elements.autoChangeTheme.checked) elements.useSystemTheme.checked = false;
    updateUIState();
  });
  elements.save.addEventListener('click', saveSettings);
  elements.clearHistory.addEventListener('click', clearHistory);
  
  await loadSettings();
})();
