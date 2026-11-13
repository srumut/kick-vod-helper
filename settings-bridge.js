// Runs in the extension's isolated world on x.com / twitter.com and youtube.com. It can
// read chrome.storage, which the page-context scripts (x-max-quality.js and
// youtube-quality.js) cannot, so it copies every switch onto <html> as a data attribute
// they can see: xMaxQuality becomes data-x-max-quality="on" | "off", and so on.
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
    for (const [key, on] of Object.entries(settings)) root.dataset[key] = on ? "on" : "off";
  }

  chrome.storage.local.get(KEYS.appSettings)
    .then(result => publish(normalizeSettings(result[KEYS.appSettings])))
    .catch(() => publish(normalizeSettings(null)));

  // Toggling a switch in the popup takes effect for the next video without a reload.
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === "local" && changes[KEYS.appSettings]) {
      publish(normalizeSettings(changes[KEYS.appSettings].newValue));
    }
  });
})();
