// Constants shared by the popup and the content scripts, so the setting names and
// defaults live in exactly one place. Loaded before popup-ui.js, content.js,
// settings-bridge.js, youtube-resume.js, twitch-quality.js, chat-hide.js and
// youtube-chat-frame.js; it exposes a single global, KickXShared.
(() => {
  "use strict";

  const KEYS = Object.freeze({
    // { xMaxQuality, kickBestQuality, kickLiveQuality, youtubeMaxHeight, youtubeResume,
    //   twitchQuality, kickDisableChat, youtubeDisableChat, twitchDisableChat }.
    // Every one is a boolean except youtubeMaxHeight, which is a number from
    // YOUTUBE_QUALITY_OPTIONS.
    appSettings: "app-settings",
    // { activeTab: one of TABS }, so the popup reopens on the last tab.
    popupState: "popup-state"
  });

  // Choices for the YouTube quality limit: the tallest picture, in pixels, that the
  // extension may pick. 0 means the extension leaves YouTube's own automatic quality
  // alone. YouTube names 4320p "8K" and 2160p "4K"; a video only offers the levels it
  // was uploaded in, so a higher limit never forces a quality that isn't there.
  const YOUTUBE_QUALITY_OPTIONS = Object.freeze([
    { value: 0, label: "Off" },
    { value: 144, label: "144p" },
    { value: 240, label: "240p" },
    { value: 360, label: "360p" },
    { value: 480, label: "480p" },
    { value: 720, label: "720p" },
    { value: 1080, label: "1080p" },
    { value: 1440, label: "1440p (2K)" },
    { value: 2160, label: "2160p (4K)" },
    { value: 4320, label: "4320p (8K)" }
  ].map(option => Object.freeze(option)));

  // The quality and position switches are on by default, which matches how the
  // extension behaved before the settings tab existed. The "disable chat" switches are
  // off by default, so chat is shown everywhere unless you turn one on.
  const DEFAULT_SETTINGS = Object.freeze({
    xMaxQuality: true,
    kickBestQuality: true,
    kickLiveQuality: true,
    youtubeMaxHeight: 1080,
    youtubeResume: true,
    twitchQuality: true,
    kickDisableChat: false,
    youtubeDisableChat: false,
    twitchDisableChat: false
  });

  // Each name is a tab's data-tab in popup.html. The two records tabs hold the saved
  // playback positions: "kick-records" for Kick VODs, "youtube-records" for YouTube.
  const TABS = Object.freeze(["settings", "kick-records", "youtube-records"]);

  const BOOLEAN_KEYS = Object.keys(DEFAULT_SETTINGS)
    .filter(key => typeof DEFAULT_SETTINGS[key] === "boolean");
  const YOUTUBE_QUALITY_VALUES = YOUTUBE_QUALITY_OPTIONS.map(option => option.value);

  // Accepts whatever is in storage (nothing, an older shape, junk) and returns a
  // complete settings object. Unknown or invalid values fall back to the default.
  function normalizeSettings(raw) {
    const settings = { ...DEFAULT_SETTINGS };
    if (raw && typeof raw === "object") {
      for (const key of BOOLEAN_KEYS) {
        if (typeof raw[key] === "boolean") settings[key] = raw[key];
      }
      if (YOUTUBE_QUALITY_VALUES.includes(raw.youtubeMaxHeight)) {
        settings.youtubeMaxHeight = raw.youtubeMaxHeight;
      } else if (raw.youtubeQuality === false) {
        // v1.4.0 stored this as an on/off switch. Keep "off" meaning off.
        settings.youtubeMaxHeight = 0;
      }
    }
    return settings;
  }

  globalThis.KickXShared = Object.freeze({
    KEYS, DEFAULT_SETTINGS, TABS, YOUTUBE_QUALITY_OPTIONS, normalizeSettings
  });
})();
