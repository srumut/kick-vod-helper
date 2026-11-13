# Kick VOD Resume

A small Chromium extension that remembers where you stopped watching each Kick VOD and YouTube video, and provides a popup to manage saved progress. It also picks the highest available video quality on Kick live streams, X (Twitter), YouTube (up to a limit you choose) and Twitch, and can hide the chat on Kick, YouTube and Twitch.

## Install (Chrome / Chromium / Brave)

1. Extract this folder somewhere permanent.
2. Open `chrome://extensions` (or `brave://extensions` in Brave).
3. Enable **Developer mode**.
4. Click **Load unpacked**.
5. Select the extracted `kick-vod-resume` folder (the folder containing `manifest.json`).

Requires Chrome / Chromium / Brave / Edge 111 or newer (the X feature needs it).

## Use

Open a Kick VOD and watch normally. The extension saves your position every few seconds and when you pause, switch tabs, or leave the page. Reload the VOD or return to it later, and it will seek back to your saved position.

It also remembers the volume (including mute state) and quality separately for each VOD. Volume and mute state are stored in a dedicated local record for each VOD, separately from quality. They are restored while Kick initializes the player, and changes are captured through the media element's `volumechange` event plus a polling fallback. A VOD with no saved player preferences starts at 100% volume, unmuted, and the highest quality option Kick makes available. You can change either setting using Kick's normal player controls; the extension remembers your choice for that VOD.

Click the extension icon to open the popup. It has three tabs, and it reopens on whichever tab you used last:

- **Settings**: switches and dropdowns, listed under the app they belong to (X, Kick, YouTube, Twitch). Hover one to see what it does.
- **Kick**: your saved Kick VOD progress.
- **YouTube**: your saved YouTube progress.

Each of the Kick and YouTube tabs shows its saved videos with the last saved position, total duration, and approximate completion percentage. Tick one or more entries (or **Select all**, which only covers the tab you are on) and click **Delete selected** to remove their progress (for Kick VODs, also the saved quality and volume), or click **Watch** to open that video.

Progress is stored separately for each VOD. Positions within the final 12 seconds are cleared so a completed VOD does not keep resuming at the end. Player preferences are stored independently so they survive a completed/restarted resume point.

## Privacy

The extension uses `chrome.storage.local`. Playback positions, player preferences, your settings and the last-used popup tab stay in this browser profile and are not sent to Kick, YouTube or any other server. The extension does not need access to your browsing history or account data.

## Notes

- Supports Kick VOD URLs such as `https://kick.com/channel/videos/<video-id>` and `/video/<video-id>`.
- It does not track live streams (Kick or YouTube) or clips.
- Existing saved progress from earlier versions is still supported.
- Quality restoration uses Kick's own player settings menu. Kick changing its player implementation could require an update.


### Volume storage (v1.2.2)

Volume and mute state are stored in a dedicated `kick-vod-volume:<vod-id>` record, separate from quality preferences. Older volume values are migrated automatically from the v1.2.0/v1.2.1 settings record. The extension reapplies the saved value during the player initialization window and then saves subsequent changes from `volumechange` events plus a polling fallback.

### Quality selection and scrolling (v1.2.4)

The best (or saved) quality is now selected **once** per VOD load. Earlier versions re-clicked the quality item when Kick's menu did not report the new selection quickly or in a way the extension recognised, which showed up as the quality being picked twice. The extension no longer re-clicks to verify, and it never re-picks on the same player element within one visit. Leaving the VOD page and opening a VOD again starts a new visit, so the quality is picked again even if Kick reuses the same player element (v1.2.5; v1.2.4 wrongly skipped this).

Selecting a quality used to call a plain `focus()` on Kick's menu elements, which makes the browser scroll the page to reveal them. Focus is now taken with `preventScroll`, and as a safety net any page scroll caused by the extension's own clicks (including Kick returning focus to the settings button) is undone within the next moment. Scrolling you do yourself is never touched.

The console (`[Kick VOD Resume] Quality ...`) logs each selection, so you can verify there is exactly one per VOD load.

### Settings tab and X max video quality (v1.3.0)

The popup has a **Settings** tab with one switch per feature, grouped under each app. Both are on by default, which matches how earlier versions behaved. Changes apply to the next video you open, with no page reload needed.

**X: Max video quality.** X streams video over HLS: the player downloads a playlist of quality levels and switches between them automatically. On x.com / twitter.com the extension rewrites that playlist so only the highest level is offered, so the player can't drop to a lower one. It can only pick the best quality the uploader provided (a 480p upload stays 480p), and it uses more data. To cap the quality instead (say 1080p), change `MAX_HEIGHT` at the top of `x-max-quality.js`. Open the page console to see `[X Max Quality] picked ...` for each video. X can change its player at any time, which could require an update.

**Kick: Best quality for new VODs.** When on, the best available quality is picked for a VOD you have not saved a quality for yet (this is the behaviour from v1.2.x). When off, such VODs are left on Kick's own default, and the extension does not even open the player's settings menu. A quality you have chosen (or that was saved earlier) is restored either way, and if it is not offered for that VOD while the switch is off, the quality is left alone instead of jumping to the best one.

### Live streams, YouTube and Twitch (v1.4.0)

