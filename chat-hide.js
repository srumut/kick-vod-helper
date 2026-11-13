// Hides the chat on Twitch, Kick and YouTube when that site's "Disable chat" switch is
// on (live streams and VOD / replay chat alike). Hidden chat isn't laid out or painted,
// which is where most of the cost of a busy chat goes. Runs at document_start so the
// chat never flashes up, and follows the switch live: no reload to hide or show it.
(() => {
  "use strict";

  const { KEYS, normalizeSettings } = globalThis.KickXShared;

  // One entry per site. `selectors` are the chat containers. The sites rename things
  // from time to time, so when a switch stops hiding anything, this list is the only
  // thing to update (inspect the chat panel in DevTools and add its selector).
  const SITES = [
    {
      host: /(^|\.)twitch\.tv$/,
      setting: "twitchDisableChat",
      // The whole right-hand column, which holds the live chat and the VOD chat.
      selectors: [".right-column"]
    },
    {
      host: /(^|\.)kick\.com$/,
      setting: "kickDisableChat",
      // A sibling of <main>, so the video area grows into the freed space by itself.
      selectors: ["#channel-chatroom"]
    },
    {
      host: /(^|\.)youtube\.com$/,
      setting: "youtubeDisableChat",
      // The chat column of the watch page and the chat iframe inside it (live chat and
      // chat replay).
      selectors: ["#chat-container", "ytd-live-chat-frame#chat"],
      // YouTube's chat is an iframe that youtube-chat-frame.js stops from loading while
      // the switch is on. When the switch goes off, load it again.
      onShow() {
        try {
          document.querySelector("iframe#chatframe")?.contentWindow?.location.reload();
        } catch {
          // The frame is gone or unreachable: it loads normally with the next video.
        }
      }
    }
  ];

  const site = SITES.find(candidate => candidate.host.test(location.hostname));
  if (!site) return;

  const STYLE_ID = "kick-vod-resume-hide-chat";
  let wanted = false; // what the setting says right now

  // Makes the page match `wanted`. Safe to call any number of times.
  function sync() {
    const existing = document.getElementById(STYLE_ID);
    if (!wanted) {
      existing?.remove();
      return;
    }
    if (existing) return;

    // At document_start <head> may not exist yet, but <html> does.
    const parent = document.head || document.documentElement;
    if (!parent) {
      // Not even that yet: try again the moment the page gets a root element.
      new MutationObserver((records, observer) => {
        if (document.documentElement) {
          observer.disconnect();
          sync();
        }
      }).observe(document, { childList: true });
      return;
    }
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `${site.selectors.join(",\n")} { display: none !important; }`;
    parent.append(style);
  }

  function setHidden(on) {
    const wasHidden = wanted;
    wanted = on;
    sync();
    if (wasHidden && !on) site.onShow?.();
  }

  chrome.storage.local.get(KEYS.appSettings)
    .then(result => setHidden(normalizeSettings(result[KEYS.appSettings])[site.setting]))
    .catch(() => {});

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === "local" && changes[KEYS.appSettings]) {
      setHidden(normalizeSettings(changes[KEYS.appSettings].newValue)[site.setting]);
    }
  });
})();
