(() => {
  "use strict";

  const STORAGE_PREFIX = "kick-vod-resume:";
  const SETTINGS_PREFIX = "kick-vod-settings:";
  const videoList = document.getElementById("videoList");
  const selectAll = document.getElementById("selectAll");
  const deleteSelected = document.getElementById("deleteSelected");
  const itemCount = document.getElementById("itemCount");
  const refreshButton = document.getElementById("refreshButton");

  let entries = [];
  const selected = new Set();

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
    // Only open Kick URLs. Older entries may not have a saved URL yet.
    try {
      const url = new URL(saved.url || `https://kick.com/video/${id}`);
      if (url.protocol === "https:" && (url.hostname === "kick.com" || url.hostname === "www.kick.com")) {
        return url.href;
      }
    } catch {
      // Fall through to the canonical Kick VOD URL.
    }
    return `https://kick.com/video/${id}`;
  }

  function getTitle(id, saved) {
    const title = typeof saved.title === "string" ? saved.title.trim() : "";
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
    return `Watched ${new Intl.DateTimeFormat(undefined, {
      month: "short", day: "numeric", hour: "numeric", minute: "2-digit"
    }).format(new Date(timestamp))}`;
  }

  function makeSvg(pathMarkup) {
    const wrapper = document.createElement("span");
    wrapper.innerHTML = `<svg viewBox="0 0 24 24" fill="none" aria-hidden="true">${pathMarkup}</svg>`;
    return wrapper.firstElementChild;
  }

  function createEntry(id, saved) {
    const duration = Number.isFinite(saved.duration) && saved.duration > 0 ? saved.duration : 0;
    const time = Number.isFinite(saved.time) && saved.time >= 0 ? saved.time : 0;
    const percent = duration > 0 ? Math.min(100, Math.max(0, time / duration * 100)) : 0;
    const url = getVideoUrl(id, saved);

    const card = document.createElement("article");
    card.className = `video-card${selected.has(id) ? " selected" : ""}`;

    const checkWrap = document.createElement("label");
    checkWrap.className = "card-check";
    checkWrap.title = "Select this VOD";
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = selected.has(id);
    checkbox.setAttribute("aria-label", `Select ${getTitle(id, saved)}`);
    checkbox.addEventListener("change", () => {
      if (checkbox.checked) selected.add(id);
      else selected.delete(id);
      render();
    });
    checkWrap.append(checkbox);

    const main = document.createElement("div");
    main.className = "card-main";

    const title = document.createElement("a");
    title.className = "video-title";
    title.href = url;
    title.target = "_blank";
    title.rel = "noopener noreferrer";
    title.title = getTitle(id, saved);
    title.textContent = getTitle(id, saved);

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

    main.append(title, meta, track);

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
    description.textContent = "Watch a Kick VOD and your playback position will appear here.";
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

    itemCount.textContent = `${entries.length} ${entries.length === 1 ? "video" : "videos"}`;
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

  async function loadEntries() {
    try {
      const all = await chrome.storage.local.get(null);
      entries = Object.entries(all).filter(([key]) => key.startsWith(STORAGE_PREFIX))
        .map(([key, value]) => [key.slice(STORAGE_PREFIX.length), value]);
      render();
    } catch {
      videoList.textContent = "Couldn't read saved progress. Try reloading the extension.";
    }
  }

  selectAll.addEventListener("change", () => {
    if (selectAll.checked) entries.forEach(([id]) => selected.add(id));
    else selected.clear();
    render();
  });

  deleteSelected.addEventListener("click", async () => {
    const idsToDelete = [...selected];
    if (idsToDelete.length === 0) return;
    const keys = idsToDelete.flatMap(id => [
      `${STORAGE_PREFIX}${id}`,
      `${SETTINGS_PREFIX}${id}`
    ]);
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

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== "local") return;
    if (Object.keys(changes).some(key => key.startsWith(STORAGE_PREFIX))) loadEntries();
  });

  loadEntries();
})();
