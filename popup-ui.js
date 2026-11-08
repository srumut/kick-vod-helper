// Tabs and the Settings panel. The Kick VOD records panel is handled by popup.js.
(() => {
  "use strict";

  const { KEYS, TABS, normalizeSettings } = globalThis.KickXShared;

  const tabButtons = [...document.querySelectorAll('[role="tab"]')];
  const panels = [...document.querySelectorAll(".tab-panel")];
  const switches = [...document.querySelectorAll("input[data-setting]")];

  // ------------------------------------------------------------------ Tabs

  function showTab(name) {
    if (!TABS.includes(name)) name = TABS[0];
    for (const tab of tabButtons) {
      const selected = tab.dataset.tab === name;
      tab.setAttribute("aria-selected", String(selected));
      tab.tabIndex = selected ? 0 : -1;
    }
    for (const panel of panels) panel.hidden = panel.dataset.panel !== name;
    return name;
  }

  // Selecting a tab also remembers it, so the popup reopens on the same tab.
  function selectTab(name, { focus = false } = {}) {
    const shown = showTab(name);
    if (focus) tabButtons.find(tab => tab.dataset.tab === shown)?.focus();
    chrome.storage.local.set({ [KEYS.popupState]: { activeTab: shown } }).catch(() => {});
  }

  for (const tab of tabButtons) {
    tab.addEventListener("click", () => selectTab(tab.dataset.tab));
  }

  // Standard tablist keyboard support: arrows move between tabs, Home/End jump.
  document.querySelector('[role="tablist"]').addEventListener("keydown", event => {
    const index = tabButtons.findIndex(tab => tab.getAttribute("aria-selected") === "true");
    let next = null;
    if (event.key === "ArrowRight") next = (index + 1) % tabButtons.length;
    else if (event.key === "ArrowLeft") next = (index - 1 + tabButtons.length) % tabButtons.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = tabButtons.length - 1;
    if (next === null) return;
    event.preventDefault();
    selectTab(tabButtons[next].dataset.tab, { focus: true });
  });

  // -------------------------------------------------------------- Settings

  function showSettings(settings) {
    for (const input of switches) input.checked = Boolean(settings[input.dataset.setting]);
  }

  // Writes are queued and merge into whatever is stored at that moment, so two quick
  // toggles can't overwrite each other.
  let writeQueue = Promise.resolve();
  function saveSetting(key, value) {
    writeQueue = writeQueue
      .then(async () => {
        const stored = await chrome.storage.local.get(KEYS.appSettings);
        const next = { ...normalizeSettings(stored[KEYS.appSettings]), [key]: value };
        await chrome.storage.local.set({ [KEYS.appSettings]: next });
      })
      .catch(async () => {
        // The write failed, so put the switches back to what is actually stored.
        try {
          const stored = await chrome.storage.local.get(KEYS.appSettings);
          showSettings(normalizeSettings(stored[KEYS.appSettings]));
        } catch { /* nothing more to do */ }
      });
  }

  for (const input of switches) {
    input.addEventListener("change", () => saveSetting(input.dataset.setting, input.checked));
  }

  // Open each description below its row, unless it would stick out past the bottom of
  // the popup (which makes the popup grow), in which case open it above instead.
  const TOOLTIP_GAP = 6;
  function placeTooltip(row) {
    const tip = row.querySelector(".tooltip");
    if (!tip) return;
    row.classList.remove("tip-above");
    const appBottom = document.querySelector(".app").getBoundingClientRect().bottom;
    const needed = row.getBoundingClientRect().bottom + TOOLTIP_GAP + tip.offsetHeight;
    if (needed > appBottom) row.classList.add("tip-above");
  }
  for (const row of document.querySelectorAll(".setting-row")) {
    row.addEventListener("pointerenter", () => placeTooltip(row));
    row.addEventListener("focusin", () => placeTooltip(row));
  }

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === "local" && changes[KEYS.appSettings]) {
      showSettings(normalizeSettings(changes[KEYS.appSettings].newValue));
    }
  });

  // ------------------------------------------------------------------ Init

  async function init() {
    let settings = normalizeSettings(null);
    let activeTab = TABS[0];
    try {
      const stored = await chrome.storage.local.get([KEYS.appSettings, KEYS.popupState]);
      settings = normalizeSettings(stored[KEYS.appSettings]);
      const remembered = stored[KEYS.popupState]?.activeTab;
      if (TABS.includes(remembered)) activeTab = remembered;
    } catch {
      // Storage unavailable: show the defaults and the first tab.
    }
    showSettings(settings);
    showTab(activeTab); // every panel is hidden until this runs, so there is no flash of the wrong tab
  }

  init();
})();
