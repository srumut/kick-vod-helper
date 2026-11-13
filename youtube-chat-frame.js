// Runs inside the chat iframe that YouTube embeds in its watch page (youtube.com/live_chat
// for live streams, /live_chat_replay for replays), at document_start. With "Disable chat"
// on, it stops that page from loading, so the chat's scripts never start: no messages are
// downloaded and none are drawn. Hiding the iframe alone (chat-hide.js) would leave all of
// that running unseen.
(() => {
  "use strict";

  // A chat window you opened on its own (pop-out) is not embedded in the watch page, and
  // opening it is a deliberate choice, so leave it alone.
  if (window.top === window) return;

  const { KEYS, normalizeSettings } = globalThis.KickXShared;

  chrome.storage.local.get(KEYS.appSettings)
    .then(result => {
      if (normalizeSettings(result[KEYS.appSettings]).youtubeDisableChat) window.stop();
    })
    .catch(() => {});
})();