Four new switches on the Settings tab, all on by default. Like the others, a change applies to the next video you open, with no page reload.

**Kick: Best quality for live streams.** On a channel page (`kick.com/<channel>`) the highest quality Kick offers is picked once per visit, through the same player menu the VOD feature uses. Nothing is saved for live streams, and the VOD behaviour is unchanged. When off, live streams stay on Kick's default.

**YouTube: Best quality up to 1080p** (since v1.5.0 this is a dropdown with a choice of limit, see above). For every video and live stream the highest quality that is not above 1080p is picked through the player's own API (`setPlaybackQualityRange`), once per video, after any ad has finished. A quality you pick yourself afterwards is left alone for that video. 1080p Premium is not used. Open the page console to see `[YouTube Quality] <video id>: <level>` for each video. YouTube can change its player at any time, which could require an update.

**YouTube: Remember position.** Saves where you stopped on `youtube.com/watch` videos and jumps back there next time, using the same rules as Kick VODs (nothing in the last 12 seconds, nothing in the first 3). It is skipped for live streams, Shorts, ads, and links that already carry a timestamp (`&t=`), and it does not move a video YouTube has already resumed itself. Positions are stored beside the Kick ones (ids start with `yt-`), so they show up in the **YouTube** tab and can be deleted there.

**Twitch: Best quality.** Twitch starts its player in the quality saved in `localStorage` (`video-quality`; `chunked` means Source, the highest the streamer offers). The extension writes that before the player starts and again whenever Twitch opens another page. Turning the switch off stops this but does not undo it: Twitch keeps Source until you pick another quality in its player menu. If Twitch ever stops honouring that setting, the switch will have no effect until the extension is updated.

### Separate Kick and YouTube tabs, quality limit, chat switches (v1.5.0)

**Saved progress is split in two.** What used to be one **Saved progress** tab is now a **Kick** tab and a **YouTube** tab. Each has its own list, **Select all**, item count and **Delete selected**, so deleting in one never touches the other. Nothing about how records are stored changed (YouTube ids still start with `yt-`), so your existing progress shows up in the right tab.

**YouTube: Best quality up to (replaces the 1080p switch).** A dropdown: **Off**, 144p, 240p, 360p, 480p, 720p, 1080p, 1440p (2K), 2160p (4K), 4320p (8K). Off leaves YouTube's automatic quality alone. Otherwise the highest quality that is not above your limit is picked, once per video, after any ad. A video only offers the levels it was uploaded in, so a limit above what it has just gives its best, and a limit below everything it offers gives its lowest. The default is 1080p, as before, and if you had switched the old 1080p option off it stays off. Note that 8K only exists for videos uploaded in 8K; the player API reports it as `highres`.

**Disable chat (Kick, YouTube, Twitch).** One switch per site, all **off** by default, so chat is shown unless you turn one on. Each applies to both live chat and VOD / replay chat on that site. Hiding and showing chat is immediate, with no reload.

- **Kick** and **Twitch**: the chat container is hidden with CSS (`display: none`), so the browser no longer lays out or paints messages. That is usually the largest cost of a busy chat (many messages a second, emotes, animated emotes). The page's own code still receives messages in the background, so the saving is rendering work, not network or script work. On Kick the video area expands into the freed space.
- **YouTube**: the chat column is hidden, and the chat itself (an iframe at `youtube.com/live_chat`) is stopped before it loads, so its scripts never run and no messages are downloaded or drawn. This takes effect from the next video you open or the next page load; turning the switch off reloads the chat frame straight away. A chat window you pop out yourself is left alone.
- **X** is not included: X's live-video chat could not be checked, and a switch that silently did nothing would be worse than none.

The chat selectors live in one list at the top of `chat-hide.js` (`SITES`). These sites rename their elements now and then; if a switch stops hiding the chat, open DevTools on the chat panel and add its selector there. Currently: Twitch `.right-column`, Kick `#channel-chatroom`, YouTube `#chat-container` and `ytd-live-chat-frame#chat`.

### Files (v1.5.0)

- `shared.js`: setting names, defaults, the YouTube quality choices and the tab names, used by the popup and the content scripts.
- `popup-ui.js`: tabs and the Settings panel (`popup.js` handles the Kick and YouTube record lists).
- `x-max-quality.js`: runs in the page's own context on X and rewrites the video playlist.
- `youtube-quality.js`: runs in the page's own context on YouTube and sets the quality, up to your limit, through the player API.
- `chat-hide.js`: hides the chat on Twitch, Kick and YouTube when that site's **Disable chat** switch is on (selectors in `SITES` at the top).
- `youtube-chat-frame.js`: runs inside YouTube's embedded chat frame and stops it from loading when **Disable chat** is on.
- `settings-bridge.js`: passes the settings from extension storage to those two page scripts (as `data-*` attributes on `<html>`).
- `youtube-resume.js`: saves and restores the position of YouTube videos.
- `twitch-quality.js`: sets Twitch's saved quality to Source.
- `icons/icon-*.png`: the extension icon (Kick, X, YouTube and Twitch in a 2x2 grid; `icons/icon.svg` is the source); `icons/kick-*`, `icons/x-*`, `icons/youtube-*` and `icons/twitch-*` are the individual app icons.
