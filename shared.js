// Constants shared by the popup and the content scripts, so the setting names and
// defaults live in exactly one place. Loaded before popup-ui.js, content.js,
// settings-bridge.js, youtube-resume.js and twitch-quality.js; it exposes a single
// global, KickXShared.
(() => {
  "use strict";

  const KEYS = Object.freeze({
    // { xMaxQuality, kickBestQuality, kickLiveQuality, youtubeQuality, youtubeResume,
    //   twitchQuality }, all booleans
    appSettings: "app-settings",
    // { activeTab: "settings" | "kick-records" }, so the popup reopens on the last tab.
    popupState: "popup-state"
  });

  // Every setting is on by default, which matches how the extension behaved before
  // the settings tab existed.
  const DEFAULT_SETTINGS = Object.freeze({
    xMaxQuality: true,
    kickBestQuality: true,
    kickLiveQuality: true,
    youtubeQuality: true,
    youtubeResume: true,
    twitchQuality: true
  });

  const TABS = Object.freeze(["settings", "kick-records"]);

  // Accepts whatever is in storage (nothing, an older shape, junk) and returns a
  // complete settings object. Unknown or non-boolean values fall back to the default.
  function normalizeSettings(raw) {
    const settings = { ...DEFAULT_SETTINGS };
    if (raw && typeof raw === "object") {
      for (const key of Object.keys(DEFAULT_SETTINGS)) {
        if (typeof raw[key] === "boolean") settings[key] = raw[key];
      }
    }
    return settings;
  }

  globalThis.KickXShared = Object.freeze({ KEYS, DEFAULT_SETTINGS, TABS, normalizeSettings });
})();
