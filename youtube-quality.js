/*
 * YouTube quality (page context)
 *
 * Picks the best quality up to 1080p for every video and live stream, through the
 * player's own API. That API only exists in the page's JavaScript, which is why this
 * runs in the page's context (world: "MAIN"). The on/off switch is handed over by
 * settings-bridge.js as data-youtube-quality on <html>.
 */
(() => {
  "use strict";

  const MAX_HEIGHT = 1080;
  // Quality names used by the player API, with their heights ("auto" is not listed).
  const HEIGHTS = {
    tiny: 144, small: 240, medium: 360, large: 480, hd720: 720, hd1080: 1080,
    hd1440: 1440, hd2160: 2160, hd2880: 2880, highres: 4320
  };

  let handledVideo = null; // id of the video that already got its quality

  function apply() {
    if (document.documentElement.dataset.youtubeQuality === "off") return;

    const player = document.getElementById("movie_player");
    if (!player?.getAvailableQualityLevels || !player.setPlaybackQualityRange) return;
    // An ad is playing: leave it alone, the video's own "playing" event comes after it.
    if (player.classList.contains("ad-showing")) return;

    const id = player.getVideoData?.().video_id;
    if (!id || id === handledVideo) return;

    let best = null;
    for (const level of player.getAvailableQualityLevels()) {
      if (HEIGHTS[level] <= MAX_HEIGHT && (best === null || HEIGHTS[level] > HEIGHTS[best])) best = level;
    }
    if (!best) return; // the quality list is not loaded yet, so try again on the next event

    handledVideo = id; // once per video, so a quality you pick yourself is left alone
    player.setPlaybackQualityRange(best, best);
    console.debug(`[YouTube Quality] ${id}: ${best}`);
  }

  // "playing" fires when a video starts, when it resumes after an ad and after buffering.
  // Media events don't bubble, so listen in the capture phase.
  document.addEventListener("playing", apply, true);
})();
