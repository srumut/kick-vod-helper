// The saved-progress tabs: one list for Kick VODs and one for YouTube videos. Both read
// the same store; YouTube records have ids that start with "yt-". Each list keeps its
// own selection, so Select all and Delete selected only ever touch the tab you're on.
(() => {
  "use strict";

  const STORAGE_PREFIX = "kick-vod-resume:";
  const SETTINGS_PREFIX = "kick-vod-settings:";
  const VOLUME_PREFIX = "kick-vod-volume:";
  const YOUTUBE_ID_PREFIX = "yt-";
  const OPENABLE_HOSTS = ["kick.com", "www.kick.com", "www.youtube.com"];

  const dateFormatter = new Intl.DateTimeFormat(undefined, {
    month: "short", day: "numeric", hour: "numeric", minute: "2-digit"
  });

  const isYouTubeId = id => id.startsWith(YOUTUBE_ID_PREFIX);

  function formatTime(totalSeconds) {
    const seconds = Math.max(0, Math.floor(totalSeconds || 0));
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const remainder = seconds % 60;
    return hours > 0
      ? `${hours}:${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`
      : `${minutes}:${String(remainder).padStart(2, "0")}`;
  }

  function getVideoUrl(id, saved) {
    // The canonical page for a record whose saved URL is missing or not one we open.
    const fallback = isYouTubeId(id)
      ? `https://www.youtube.com/watch?v=${encodeURIComponent(id.slice(YOUTUBE_ID_PREFIX.length))}`
      : `https://kick.com/video/${id}`;
    // Only open Kick and YouTube URLs. Older entries may not have a saved URL yet.
    try {
      const url = new URL(saved.url || fallback);
      if (url.protocol === "https:" && OPENABLE_HOSTS.includes(url.hostname)) return url.href;
    } catch {
      // Fall through to the canonical URL.
    }
    return fallback;
  }

  function getTitle(id, saved) {
    const title = typeof saved.title === "string" ? saved.title.trim() : "";
    if (isYouTubeId(id)) return title || `YouTube video ${id.slice(YOUTUBE_ID_PREFIX.length)}`;
    if (title && title.toLowerCase() !== "kick") return title;

    try {
      const url = new URL(getVideoUrl(id, saved));
      const parts = url.pathname.split("/").filter(Boolean);
      const videosIndex = parts.indexOf("videos");
      if (videosIndex > 0) return `${parts[videosIndex - 1]} — Kick VOD`;
    } catch { /* use ID below */ }

    return `Kick VOD ${id.slice(0, 8)}`;
  }

  function formatDate(timestamp) {
    if (!Number.isFinite(timestamp) || timestamp <= 0) return "Saved progress";
    return `Watched ${dateFormatter.format(new Date(timestamp))}`;
  }

  function makeSvg(pathMarkup) {
    const wrapper = document.createElement("span");
    wrapper.innerHTML = `<svg viewBox="0 0 24 24" fill="none" aria-hidden="true">${pathMarkup}</svg>`;
    return wrapper.firstElementChild;
  }

  // config: { panel, noun, accepts(id), extraKeys(id), emptyText }
  function createRecordsList(config) {
    const panel = document.querySelector(`[data-panel="${config.panel}"]`);
    const part = name => panel.querySelector(`[data-role="${name}"]`);
    const videoList = part("list");
    const selectAll = part("select-all");
    const deleteSelected = part("delete");
    const itemCount = part("count");
    const refreshButton = part("refresh");

    let entries = [];
    const selected = new Set();

    function createEntry(id, saved) {
      const duration = Number.isFinite(saved.duration) && saved.duration > 0 ? saved.duration : 0;
      const time = Number.isFinite(saved.time) && saved.time >= 0 ? saved.time : 0;
      const percent = duration > 0 ? Math.min(100, Math.max(0, time / duration * 100)) : 0;
      const url = getVideoUrl(id, saved);
      const title = getTitle(id, saved);

      const card = document.createElement("article");
      card.className = `video-card${selected.has(id) ? " selected" : ""}`;

      const checkWrap = document.createElement("label");
      checkWrap.className = "card-check";
      checkWrap.title = `Select this ${config.noun}`;
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.checked = selected.has(id);
      checkbox.setAttribute("aria-label", `Select ${title}`);
      checkbox.addEventListener("change", () => {
        if (checkbox.checked) selected.add(id);
        else selected.delete(id);
        render();
      });
      checkWrap.append(checkbox);

      const main = document.createElement("div");
      main.className = "card-main";

      const link = document.createElement("a");
      link.className = "video-title";
      link.href = url;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      link.title = title;
      link.textContent = title;

      const meta = document.createElement("div");
      meta.className = "video-meta";
      const timeLabel = document.createElement("span");
      timeLabel.textContent = `${formatTime(time)}${duration ? ` / ${formatTime(duration)}` : " watched"}`;
      const dateLabel = document.createElement("span");
      dateLabel.textContent = formatDate(saved.updatedAt);
      meta.append(timeLabel, dateLabel);

      const track = document.createElement("div");
      track.className = "progress-track";
      track.setAttribute("role", "progressbar");
      track.setAttribute("aria-label", "Watch progress");
      track.setAttribute("aria-valuemin", "0");
      track.setAttribute("aria-valuemax", "100");
      track.setAttribute("aria-valuenow", String(Math.round(percent)));
      const fill = document.createElement("div");
      fill.className = "progress-fill";
      fill.style.width = `${percent}%`;
      track.append(fill);

      main.append(link, meta, track);

      const side = document.createElement("div");
      side.className = "card-side";
      const watch = document.createElement("button");
      watch.className = "watch-button";
      watch.type = "button";
      watch.append(makeSvg('<path d="m8 5 11 7-11 7V5Z" fill="currentColor"/>'));
      watch.append(document.createTextNode("Watch"));
      watch.addEventListener("click", () => chrome.tabs.create({ url }));
      const percentLabel = document.createElement("span");
      percentLabel.className = "percent";
      percentLabel.textContent = `${Math.round(percent)}%`;
      side.append(watch, percentLabel);

      card.append(checkWrap, main, side);
      return card;
    }

    function renderEmpty() {
      const empty = document.createElement("div");
      empty.className = "empty-state";
      const icon = document.createElement("div");
      icon.className = "empty-icon";
      icon.append(makeSvg('<rect x="4" y="5" width="16" height="14" rx="2" stroke="currentColor" stroke-width="1.7"/><path d="m10 9 5 3-5 3V9Z" fill="currentColor"/>'));
      const heading = document.createElement("strong");
      heading.textContent = "No saved progress yet";
      const description = document.createElement("span");
      description.textContent = config.emptyText;
      empty.append(icon, heading, description);
      videoList.replaceChildren(empty);
    }

    function render() {
      entries = entries.filter(([id, saved]) =>
        saved && typeof saved === "object" && Number.isFinite(saved.time) && saved.time >= 0
      );
      entries.sort((a, b) => (b[1].updatedAt || 0) - (a[1].updatedAt || 0));

      const ids = new Set(entries.map(([id]) => id));
      for (const id of selected) if (!ids.has(id)) selected.delete(id);

      itemCount.textContent = `${entries.length} ${config.noun}${entries.length === 1 ? "" : "s"}`;
      deleteSelected.disabled = selected.size === 0;
      selectAll.disabled = entries.length === 0;
      selectAll.checked = entries.length > 0 && selected.size === entries.length;
      selectAll.indeterminate = selected.size > 0 && selected.size < entries.length;

      if (entries.length === 0) {
        renderEmpty();
        return;
      }
      videoList.replaceChildren(...entries.map(([id, saved]) => createEntry(id, saved)));
    }

    selectAll.addEventListener("change", () => {
      if (selectAll.checked) entries.forEach(([id]) => selected.add(id));
      else selected.clear();
      render();
    });

    deleteSelected.addEventListener("click", async () => {
      const idsToDelete = [...selected];
      if (idsToDelete.length === 0) return;
      const keys = idsToDelete.flatMap(id => [`${STORAGE_PREFIX}${id}`, ...config.extraKeys(id)]);
      deleteSelected.disabled = true;
      try {
        await chrome.storage.local.remove(keys);
        idsToDelete.forEach(id => selected.delete(id));
        await loadEntries();
      } catch {
        deleteSelected.disabled = false;
      }
    });

    refreshButton.addEventListener("click", loadEntries);

    return {
      accepts: config.accepts,
      setEntries(next) {
        entries = next;
        render();
      },
      showError() {
        videoList.textContent = "Couldn't read saved progress. Try reloading the extension.";
      }
    };
  }

  const lists = [
    createRecordsList({
      panel: "kick-records",
      noun: "VOD",
      accepts: id => !isYouTubeId(id),
      // A Kick VOD also has a saved quality and volume, which go with it.
      extraKeys: id => [`${SETTINGS_PREFIX}${id}`, `${VOLUME_PREFIX}${id}`],
      emptyText: "Watch a Kick VOD and your playback position will appear here."
    }),
    createRecordsList({
      panel: "youtube-records",
      noun: "video",
      accepts: isYouTubeId,
      extraKeys: () => [],
      emptyText: "Watch a YouTube video and your playback position will appear here."
    })
  ];

  // One read of the store feeds every list.
  async function loadEntries() {
    try {
      const all = await chrome.storage.local.get(null);
      const records = Object.entries(all)
        .filter(([key]) => key.startsWith(STORAGE_PREFIX))
        .map(([key, value]) => [key.slice(STORAGE_PREFIX.length), value]);
      for (const list of lists) list.setEntries(records.filter(([id]) => list.accepts(id)));
    } catch {
      for (const list of lists) list.showError();
    }
  }

  document.getElementById("appVersion").textContent = `v${chrome.runtime.getManifest().version}`;

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== "local") return;
    if (Object.keys(changes).some(key => key.startsWith(STORAGE_PREFIX))) loadEntries();
  });

  loadEntries();
})();
