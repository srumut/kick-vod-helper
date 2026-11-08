// Runs in the extension's isolated world on x.com / twitter.com. It can read
// chrome.storage, which the page-context script (x-max-quality.js) cannot, so it
// copies the "X max quality" switch onto <html> where that script can see it.
(() => {
  "use strict";

  const { KEYS, normalizeSettings } = globalThis.KickXShared;
  const SETTING_ATTR = "data-x-max-quality";

  function publish(settings) {
    const value = settings.xMaxQuality ? "on" : "off";
    const root = document.documentElement;
    if (root) {
      root.setAttribute(SETTING_ATTR, value);
    } else {
      // Very early in page load the root element may not exist yet.
      document.addEventListener("DOMContentLoaded", () => publish(settings), { once: true });
    }
  }

  chrome.storage.local.get(KEYS.appSettings)
    .then(result => publish(normalizeSettings(result[KEYS.appSettings])))
    .catch(() => publish(normalizeSettings(null)));

  // Toggling the switch in the popup takes effect for the next video without a reload.
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === "local" && changes[KEYS.appSettings]) {
      publish(normalizeSettings(changes[KEYS.appSettings].newValue));
    }
  });
})();
