// Runs in the extension's isolated world on x.com / twitter.com and youtube.com. It can
// read chrome.storage, which the page-context scripts (x-max-quality.js and
// youtube-quality.js) cannot, so it copies every setting onto <html> as a data attribute
// they can see. A switch becomes "on" | "off" (xMaxQuality -> data-x-max-quality), and a
// number is copied as text (youtubeMaxHeight -> data-youtube-max-height="1080").
(() => {
  "use strict";

  const { KEYS, normalizeSettings } = globalThis.KickXShared;

  function publish(settings) {
    const root = document.documentElement;
    if (!root) {
      // Very early in page load the root element may not exist yet.
      document.addEventListener("DOMContentLoaded", () => publish(settings), { once: true });
      return;
    }
    for (const [key, value] of Object.entries(settings)) {
      root.dataset[key] = typeof value === "boolean" ? (value ? "on" : "off") : String(value);
    }
  }

  chrome.storage.local.get(KEYS.appSettings)
    .then(result => publish(normalizeSettings(result[KEYS.appSettings])))
    .catch(() => publish(normalizeSettings(null)));

  // Changing a setting in the popup takes effect for the next video without a reload.
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === "local" && changes[KEYS.appSettings]) {
      publish(normalizeSettings(changes[KEYS.appSettings].newValue));
    }
  });
})();
