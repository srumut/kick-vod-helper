/*
 * X Max Video Quality (page context)
 *
 * X streams video via HLS. The player first downloads a "master playlist"
 * (video.twimg.com/....m3u8) that lists every quality level, then picks one
 * adaptively. We intercept that playlist and strip every level except the best
 * one, so the player can only choose the best quality.
 *
 * This runs in the page's own JS context (world: "MAIN") so it can wrap fetch()
 * and XMLHttpRequest before X's code uses them. Because the MAIN world has no
 * access to chrome.storage, the on/off setting is handed over by
 * settings-bridge.js as an attribute on <html>.
 */
(() => {
  'use strict';

  // ---- Settings -----------------------------------------------------------
  // Highest video height to allow. Infinity = always the best available.
  // Set to e.g. 1080 or 720 if you want to cap it.
  const MAX_HEIGHT = Infinity;
  // Written by settings-bridge.js: "on" or "off".
  const SETTING_ATTR = 'data-x-max-quality';
  // -------------------------------------------------------------------------

  const PLAYLIST_URL = /video\.twimg\.com\/.*\.m3u8/i;

  // true / false once the bridge has reported, null while it hasn't yet.
  function readSetting() {
    const root = document.documentElement;
    const value = root && root.getAttribute(SETTING_ATTR);
    return value === 'on' ? true : value === 'off' ? false : null;
  }

  // The bridge reads storage asynchronously, so a playlist request that fires very
  // early waits briefly (max ~0.5 s) for the answer. If none arrives, default to on.
  async function isEnabled() {
    let setting = readSetting();
    for (let i = 0; setting === null && i < 20; i++) {
      await new Promise((resolve) => setTimeout(resolve, 25));
      setting = readSetting();
    }
    return setting !== false;
  }

  const attr = (line, name) => {
    const m = line.match(new RegExp('[:,]' + name + '=("([^"]*)"|[^,]*)'));
    return m ? (m[2] !== undefined ? m[2] : m[1]) : null;
  };

  function rewriteMaster(text) {
    if (typeof text !== 'string' || !text.includes('#EXT-X-STREAM-INF')) return text;

    const lines = text.split(/\r?\n/);
    const variants = [];

    for (let i = 0; i < lines.length; i++) {
      if (!lines[i].startsWith('#EXT-X-STREAM-INF:')) continue;
      let j = i + 1;
      while (j < lines.length && (lines[j].trim() === '' || lines[j].startsWith('#'))) j++;
      if (j >= lines.length) continue;

      const res = attr(lines[i], 'RESOLUTION');
      const [w, h] = res ? res.split('x').map(Number) : [0, 0];
      variants.push({
        infoIdx: i,
        uriIdx: j,
        width: w || 0,
        height: h || 0,
        bandwidth: Number(attr(lines[i], 'BANDWIDTH')) || 0,
        audio: attr(lines[i], 'AUDIO'),
      });
    }

    if (variants.length < 2) return text; // nothing to choose between

    // Prefer variants within the height cap; fall back to all if none qualify.
    let pool = variants.filter((v) => v.height <= MAX_HEIGHT);
    if (!pool.length) pool = variants;

    const best = pool.reduce((a, b) =>
      b.height > a.height || (b.height === a.height && b.bandwidth > a.bandwidth) ? b : a
    );

    const drop = new Set();
    for (const v of variants) {
      if (v !== best) {
        drop.add(v.infoIdx);
        drop.add(v.uriIdx);
      }
    }

    // Keep only the audio group the chosen variant refers to.
    if (best.audio) {
      lines.forEach((line, idx) => {
        if (
          line.startsWith('#EXT-X-MEDIA:') &&
          attr(line, 'TYPE') === 'AUDIO' &&
          attr(line, 'GROUP-ID') !== best.audio
        ) {
          drop.add(idx);
        }
      });
    }

    console.debug(
      `[X Max Quality] picked ${best.width}x${best.height} @ ${best.bandwidth} bps ` +
        `(of ${variants.length} levels)`
    );

    return lines.filter((_, idx) => !drop.has(idx)).join('\n');
  }

  // ---- fetch() ------------------------------------------------------------
  const origFetch = window.fetch;
  window.fetch = async function (input, init) {
    const res = await origFetch.apply(this, arguments);
    try {
      const url = typeof input === 'string' ? input : (input && input.url) || String(input);
      if (!PLAYLIST_URL.test(url)) return res;
      if (!(await isEnabled())) return res;

      const text = await res.clone().text();
      const out = rewriteMaster(text);
      if (out === text) return res;

      const patched = new Response(out, {
        status: res.status,
        statusText: res.statusText,
        headers: res.headers,
      });
      // Response.url is read-only; players use it to resolve relative URIs.
      Object.defineProperty(patched, 'url', { value: res.url });
      return patched;
    } catch (e) {
      return res;
    }
  };

  // ---- XMLHttpRequest -----------------------------------------------------
  const origOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (method, url) {
    this.__xmqUrl = String(url);
    return origOpen.apply(this, arguments);
  };

  const patchGetter = (prop) => {
    const desc = Object.getOwnPropertyDescriptor(XMLHttpRequest.prototype, prop);
    if (!desc || !desc.get) return;
    Object.defineProperty(XMLHttpRequest.prototype, prop, {
      configurable: true,
      enumerable: desc.enumerable,
      get() {
        const value = desc.get.call(this);
        if (
          this.readyState === 4 &&
          typeof value === 'string' &&
          this.__xmqUrl &&
          PLAYLIST_URL.test(this.__xmqUrl) &&
          readSetting() !== false // getters are synchronous, so no waiting here
        ) {
          return rewriteMaster(value);
        }
        return value;
      },
    });
  };
  patchGetter('responseText');
  patchGetter('response');
})();
