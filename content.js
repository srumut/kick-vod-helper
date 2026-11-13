(() => {
  "use strict";

  const STORAGE_PREFIX = "kick-vod-resume:";
  const SETTINGS_PREFIX = "kick-vod-settings:";
  const VOLUME_PREFIX = "kick-vod-volume:";
  const LIVE_PREFIX = "live:";
  const { KEYS, normalizeSettings } = globalThis.KickXShared;
  const SAVE_INTERVAL_MS = 5_000;
  const MIN_POSITION_SECONDS = 3;
  const END_BUFFER_SECONDS = 12;
  const QUALITY_RETRY_MS = 300;
  const QUALITY_RETRY_LIMIT = 30;
  const VOLUME_RESTORE_RETRY_MS = 400;
  const VOLUME_RESTORE_RETRY_COUNT = 6;
  // One pass runs when the saved volume is loaded; a second may run when the
  // player starts playing, because Kick often finishes initialising then.
  const VOLUME_RESTORE_PASSES = 2;
  // After one of our own synthetic clicks, undo any page scroll it causes for this long.
  const SCROLL_GUARD_MS = 800;
  // Wait this long for the quality menu to appear before clicking the gear again.
  const MENU_REOPEN_MS = 1_500;
  // After picking a quality, close the menu ourselves only if Kick left it open.
  const MENU_CLOSE_CHECK_MS = 500;
  // Real user input (isTrusted) during the guard window means a scroll is the viewer's own.
  const USER_INPUT_EVENTS = ["wheel", "touchstart", "touchmove", "keydown", "pointerdown", "mousedown"];

  // Switches from the popup's Settings tab. Read again each time a VOD is bound, and
  // kept current by the storage listener near the end of this file.
  let appSettings = normalizeSettings(null);
  let active = null;
  // What the page is playing: a VOD id, "live:<channel>" on a channel page, or null.
  let pageKey = null;
  let bindNotBefore = 0;
  // Bumped every time the page key in the URL changes (opening a VOD, leaving it, going
  // back to it). Kick may reuse the same <video> element but re-initialise its player
  // on each visit, so "already picked" must only hold within one visit.
  let routeVisit = 0;
  // <video> element -> routeVisit in which its quality was already picked. Re-binding
  // the same element within a visit (Kick re-rendering, the largest-video heuristic
  // flipping) must not pick the quality a second time.
  const qualityHandled = new WeakMap();

  function getVodId() {
    const path = window.location.pathname;
    const channelVod = path.match(/^\/[^/]+\/videos\/([0-9a-f-]{36})\/?$/i);
    const shortVod = path.match(/^\/video\/([0-9a-f-]{36})\/?$/i);
    return (channelVod?.[1] ?? shortVod?.[1] ?? null)?.toLowerCase() ?? null;
  }

  // First path segments on kick.com that are pages rather than channels.
  const NOT_CHANNELS = new Set(["browse", "categories", "category", "following", "search", "clips"]);

  // kick.com/<channel> is where a channel's live stream plays.
  function getLiveKey() {
    const channel = window.location.pathname.match(/^\/([^/]+)\/?$/)?.[1]?.toLowerCase();
    return channel && !NOT_CHANNELS.has(channel) ? `${LIVE_PREFIX}${channel}` : null;
  }

  function getPageKey() {
    return getVodId() ?? getLiveKey();
  }

  function storageKey(id) {
    return `${STORAGE_PREFIX}${id}`;
  }

  function settingsKey(id) {
    return `${SETTINGS_PREFIX}${id}`;
  }

  function volumeKey(id) {
    return `${VOLUME_PREFIX}${id}`;
  }

  function clampVolume(value) {
    return Math.min(1, Math.max(0, Number.isFinite(value) ? value : 1));
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

  // Largest visible video (ties go to the first in document order), else the first video.
  function findMainVideo() {
    const videos = document.querySelectorAll("video");
    let best = null;
    let bestArea = 0;
    for (const video of videos) {
      const rect = video.getBoundingClientRect();
      if (rect.width > 100 && rect.height > 70 &&
          getComputedStyle(video).visibility !== "hidden") {
        const area = rect.width * rect.height;
        if (best === null || area > bestArea) {
          best = video;
          bestArea = area;
        }
      }
    }
    return best ?? videos[0] ?? null;
  }

  // ---------------------------- Volume memory ----------------------------

  function readVolumeState(video) {
    return { volume: clampVolume(video.volume), muted: Boolean(video.muted) };
  }

  function queueVolumeSave(context, state) {
    if (!context || active !== context || !context.volumeLoaded) return;

    const key = volumeKey(context.id);
    const snapshot = {
      volume: clampVolume(state.volume),
      muted: Boolean(state.muted),
      updatedAt: Date.now()
    };

    // Keep the in-memory preference current. Restore passes apply this value,
    // so a stale copy would put an old volume back over the viewer's choice.
    context.volumePreference = { volume: snapshot.volume, muted: snapshot.muted };

    // Keep volume writes independent from quality writes. This prevents a
    // rapid sequence of player events from replacing one another's settings.
    context.volumeWrite = (context.volumeWrite || Promise.resolve())
      .catch(() => {})
      .then(() => chrome.storage.local.set({ [key]: snapshot }))
      .then(() => console.info("[Kick VOD Resume] Volume saved", context.id, snapshot))
      .catch(error => console.warn("[Kick VOD Resume] Could not save volume:", error));
  }

  function rememberCurrentVolume(context, force = false) {
    if (!context || active !== context || !context.volumeLoaded) return;
    if (context.volumeRestorePending) return;

    const current = readVolumeState(context.video);
    const previous = context.lastVolumeState;
    const changed = force || !previous ||
      Math.abs(previous.volume - current.volume) > 0.001 ||
      previous.muted !== current.muted;

    // Our own writes are echoed back as volumechange events. applyVolumePreference
    // records the applied value first, so those echoes compare equal and are not saved.
    context.lastVolumeState = current;
    if (changed) queueVolumeSave(context, current);
  }

  function applyVolumePreference(context) {
    if (!context || active !== context || !context.volumeLoaded) return false;

    const { volume, muted } = context.volumePreference;

    try {
      if (Math.abs(context.video.volume - volume) > 0.001) context.video.volume = volume;
      if (context.video.muted !== muted) context.video.muted = muted;
      context.lastVolumeState = readVolumeState(context.video);
      return true;
    } catch (error) {
      console.warn("[Kick VOD Resume] Could not apply volume:", error);
      return false;
    }
  }

  function finishVolumeRestore(context) {
    if (!context || active !== context) return;
    for (const timer of context.volumeRestoreTimers || []) window.clearTimeout(timer);
    context.volumeRestoreTimers = [];
    context.volumeRestorePending = false;
    context.lastVolumeState = readVolumeState(context.video);
    console.info("[Kick VOD Resume] Volume restored", context.id, {
      preferred: context.volumePreference,
      actual: context.lastVolumeState
    });

    // Persist the preference, not a temporary value Kick may have applied
    // while mounting the player.
    queueVolumeSave(context, context.volumePreference);
  }

  function startVolumeRestore(context) {
    if (!context || active !== context || !context.volumeLoaded) return;
    if (context.volumeRestorePending || context.volumeRestorePasses >= VOLUME_RESTORE_PASSES) return;

    context.volumeRestorePasses += 1;
    context.volumeRestorePending = true;
    context.volumeRestoreTimers = [];

    // Apply right away, even while the video is still at HAVE_METADATA (a paused
    // VOD). Kick can initialize its internal player state after that, so
    // re-apply a few times; after that, normal user changes are saved immediately.
    const restoreAttempt = attempt => {
      if (active !== context || getVodId() !== context.id || !context.volumeRestorePending) return;
      applyVolumePreference(context);
      if (attempt >= VOLUME_RESTORE_RETRY_COUNT) {
        finishVolumeRestore(context);
        return;
      }
      const timer = window.setTimeout(
        () => restoreAttempt(attempt + 1), VOLUME_RESTORE_RETRY_MS
      );
      context.volumeRestoreTimers.push(timer);
    };

    restoreAttempt(0);
  }

  function isVolumeControl(target) {
    if (!(target instanceof Element)) return false;
    const control = target.closest('input[type="range"], [role="slider"], button');
    if (!control) return false;

    const details = [
      control.getAttribute("aria-label"),
      control.getAttribute("title"),
      control.getAttribute("data-testid"),
      control.getAttribute("name"),
      typeof control.className === "string" ? control.className : ""
    ].filter(Boolean).join(" ").toLowerCase();

    return /volume|mute|sound|audio/.test(details);
  }

  function noteVolumeInteraction(event) {
    if (!active || !active.volumeRestorePending || !isVolumeControl(event.target)) return;

    // Do not fight the viewer if they adjust the volume while the player is
    // initializing. End restoration and save the value they choose.
    finishVolumeRestore(active);
    rememberCurrentVolume(active, true);
  }

  document.addEventListener("input", noteVolumeInteraction, true);
  document.addEventListener("change", noteVolumeInteraction, true);
  document.addEventListener("pointerdown", noteVolumeInteraction, true);

  async function restorePlayerSettings(context) {
    if (context.settingsLoadStarted) return;
    context.settingsLoadStarted = true;

    try {
      const keys = [settingsKey(context.id), volumeKey(context.id), KEYS.appSettings];
      const result = await chrome.storage.local.get(keys);
      if (active !== context || getVodId() !== context.id) return;

      appSettings = normalizeSettings(result[KEYS.appSettings]);

      const oldSettings = result[settingsKey(context.id)];
      context.settings = oldSettings && typeof oldSettings === "object"
        ? { ...oldSettings }
        : {};
      context.settingsLoaded = true;

      // v1.2.2 stores volume under its own VOD key. Migrate the volume fields
      // written by earlier versions when no dedicated volume record exists.
      const savedVolume = result[volumeKey(context.id)];
      const legacyVolume = context.settings;
      const candidate = savedVolume && typeof savedVolume === "object"
        ? savedVolume
        : legacyVolume;
      context.volumePreference = {
        volume: clampVolume(candidate.volume),
        muted: typeof candidate.muted === "boolean" ? candidate.muted : false
      };
      context.volumeLoaded = true;
      console.info("[Kick VOD Resume] Volume preference loaded", context.id, context.volumePreference);

      startVolumeRestore(context);
      startQualityRestore(context);
    } catch (error) {
      if (active !== context) return;
      console.warn("[Kick VOD Resume] Could not load player settings:", error);
      context.settings = {};
      context.settingsLoaded = true;
      // The saved volume is unknown, so restore nothing and save nothing for this
      // VOD. Writing a default now would overwrite the viewer's real saved value.
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

  // allowBest=false: only ever restore a saved preference. If it can't be matched,
  // return null instead of falling back to the best quality.
  function chooseQuality(items, preferredKey, allowBest = true) {
    if (!items.length) return null;

    const preferred = typeof preferredKey === "string" ? preferredKey.toLowerCase() : "";

    if (preferred) {
      const exact = items.find(item => item.quality.key.toLowerCase() === preferred);
      if (exact) return exact;

      const preferredMatch = preferred.match(/^(\d{3,4})p(\d{0,3})$/);
      if (preferredMatch) {
        const wantedHeight = Number.parseInt(preferredMatch[1], 10);
        const wantedFps = Number.parseInt(preferredMatch[2] || "0", 10);
        const fixed = items.filter(item => item.quality.mode === "resolution");
        const belowOrEqual = fixed.filter(item => item.quality.height <= wantedHeight)
          .sort((a, b) => (b.quality.height - a.quality.height) ||
            (Math.abs(a.quality.fps - wantedFps) - Math.abs(b.quality.fps - wantedFps)));
        if (belowOrEqual.length) return belowOrEqual[0];
        if (fixed.length) {
          return fixed.sort((a, b) => (a.quality.height - b.quality.height) ||
            (a.quality.fps - b.quality.fps))[0];
        }
      }

      // If a saved preference is no longer available, fall back to the best option
      // (unless the "best quality" switch is off, in which case leave the quality alone).
      if (!allowBest) return null;
    }

    const source = items.find(item => item.quality.mode === "source");
    if (source) return source;

    const resolutions = items
      .filter(item => item.quality.mode === "resolution")
      .sort((a, b) => (b.quality.height - a.quality.height) ||
        (b.quality.fps - a.quality.fps));
    if (resolutions.length) return resolutions[0];

    return items.find(item => item.quality.mode === "auto") || null;
  }

  function playerSettingsButton(video) {
    const rect = video.getBoundingClientRect();
    const candidates = [...document.querySelectorAll('button[aria-haspopup="menu"], .z-controls button')]
      .filter(button => {
        if (button.closest("header") || button.closest('[data-testid="livestream-results-card"]')) return false;
        const bounds = button.getBoundingClientRect();
        return bounds.width > 0 && bounds.height > 0;
      });

    const distance = new Map(candidates.map(button => {
      const bounds = button.getBoundingClientRect();
      return [button, Math.hypot(
        rect.right - (bounds.left + bounds.width / 2),
        rect.bottom - (bounds.top + bounds.height / 2)
      )];
    }));
    const byDistance = (a, b) => distance.get(a) - distance.get(b);

    const labelled = candidates.filter(button => {
      const label = `${button.getAttribute("aria-label") || ""} ${button.getAttribute("title") || ""}`;
      return /settings|quality/i.test(label);
    }).sort(byDistance);
    if (labelled.length) return labelled[0];

    // Current Kick desktop player: settings is a menu button near the video.
    const desktopCandidates = candidates.filter(button => button.matches('button[aria-haspopup="menu"]'));
    if (desktopCandidates.length) {
      desktopCandidates.sort(byDistance);
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

  // ---------------------------- Scroll protection ----------------------------
  // A plain element.focus() scrolls that element into view. Our synthetic clicks
  // focus the settings button and the quality items, and Kick returns focus to the
  // settings button when the menu closes, so any of these could drag the page down.
  // We stop it two ways: focus with preventScroll, and (as a safety net) put the
  // scroll position back if it moved right after one of our own actions.

  function snapshotScroll(nodes) {
    const entries = [{ root: true, left: window.scrollX, top: window.scrollY }];
    const seen = new Set();
    for (let node of nodes) {
      for (; node instanceof Element; node = node.parentElement) {
        if (node === document.documentElement || seen.has(node)) continue;
        seen.add(node);
        entries.push({ el: node, left: node.scrollLeft, top: node.scrollTop });
      }
    }
    return entries;
  }

  function restoreScroll(entries) {
    for (const entry of entries) {
      const el = entry.root ? window : entry.el;
      const left = entry.root ? window.scrollX : el.scrollLeft;
      const top = entry.root ? window.scrollY : el.scrollTop;
      if (Math.abs(left - entry.left) > 1 || Math.abs(top - entry.top) > 1) {
        el.scrollTo({ left: entry.left, top: entry.top, behavior: "instant" });
      }
    }
  }

  function preserveScroll(nodes, action) {
    const snapshot = snapshotScroll(nodes);
    let userInput = false;
    const onUserInput = event => { if (event.isTrusted) userInput = true; };
    const onScroll = () => { if (!userInput) restoreScroll(snapshot); };
    const options = { capture: true, passive: true };

    for (const type of USER_INPUT_EVENTS) document.addEventListener(type, onUserInput, options);
    document.addEventListener("scroll", onScroll, options);

    try {
      action();
    } finally {
      onScroll();
    }

    // Kick may move focus (and so the page) a moment later, e.g. after a menu
    // close animation. Keep guarding briefly, then stand down.
    window.setTimeout(() => {
      onScroll();
      for (const type of USER_INPUT_EVENTS) document.removeEventListener(type, onUserInput, options);
      document.removeEventListener("scroll", onScroll, options);
    }, SCROLL_GUARD_MS);
  }

  function clickPlayerElement(element, video) {
    if (!element) return;
    preserveScroll([element, video], () => {
      element.focus?.({ preventScroll: true });
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
    });
  }

  function closeQualityMenu(video) {
    preserveScroll([video], () => {
      document.dispatchEvent(new KeyboardEvent("keydown", {
        key: "Escape",
        bubbles: true,
        composed: true
      }));
    });
  }

  function isQualityChecked(element) {
    return element.getAttribute("aria-checked") === "true" ||
      element.getAttribute("data-state") === "checked" ||
      element.getAttribute("aria-selected") === "true" ||
      element.checked === true;
  }

  function startQualityRestore(context) {
    if (!context || active !== context || context.qualityRestoreStarted) return;
    context.qualityRestoreStarted = true;

    // This exact player already had its quality picked during this visit.
    if (qualityHandled.get(context.video) === context.visit) {
      console.info("[Kick VOD Resume] Quality skipped, already picked for this player", context.id);
      context.qualityApplied = true;
      return;
    }

    let attempts = 0;
    let lastMenuClickAt = 0;
    let preferredKey = typeof context.settings.quality === "string"
      ? context.settings.quality
      : "";

    // The "best quality for new VODs" switch only covers VODs with no saved quality.
    // A saved quality is always restored, whatever the switch says. With the switch
    // off and nothing saved we stop here, without even opening Kick's settings menu.
    // A live stream has no saved quality, so only its own switch decides.
    const allowBest = context.live ? appSettings.kickLiveQuality : appSettings.kickBestQuality;
    if (!preferredKey && !allowBest) {
      console.info("[Kick VOD Resume] Quality: nothing saved and best-quality switch is off, leaving Kick's default", context.id);
      context.qualityApplied = true;
      return;
    }

    // If we opened the settings menu, close it unless Kick already did.
    const closeMenuIfLeftOpen = delay => window.setTimeout(() => {
      if (!context.qualityMenuOpen) return;
      context.qualityMenuOpen = false;
      if (getQualityItems().length) closeQualityMenu(context.video);
    }, delay);

    const tick = () => {
      if (active !== context || getPageKey() !== context.id || context.qualityApplied) return;
      attempts += 1;

      const items = getQualityItems();
      if (items.length) {
        const target = chooseQuality(items, preferredKey, allowBest);
        if (!target) {
          // The saved quality isn't offered for this VOD and the switch is off, so
          // there is nothing to pick. Close the menu if we opened it and stop.
          context.qualityApplied = true;
          qualityHandled.set(context.video, context.visit);
          console.info("[Kick VOD Resume] Quality: saved quality unavailable and best-quality switch is off", context.id, preferredKey);
          closeMenuIfLeftOpen(0);
          return;
        }

        // Done is decided before acting, so no later timer or re-bind can ever
        // select a second time. The quality is picked once, and never re-clicked
        // to "verify": a menu that updates its checked state late, or not in a
        // way we recognise, used to trigger a second pick.
        context.qualityApplied = true;
        qualityHandled.set(context.video, context.visit);

        const checked = items.find(item => isQualityChecked(item.element));
        if (checked?.element === target.element) {
          console.info("[Kick VOD Resume] Quality already set", context.id, target.quality.key);
          closeMenuIfLeftOpen(0);
        } else {
          console.info("[Kick VOD Resume] Quality selecting", context.id, target.quality.key);
          clickPlayerElement(target.element, context.video);
          closeMenuIfLeftOpen(MENU_CLOSE_CHECK_MS);
        }
        // This also makes the default best quality a remembered preference (a live
        // stream has no settings record, so nothing is saved for it).
        updateSettings(context, { quality: target.quality.key });
        return;
      } else {
        revealPlayerControls(context.video);
        const button = playerSettingsButton(context.video);
        // Open the settings menu once, then give it time to render its items
        // before trying the button again.
        if (button && Date.now() - lastMenuClickAt >= MENU_REOPEN_MS) {
          lastMenuClickAt = Date.now();
          context.qualityMenuOpen = true;
          clickPlayerElement(button, context.video);
        }
      }

      if (attempts >= QUALITY_RETRY_LIMIT) {
        console.info("[Kick VOD Resume] Quality: gave up, no menu items found", context.id);
        closeMenuIfLeftOpen(0);
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

  // Save whatever the active VOD has not saved yet (used when leaving it or the page).
  function flushActive() {
    if (!active || active.live) return;
    rememberCurrentVolume(active, true);
    savePosition(active, true, true);
  }

  function releaseActive() {
    if (!active) return;
    flushActive();
    window.clearInterval(active.volumePoll);
    for (const timer of active.volumeRestoreTimers || []) window.clearTimeout(timer);
    if (active.qualityMenuOpen) {
      active.qualityMenuOpen = false;
      closeQualityMenu(active.video);
    }
  }

  function bindVideo(video, id) {
    if (active?.id === id && active.video === video) return;
    releaseActive();

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
      qualityMenuOpen: false,
      visit: routeVisit,
      lastVolumeState: readVolumeState(video),
      volumeRestorePasses: 0,
      volumeRestorePending: false,
      volumeLoaded: false,
      volumePreference: { volume: 1, muted: false },
      volumeWrite: Promise.resolve(),
      volumeRestoreTimers: [],
      volumePoll: null
    };
    active = context;

    video.addEventListener("loadedmetadata", () => {
      restorePosition(context);
      restorePlayerSettings(context);
    });
    video.addEventListener("durationchange", () => {
      restorePosition(context);
      restorePlayerSettings(context);
    });
    video.addEventListener("canplay", () => {
      restorePlayerSettings(context);
      startVolumeRestore(context);
    });
    video.addEventListener("playing", () => startVolumeRestore(context));
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
    context.volumePoll = window.setInterval(() => rememberCurrentVolume(context), 300);
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

  // A live channel page: only the quality is handled, nothing is saved.
  async function bindLive(video, key) {
    if (active?.id === key && active.video === video) return;
    releaseActive();

    const context = {
      id: key,
      video,
      live: true,
      settings: {},
      visit: routeVisit,
      qualityRestoreStarted: false,
      qualityApplied: false,
      qualityMenuOpen: false
    };
    active = context;

    try {
      const result = await chrome.storage.local.get(KEYS.appSettings);
      appSettings = normalizeSettings(result[KEYS.appSettings]);
    } catch {
      // Keep the switches as they were.
    }
    startQualityRestore(context);
  }

  function scanPage() {
    const id = getPageKey();

    if (id !== pageKey) {
      releaseActive();
      active = null;
      pageKey = id;
      routeVisit += 1;
      // Give Kick's SPA player a moment to switch sources after navigation.
      bindNotBefore = Date.now() + 800;
    }

    if (!id || Date.now() < bindNotBefore) return;

    const video = findMainVideo();
    if (!video) return;
    if (id.startsWith(LIVE_PREFIX)) bindLive(video, id);
    else bindVideo(video, id);
  }

  // Chat and other page churn produce constant DOM mutations. Only a <video>
  // being added or removed, or a URL change, can change which VOD is bound;
  // the one-second poll below covers the rest, so other mutations are skipped.
  const touchesVideo = mutation => [...mutation.addedNodes, ...mutation.removedNodes].some(node =>
    node instanceof Element && (node.tagName === "VIDEO" || node.querySelector("video") !== null)
  );
  const observer = new MutationObserver(mutations => {
    if (getPageKey() !== pageKey || mutations.some(touchesVideo)) scanPage();
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });

  // Kick is a single-page app, so also check for URL changes that don't replace the page.
  window.setInterval(scanPage, 1_000);

  window.addEventListener("pagehide", flushActive);

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") flushActive();
  });

  // Keep the switches current when they are changed in the popup while Kick is open.
  // A change applies to the next VOD that gets opened.
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === "local" && changes[KEYS.appSettings]) {
      appSettings = normalizeSettings(changes[KEYS.appSettings].newValue);
    }
  });

  scanPage();
})();
