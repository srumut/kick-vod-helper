// Twitch's player starts in whatever quality is saved in localStorage ("chunked" is
// Source, the highest the streamer offers). Writing that before the player starts, and
// again whenever Twitch navigates to another page, makes streams and videos open in
// the best quality. Runs in the isolated world: localStorage is shared with the page.
(() => {
  "use strict";

  const { KEYS, normalizeSettings } = globalThis.KickXShared;

  let enabled = false;

  function apply() {
    if (!enabled) return;
    try {
      localStorage.setItem("video-quality", '{"default":"chunked"}');
      // Twitch also checks when the quality was saved and ignores it when that is old.
      localStorage.setItem("s-qs-ts", String(Date.now()));
    } catch {
      // Storage can be blocked; Twitch then just keeps its own default.
    }
  }

  chrome.storage.local.get(KEYS.appSettings)
    .catch(() => ({}))
    .then(result => {
      enabled = normalizeSettings(result[KEYS.appSettings]).twitchQuality;
      apply();
    });

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === "local" && changes[KEYS.appSettings]) {
      enabled = normalizeSettings(changes[KEYS.appSettings].newValue).twitchQuality;
      apply();
    }
  });

  // Twitch is a single-page app: opening another stream doesn't reload the page.
  window.navigation?.addEventListener("navigate", apply);
})();
