(function () {
  'use strict';

  const app = globalThis.__SYP_CONTENT__ = globalThis.__SYP_CONTENT__ || {};
  if (app.state) return;

  app.constants = {
    UNCATEGORIZED_ID: '__uncategorized',
    FILTER_MODE_ALL: 'all',
    FILTER_MODE_INCLUDE: 'include',
    FILTER_MODE_EXCLUDE: 'exclude',
    FILTER_MODE_UNCATEGORIZED: 'uncategorized',
    SUBSCRIPTIONS_FILTER_PREFERENCE_KEY: 'subscriptionsFilterPreference',
    NAV_EVENT_SOURCE: 'syp-page-bridge',
    HOME_NAV_INTENT_EVENT: 'SYP_HOME_NAV_INTENT',
    HOME_REDIRECT_BYPASS_SESSION_KEY: 'syp-manual-home-nav',
    HOME_REDIRECT_BYPASS_TTL_MS: 3000,
    SUBSCRIPTIONS_FEED_PATH: '/feed/subscriptions',
    MAX_MESSAGE_RETRIES: 2,
    MESSAGE_RETRY_DELAY_MS: 200,
    RETRYABLE_MESSAGE_TYPES: new Set([
      'GET_ALL_DATA',
      'REGISTER_CHANNEL',
      'ASSIGN_CHANNEL_PLAYLIST',
      'UPDATE_SETTINGS',
      'OPEN_OPTIONS',
      'DELETE_PLAYLIST',
      'UPDATE_PLAYLIST',
      'REORDER_PLAYLISTS'
    ])
  };

  app.state = {
    currentPage: null,
    lastUrl: '',
    pollInterval: null,
    feedObserver: null,
    feedObserverDebounceTimer: null,
    subscriptionsFilterRetryTimer: null,
    quickAddObserver: null,
    quickAddObserverDebounceTimer: null,
    channelsListObserver: null,
    channelsListDebounceTimer: null,
    data: null,
    initSucceeded: false,
    initInProgress: false,
    initGeneration: 0,
    navDebounceTimer: null,
    quickAddRefreshTimer: null,
    pageToastHost: null,
    pageToastShadow: null,
    pageToastTimer: null,
    quickAddCloseState: { handler: null, timer: null },
    channelListCloseState: { handler: null, timer: null },
    filterMenuCloseState: { handler: null, timer: null },
    playlistChannels: new Map(),
    allAssignedHandles: new Set(),
    subscriptionsFilterMode: 'all',
    subscriptionsIncludePlaylistId: null,
    subduedPlaylistIds: new Set(),
    filterMenuOpen: false,
    filterHost: null,
    filterShadow: null,
    activeChannelListDropdown: null,
    quickAddHost: null,
    quickAddShadow: null,
    quickAddOpen: false,
    quickAddHandle: null,
    manualHomeNavigationUntil: 0
  };

  app.api = app.api || {};
  app.pages = app.pages || {};
})();
