// Remembers where you stopped on each YouTube video and jumps back there next time.
// Positions go in the same store as the Kick VOD records (their ids start with "yt-"),
// so the popup lists and deletes them together. Live streams, Shorts and ads are skipped.
(() => {
  "use strict";

  const { KEYS, normalizeSettings } = globalThis.KickXShared;
  const STORAGE_PREFIX = "kick-vod-resume:";
  const SAVE_INTERVAL_MS = 5_000;
  const MIN_POSITION_SECONDS = 3;
  const END_BUFFER_SECONDS = 12;
  // The main player, but not while an ad plays in it or when it shows a live stream.
  const PLAYER = "#movie_player:not(.ad-showing):not(.ytp-live)";

  let enabled = true;
  let current = null; // { video, id } for the video being watched
  let lastSavedAt = 0;

  const watchId = () =>
    location.pathname === "/watch" ? new URLSearchParams(location.search).get("v") : null;
  const keyFor = id => `${STORAGE_PREFIX}yt-${id}`;

  // Runs when a video starts or resumes. Notes which video it is and puts it back where
  // it stopped last time.
  async function bind(event) {
    const video = event.target;
    const id = watchId();
    if (!(video instanceof HTMLVideoElement) || !video.closest(PLAYER) ||
        !id || !Number.isFinite(video.duration)) return;
    if (current?.video === video && current.id === id) return;
    current = { video, id };

    // A link with a timestamp (&t=...) says where to start, so it wins.
    if (!enabled || new URLSearchParams(location.search).has("t")) return;

    try {
      const key = keyFor(id);
      const saved = (await chrome.storage.local.get(key))[key];
      if (current?.video !== video || current.id !== id) return; // moved on while reading
      if (!saved || !(saved.time >= MIN_POSITION_SECONDS)) return;
      // Leave it alone if YouTube or the viewer already moved it, or it was nearly finished.
      if (video.currentTime > MIN_POSITION_SECONDS ||
          saved.time >= video.duration - END_BUFFER_SECONDS) return;
      video.currentTime = saved.time;
    } catch {
      // Storage can be unavailable; playback still works.
    }
  }

  function save(force = false) {
    if (!enabled || !current) return;
    const { video, id } = current;
    // Skip while an ad or live stream is in the player, or once the page has moved on to
    // another video (the old one can keep playing for a moment).
    if (id !== watchId() || !video.closest(PLAYER)) return;

    const time = video.currentTime;
    const duration = video.duration;
    if (!Number.isFinite(time) || !Number.isFinite(duration) || duration <= 0) return;
    if (!force && Date.now() - lastSavedAt < SAVE_INTERVAL_MS) return;
    lastSavedAt = Date.now();

    // Don't keep a resume point when the video is effectively finished.
    if (time >= duration - END_BUFFER_SECONDS) {
      chrome.storage.local.remove(keyFor(id)).catch(() => {});
      return;
    }
    // Avoid overwriting an existing resume point during the first few seconds.
    if (time < MIN_POSITION_SECONDS) return;

    chrome.storage.local.set({
      [keyFor(id)]: {
        id: `yt-${id}`,
        time: Math.floor(time),
        duration: Math.floor(duration),
        updatedAt: Date.now(),
        title: document.title.replace(/^\(\d+\)\s*/, "").replace(/ - YouTube$/, "") || "YouTube video",
        url: `https://www.youtube.com/watch?v=${id}`
      }
    }).catch(() => {});
  }

  // Media events don't bubble, so listen in the capture phase. Only the video being
  // watched matters (not the previews that play when hovering a thumbnail).
  for (const type of ["loadedmetadata", "playing"]) document.addEventListener(type, bind, true);
  document.addEventListener("timeupdate", event => {
    if (event.target === current?.video) save();
  }, true);
  document.addEventListener("pause", event => {
    if (event.target === current?.video) save(true);
  }, true);
  window.addEventListener("pagehide", () => save(true));

  chrome.storage.local.get(KEYS.appSettings)
    .then(result => { enabled = normalizeSettings(result[KEYS.appSettings]).youtubeResume; })
    .catch(() => {});
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === "local" && changes[KEYS.appSettings]) {
      enabled = normalizeSettings(changes[KEYS.appSettings].newValue).youtubeResume;
    }
  });
})();
