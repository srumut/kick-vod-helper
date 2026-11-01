# Kick VOD Resume

A small Chromium extension that remembers where you stopped watching each Kick VOD and provides a popup to manage saved progress.

## Install (Chrome / Chromium / Brave)

1. Extract this folder somewhere permanent.
2. Open `chrome://extensions` (or `brave://extensions` in Brave).
3. Enable **Developer mode**.
4. Click **Load unpacked**.
5. Select the extracted `kick-vod-resume` folder (the folder containing `manifest.json`).

## Use

Open a Kick VOD and watch normally. The extension saves your position every few seconds and when you pause, switch tabs, or leave the page. Reload the VOD or return to it later, and it will seek back to your saved position.

It also remembers the volume (including mute state) and quality separately for each VOD. A VOD with no saved player preferences starts at 100% volume, unmuted, and the highest quality option Kick makes available. You can change either setting using Kick's normal player controls; the extension remembers your choice for that VOD.

Click the extension icon to open the progress manager. It shows each saved VOD, its last saved position, total duration, and approximate completion percentage. Select one or more entries and click **Delete selected** to remove their progress and saved player preferences, or click **Watch** to open that VOD.

Progress is stored separately for each VOD. Positions within the final 12 seconds are cleared so a completed VOD does not keep resuming at the end. Player preferences are stored independently so they survive a completed/restarted resume point.

## Privacy

The extension uses `chrome.storage.local`. Playback positions and player preferences stay in this browser profile and are not sent to Kick or any other server. The extension does not need access to your browsing history or account data.

## Notes

- Supports Kick VOD URLs such as `https://kick.com/channel/videos/<video-id>` and `/video/<video-id>`.
- It does not track live streams or clips.
- Existing saved progress from earlier versions is still supported.
- Quality restoration uses Kick's own player settings menu. Kick changing its player implementation could require an update.
