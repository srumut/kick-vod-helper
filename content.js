(() => {
  "use strict";

  const STORAGE_PREFIX = "kick-vod-resume:";
  const SAVE_INTERVAL_MS = 5_000;
  const MIN_POSITION_SECONDS = 3;
  const END_BUFFER_SECONDS = 12;

  let active = null;
  let pageVodId = null;
  let bindNotBefore = 0;

  function getVodId() {
    const path = window.location.pathname;
    const channelVod = path.match(/^\/[^/]+\/videos\/([0-9a-f-]{36})\/?$/i);
    const shortVod = path.match(/^\/video\/([0-9a-f-]{36})\/?$/i);
    return (channelVod?.[1] ?? shortVod?.[1] ?? null)?.toLowerCase() ?? null;
  }

  function storageKey(id) {
    return `${STORAGE_PREFIX}${id}`;
  }

  function removeSavedPosition(id) {
    chrome.storage.local.remove(storageKey(id)).catch(() => {});
  }

  function savePosition(context, force = false, allowOldRoute = false) {
    if (!context || active !== context) return;
    if (!allowOldRoute && getVodId() !== context.id) return;

    const video = context.video;
    const time = video.currentTime;
    const duration = video.duration;

    if (!Number.isFinite(time) || !Number.isFinite(duration) || duration <= 0) return;
    if (!force && Date.now() - context.lastSavedAt < SAVE_INTERVAL_MS) return;

    context.lastSavedAt = Date.now();

    const key = storageKey(context.id);

    // Don't keep a resume point when the VOD is effectively finished.
    if (time >= duration - END_BUFFER_SECONDS) {
      removeSavedPosition(context.id);
      return;
    }

    // Avoid overwriting an existing resume point during the first few seconds.
    if (time < MIN_POSITION_SECONDS) return;

    chrome.storage.local.set({
      [key]: {
        time: Math.floor(time),
        duration: Math.floor(duration),
        updatedAt: Date.now()
      }
    }).catch(() => {});
  }

  async function restorePosition(context) {
    if (context.restoreStarted) return;
    context.restoreStarted = true;

    const key = storageKey(context.id);

    try {
      const result = await chrome.storage.local.get(key);
      if (active !== context || getVodId() !== context.id) return;

      const saved = result[key];
      context.restored = true;

      if (!saved || !Number.isFinite(saved.time) || saved.time < MIN_POSITION_SECONDS) return;

      const video = context.video;
      const duration = video.duration;

      if (Number.isFinite(duration) && duration > 0) {
        if (saved.time >= duration - END_BUFFER_SECONDS) {
          removeSavedPosition(context.id);
          return;
        }
      }

      // Don't override a position that Kick (or the user) has already set.
      if (video.currentTime > MIN_POSITION_SECONDS) return;

      const target = Number.isFinite(duration) && duration > 0
        ? Math.min(saved.time, duration - 2)
        : saved.time;

      if (target > 0) video.currentTime = target;
    } catch {
      // Storage can be unavailable in restricted browser contexts; playback still works.
    }
  }

  function findMainVideo() {
    const videos = [...document.querySelectorAll("video")];
    if (videos.length === 0) return null;

    const visibleVideos = videos
      .map(video => {
        const rect = video.getBoundingClientRect();
        const visible = rect.width > 100 && rect.height > 70 &&
          getComputedStyle(video).visibility !== "hidden";
        return { video, area: rect.width * rect.height, visible };
      })
      .filter(item => item.visible)
      .sort((a, b) => b.area - a.area);

    return visibleVideos[0]?.video ?? videos[0];
  }

  function bindVideo(video, id) {
    if (active?.id === id && active.video === video) return;

    if (active) savePosition(active, true, true);

    const context = {
      id,
      video,
      lastSavedAt: 0,
      restoreStarted: false,
      restored: false
    };
    active = context;

    video.addEventListener("loadedmetadata", () => restorePosition(context), { once: true });
    video.addEventListener("durationchange", () => restorePosition(context), { once: true });
    video.addEventListener("timeupdate", () => savePosition(context));
    video.addEventListener("pause", () => savePosition(context, true));
    video.addEventListener("seeking", () => {
      // Seeking back to the beginning means the viewer chose to restart the VOD.
      if (active === context && context.restored && video.currentTime < MIN_POSITION_SECONDS) {
        removeSavedPosition(context.id);
      }
    });

    if (video.readyState >= HTMLMediaElement.HAVE_METADATA) {
      restorePosition(context);
    }
  }

  function scanPage() {
    const id = getVodId();

    if (id !== pageVodId) {
      if (active) savePosition(active, true, true);
      active = null;
      pageVodId = id;
      // Give Kick's SPA player a moment to switch sources after navigation.
      bindNotBefore = Date.now() + 800;
    }

    if (!id || Date.now() < bindNotBefore) return;

    const video = findMainVideo();
    if (video) bindVideo(video, id);
  }

  const observer = new MutationObserver(scanPage);
  observer.observe(document.documentElement, { childList: true, subtree: true });

  // Kick is a single-page app, so also check for URL changes that don't replace the page.
  window.setInterval(scanPage, 1_000);

  window.addEventListener("pagehide", () => {
    if (active) savePosition(active, true, true);
  });

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden" && active) {
      savePosition(active, true, true);
    }
  });

  scanPage();
})();
