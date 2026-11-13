/*
 * YouTube quality (page context)
 *
 * Picks the best quality up to the limit chosen in the popup (144p ... 8K) for every
 * video and live stream, through the player's own API. That API only exists in the
 * page's JavaScript, which is why this runs in the page's context (world: "MAIN").
 * The limit is handed over by settings-bridge.js as data-youtube-max-height on <html>
 * (a height in pixels, "0" when the setting is Off).
 */
(() => {
  "use strict";

  // Quality names used by the player API, with their heights ("auto" is not listed).
  const HEIGHTS = {
    tiny: 144, small: 240, medium: 360, large: 480, hd720: 720, hd1080: 1080,
    hd1440: 1440, hd2160: 2160, hd2880: 2880, highres: 4320
  };

  let handledVideo = null; // id of the video that already got its quality

  function apply() {
    // 0 means Off. Not reported yet (the bridge reads storage a moment after the page
    // starts) also does nothing: the next "playing" event tries again.
    const maxHeight = Number(document.documentElement.dataset.youtubeMaxHeight);
    if (!(maxHeight > 0)) return;

    const player = document.getElementById("movie_player");
    if (!player?.getAvailableQualityLevels || !player.setPlaybackQualityRange) return;
    // An ad is playing: leave it alone, the video's own "playing" event comes after it.
    if (player.classList.contains("ad-showing")) return;

    const id = player.getVideoData?.().video_id;
    if (!id || id === handledVideo) return;

    const levels = player.getAvailableQualityLevels()
      .filter(level => Object.hasOwn(HEIGHTS, level))
      .sort((a, b) => HEIGHTS[a] - HEIGHTS[b]);
    if (!levels.length) return; // the quality list is not loaded yet, so try again on the next event

    // The tallest level within the limit. If the video only offers taller ones (say a
    // 144p limit on a video that starts at 240p), take its lowest, the closest to the limit.
    const within = levels.filter(level => HEIGHTS[level] <= maxHeight);
    const best = within.length ? within[within.length - 1] : levels[0];

    handledVideo = id; // once per video, so a quality you pick yourself is left alone
    player.setPlaybackQualityRange(best, best);
    console.debug(`[YouTube Quality] ${id}: ${best} (limit ${maxHeight}p)`);
  }

  // "playing" fires when a video starts, when it resumes after an ad and after buffering.
  // Media events don't bubble, so listen in the capture phase.
  document.addEventListener("playing", apply, true);
})();
