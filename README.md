# Kick VOD Resume

A small Chromium extension that remembers where you stopped watching each Kick VOD.

## Install (Chrome / Chromium / Brave)

1. Extract this folder somewhere permanent.
2. Open `chrome://extensions` (or `brave://extensions` in Brave).
3. Enable **Developer mode**.
4. Click **Load unpacked**.
5. Select the extracted `kick-vod-resume` folder (the folder containing `manifest.json`).

## Use

Open a Kick VOD and watch normally. The extension saves your position while you watch and when you pause, switch tabs, or leave the page. Reload the VOD or return to it later, and it will seek back to your saved position.

Progress is stored separately for each VOD. Positions within the final 12 seconds are cleared so a completed VOD does not keep resuming at the end.

## Privacy

The extension uses `chrome.storage.local`. Playback positions stay in this browser profile and are not sent to Kick or any other server. The extension does not need access to your browsing history or account data.

## Notes

- Supports Kick VOD URLs such as `https://kick.com/channel/videos/<video-id>` and `/video/<video-id>`.
- It does not track live streams or clips.
- This is a minimal extension; Kick changing its player implementation could require an update.
