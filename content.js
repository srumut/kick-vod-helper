(() => {
  "use strict";

  const STORAGE_PREFIX = "kick-vod-resume:";
  const SETTINGS_PREFIX = "kick-vod-settings:";
  const SAVE_INTERVAL_MS = 5_000;
  const MIN_POSITION_SECONDS = 3;
  const END_BUFFER_SECONDS = 12;
  const QUALITY_RETRY_MS = 300;
  const QUALITY_RETRY_LIMIT = 30;

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

  function settingsKey(id) {
    return `${SETTINGS_PREFIX}${id}`;
  }

  function removeSavedPosition(id) {
    // Keep volume and quality preferences: they are stored independently.
    chrome.storage.local.remove(storageKey(id)).catch(() => {});
  }

  function updateSettings(context, patch) {
    if (!context || !context.settingsLoaded) return;

    context.settings = {
      ...context.settings,
      ...patch,
      updatedAt: Date.now()
    };

    const key = settingsKey(context.id);
    const snapshot = { ...context.settings };
    context.settingsWrite = (context.settingsWrite || Promise.resolve())
      .then(() => chrome.storage.local.set({ [key]: snapshot }))
      .catch(() => {});
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

    const cleanUrl = new URL(window.location.href);
    cleanUrl.search = "";
    cleanUrl.hash = "";

    chrome.storage.local.set({
      [key]: {
        id: context.id,
        time: Math.floor(time),
        duration: Math.floor(duration),
        updatedAt: Date.now(),
        title: document.title || "Kick VOD",
        url: cleanUrl.href
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

  // ---------------------------- Volume memory ----------------------------

  function readVolumeState(video) {
    return {
      volume: Math.min(1, Math.max(0, Number.isFinite(video.volume) ? video.volume : 1)),
      muted: Boolean(video.muted)
    };
  }

  function rememberCurrentVolume(context, force = false) {
    if (!context || active !== context || !context.settingsLoaded) return;
    // Do not record the temporary default values while Kick is still mounting
    // its player and the saved preference is being restored.
    if (context.volumeRestorePending) return;

    const current = readVolumeState(context.video);

    // Assigning video.volume/video.muted raises volumechange too. Ignore those
    // events briefly after applying a saved value, but keep the observed state
    // in sync so the polling fallback does not mistake it for a user change.
    if (!force && Date.now() < (context.suppressVolumeEventsUntil || 0)) {
      context.lastVolumeState = current;
      return;
    }

    const previous = context.lastVolumeState;
    const changed = force || !previous ||
      Math.abs(previous.volume - current.volume) > 0.001 ||
      previous.muted !== current.muted;

    context.lastVolumeState = current;
    if (!changed) return;

    updateSettings(context, current);
  }

  function applyVolumeSettings(context) {
    if (!context || active !== context || !context.settingsLoaded) return false;

    const storedVolume = context.settings.volume;
    const volume = Number.isFinite(storedVolume)
      ? Math.min(1, Math.max(0, storedVolume))
      : 1;
    const muted = typeof context.settings.muted === "boolean"
      ? context.settings.muted
      : false;

    try {
      // Kick may update the media element as the player finishes mounting.
      // Applying after metadata/canplay and polling below handles either order.
      context.suppressVolumeEventsUntil = Date.now() + 350;
      if (Math.abs(context.video.volume - volume) > 0.001) context.video.volume = volume;
      if (context.video.muted !== muted) context.video.muted = muted;
      context.lastVolumeState = readVolumeState(context.video);
      updateSettings(context, { volume, muted });
      return true;
    } catch {
      // Some media implementations may reject volume changes; playback is unaffected.
      return false;
    }
  }

  function maybeRestoreVolumeSettings(context) {
    if (!context || active !== context || !context.settingsLoaded || context.volumeRestoreStarted) return;
    // Wait until Kick has a playable media element. Applying too early can be
    // overwritten by the player's own initialization a moment later.
    if (context.video.readyState < HTMLMediaElement.HAVE_FUTURE_DATA) return;

    context.volumeRestoreStarted = true;
    context.volumeRestorePending = true;
    applyVolumeSettings(context);

    // Kick may write its initial player state after canplay. Re-apply once
    // after that initialization settles, then begin watching for user changes.
    context.volumeRestoreTimer = window.setTimeout(() => {
      if (active !== context || getVodId() !== context.id) return;
      applyVolumeSettings(context);
      context.lastVolumeState = readVolumeState(context.video);
      context.volumeRestorePending = false;
      context.volumeRestoreTimer = null;
    }, 700);
  }

  async function restorePlayerSettings(context) {
    if (context.settingsLoadStarted) {
      maybeRestoreVolumeSettings(context);
      return;
    }
    context.settingsLoadStarted = true;

    try {
      const key = settingsKey(context.id);
      const result = await chrome.storage.local.get(key);
      if (active !== context || getVodId() !== context.id) return;

      const saved = result[key];
      context.settings = saved && typeof saved === "object" ? { ...saved } : {};
      context.settingsLoaded = true;

      // A VOD with no saved preference starts at full volume and unmuted.
      maybeRestoreVolumeSettings(context);
      startQualityRestore(context);
    } catch {
      // Keep playback usable if extension storage is unavailable.
      if (active !== context) return;
      context.settings = { volume: 1, muted: false };
      context.settingsLoaded = true;
      maybeRestoreVolumeSettings(context);
      startQualityRestore(context);
    }
  }

  // ---------------------------- Quality memory ---------------------------

  function parseQualityLabel(element) {
    if (!(element instanceof Element)) return null;
    const raw = (
      element.getAttribute("value") ||
      element.getAttribute("aria-label") ||
      element.textContent ||
      ""
    ).replace(/\s+/g, " ").trim();
    const lower = raw.toLowerCase();

    if (/\bauto\b/.test(lower)) return { mode: "auto", key: "auto" };
    if (/\bsource\b/.test(lower)) return { mode: "source", key: "source" };

    const match = raw.match(/(\d{3,4})\s*p\s*(\d{2,3})?/i);
    if (!match) return null;

    const height = Number.parseInt(match[1], 10);
    const fps = match[2] ? Number.parseInt(match[2], 10) : 0;
    return { mode: "resolution", height, fps, key: `${height}p${fps || ""}` };
  }

  function isLoginRequiredQuality(element) {
    // Kick marks some quality choices with an extra badge element (for example,
    // a login-required label). Do not treat those as selectable qualities.
    return [...element.children].some(child => child.tagName !== "SPAN");
  }

  function getQualityItems() {
    return [...document.querySelectorAll('[role="menuitemradio"], [role="radio"]')]
      .map(element => ({ element, quality: parseQualityLabel(element) }))
      .filter(item => item.quality && !item.element.disabled &&
        item.element.getAttribute("aria-disabled") !== "true" &&
        !isLoginRequiredQuality(item.element));
  }

  function chooseQuality(items, preferredKey) {
    if (!items.length) return null;

    const available = items;
    const preferred = typeof preferredKey === "string" ? preferredKey.toLowerCase() : "";

    if (preferred) {
      const exact = available.find(item => item.quality.key.toLowerCase() === preferred);
      if (exact) return exact;

      const preferredMatch = preferred.match(/^(\d{3,4})p(\d{0,3})$/);
      if (preferredMatch) {
        const wantedHeight = Number.parseInt(preferredMatch[1], 10);
        const wantedFps = Number.parseInt(preferredMatch[2] || "0", 10);
        const fixed = available.filter(item => item.quality.mode === "resolution");
        const belowOrEqual = fixed.filter(item => item.quality.height <= wantedHeight)
          .sort((a, b) => (b.quality.height - a.quality.height) ||
            (Math.abs(a.quality.fps - wantedFps) - Math.abs(b.quality.fps - wantedFps)));
        if (belowOrEqual.length) return belowOrEqual[0];
        if (fixed.length) {
          return fixed.sort((a, b) => (a.quality.height - b.quality.height) ||
            (a.quality.fps - b.quality.fps))[0];
        }
      }

      // If a saved preference is no longer available, fall back to the best option.
    }

    const source = available.find(item => item.quality.mode === "source");
    if (source) return source;

    const resolutions = available
      .filter(item => item.quality.mode === "resolution")
      .sort((a, b) => (b.quality.height - a.quality.height) ||
        (b.quality.fps - a.quality.fps));
    if (resolutions.length) return resolutions[0];

    return available.find(item => item.quality.mode === "auto") || null;
  }

  function playerSettingsButton(video) {
    const rect = video.getBoundingClientRect();
    const candidates = [...document.querySelectorAll('button[aria-haspopup="menu"], .z-controls button')]
      .filter(button => {
        if (button.closest("header") || button.closest('[data-testid="livestream-results-card"]')) return false;
        const bounds = button.getBoundingClientRect();
        return bounds.width > 0 && bounds.height > 0;
      });

    const distanceFromPlayer = button => {
      const bounds = button.getBoundingClientRect();
      return Math.hypot(
        rect.right - (bounds.left + bounds.width / 2),
        rect.bottom - (bounds.top + bounds.height / 2)
      );
    };

    const labelled = candidates.filter(button => {
      const label = `${button.getAttribute("aria-label") || ""} ${button.getAttribute("title") || ""}`;
      return /settings|quality/i.test(label);
    }).sort((a, b) => distanceFromPlayer(a) - distanceFromPlayer(b));
    if (labelled.length) return labelled[0];

    // Current Kick desktop player: settings is a menu button near the video.
    const desktopCandidates = candidates.filter(button => button.matches('button[aria-haspopup="menu"]'));
    if (desktopCandidates.length) {
      desktopCandidates.sort((a, b) => distanceFromPlayer(a) - distanceFromPlayer(b));
      return desktopCandidates[0];
    }

    // Current compact/mobile player: its gear button is inside .z-controls.
    return candidates.find(button => {
      const path = button.querySelector("svg path")?.getAttribute("d") || "";
      return path.startsWith("M25.7,17.3");
    }) || null;
  }

  function revealPlayerControls(video) {
    const target = video.parentElement || video;
    const rect = target.getBoundingClientRect();
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;
    for (const type of ["pointerenter", "mouseenter", "pointerover", "mouseover", "mousemove", "pointermove"]) {
      target.dispatchEvent(new MouseEvent(type, {
        bubbles: true,
        cancelable: true,
        view: window,
        clientX: x,
        clientY: y
      }));
    }
  }

  function clickPlayerElement(element) {
    if (!element) return;
    element.focus?.();
    for (const type of ["pointerover", "pointerenter", "pointerdown", "mousedown", "pointerup", "mouseup", "click"]) {
      element.dispatchEvent(new PointerEvent(type, {
        bubbles: true,
        cancelable: true,
        composed: true,
        pointerId: 1,
        pointerType: "mouse",
        isPrimary: true
      }));
    }
  }

  function closeQualityMenu() {
    document.dispatchEvent(new KeyboardEvent("keydown", {
      key: "Escape",
      bubbles: true,
      composed: true
    }));
  }

  function startQualityRestore(context) {
    if (!context || active !== context || context.qualityRestoreStarted) return;
    context.qualityRestoreStarted = true;

    let attempts = 0;
    let openedByUs = false;
    let clickCount = 0;
    let preferredKey = typeof context.settings.quality === "string"
      ? context.settings.quality
      : "";

    const tick = () => {
      if (active !== context || getVodId() !== context.id || context.qualityApplied) return;
      attempts += 1;

      const items = getQualityItems();
      if (items.length) {
        const target = chooseQuality(items, preferredKey);
        if (target) {
          const checked = items.find(item => item.element.getAttribute("aria-checked") === "true");
          const alreadySelected = checked?.element === target.element;

          if (!alreadySelected && clickCount < 2) {
            clickPlayerElement(target.element);
            clickCount += 1;
            // This also makes the default best quality a remembered preference.
            updateSettings(context, { quality: target.quality.key });
            preferredKey = target.quality.key;
            window.setTimeout(tick, 550);
            return;
          }

          updateSettings(context, { quality: target.quality.key });
          context.qualityApplied = true;
          if (openedByUs) closeQualityMenu();
          return;
        }
      } else {
        const button = playerSettingsButton(context.video);
        if (button) {
          revealPlayerControls(context.video);
          // Open the settings menu once; subsequent attempts wait for its items.
          if (!openedByUs || attempts % 5 === 0) {
            clickPlayerElement(button);
            openedByUs = true;
          }
        } else {
          revealPlayerControls(context.video);
        }
      }

      if (attempts >= QUALITY_RETRY_LIMIT) {
        if (openedByUs) closeQualityMenu();
        context.qualityRestoreFinished = true;
        return;
      }
      window.setTimeout(tick, QUALITY_RETRY_MS);
    };

    // Kick may mount the player menu after metadata has loaded.
    window.setTimeout(tick, 400);
  }

  // Remember manual quality choices made in Kick's own quality menu.
  document.addEventListener("click", event => {
    const target = event.target instanceof Element
      ? event.target.closest('[role="menuitemradio"], [role="radio"]')
      : null;
    if (!target || !active || !active.settingsLoaded) return;

    const quality = parseQualityLabel(target);
    if (quality && !isLoginRequiredQuality(target)) {
      updateSettings(active, { quality: quality.key });
    }
  }, true);

  function bindVideo(video, id) {
    if (active?.id === id && active.video === video) return;

    if (active) {
      rememberCurrentVolume(active, true);
      savePosition(active, true, true);
      if (active.volumePoll) window.clearInterval(active.volumePoll);
      if (active.volumeRestoreTimer) window.clearTimeout(active.volumeRestoreTimer);
    }

    const context = {
      id,
      video,
      lastSavedAt: 0,
      restoreStarted: false,
      restored: false,
      settings: {},
      settingsLoaded: false,
      settingsLoadStarted: false,
      settingsWrite: Promise.resolve(),
      qualityRestoreStarted: false,
      qualityApplied: false,
      qualityRestoreFinished: false,
      suppressVolumeEventsUntil: 0,
      lastVolumeState: readVolumeState(video),
      volumeRestoreStarted: false,
      volumeRestorePending: false,
      volumeRestoreTimer: null,
      volumePoll: null
    };
    active = context;

    video.addEventListener("loadedmetadata", () => {
      restorePosition(context);
      restorePlayerSettings(context);
      maybeRestoreVolumeSettings(context);
    });
    video.addEventListener("durationchange", () => {
      restorePosition(context);
      restorePlayerSettings(context);
      maybeRestoreVolumeSettings(context);
    });
    video.addEventListener("canplay", () => {
      restorePlayerSettings(context);
      maybeRestoreVolumeSettings(context);
    });
    video.addEventListener("playing", () => maybeRestoreVolumeSettings(context));
    video.addEventListener("volumechange", () => rememberCurrentVolume(context));
    video.addEventListener("timeupdate", () => {
      rememberCurrentVolume(context);
      savePosition(context);
    });
    video.addEventListener("pause", () => {
      rememberCurrentVolume(context);
      savePosition(context, true);
    });
    // A fallback for player controls that update the media element without a
    // reliably observable DOM event (and for delayed Kick player state changes).
    context.volumePoll = window.setInterval(() => rememberCurrentVolume(context), 400);
    video.addEventListener("seeking", () => {
      // Seeking back to the beginning means the viewer chose to restart the VOD.
      if (active === context && context.restored && video.currentTime < MIN_POSITION_SECONDS) {
        removeSavedPosition(context.id);
      }
    });

    restorePlayerSettings(context);
    if (video.readyState >= HTMLMediaElement.HAVE_METADATA) {
      restorePosition(context);
    }
  }

  function scanPage() {
    const id = getVodId();

    if (id !== pageVodId) {
      if (active) {
        rememberCurrentVolume(active, true);
        savePosition(active, true, true);
        if (active.volumePoll) window.clearInterval(active.volumePoll);
        if (active.volumeRestoreTimer) window.clearTimeout(active.volumeRestoreTimer);
      }
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
    if (active) {
      rememberCurrentVolume(active, true);
      savePosition(active, true, true);
    }
  });

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden" && active) {
      rememberCurrentVolume(active, true);
      savePosition(active, true, true);
    }
  });

  scanPage();
})();
