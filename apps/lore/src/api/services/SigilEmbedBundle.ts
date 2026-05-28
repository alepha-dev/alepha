/**
 * The sigil embed bundle — the vanilla-JS skeleton served by
 * `GET /sigils/:id/embed.js` and added to a partner site with one
 * `<script>` line.
 *
 * ## Why a TS template string (not a separate `.js` file)
 *
 * The bundle is COMPILED INTO the server as a constant string and interpolated
 * per request. That makes "the build-pipeline entry for the script artifact"
 * a non-issue: there is no static artifact to emit, bundle, fingerprint, or
 * keep out of tree-shaking — the server builds the body dynamically and the
 * route serves it. It therefore works identically in `yarn dev`,
 * `yarn start` (prod-like), and the Cloudflare deploy with zero extra wiring.
 * A committed `.js` file read at runtime would have needed `assetsInclude` /
 * copy-to-dist plumbing and a prod-path `readFile`; this avoids all of it.
 *
 * ## Per-request interpolation
 *
 * `SIGIL_EMBED_TEMPLATE` is the static body. `renderSigilBundle()` replaces
 * the four `/*__…__*​/null` placeholder tokens with `JSON.stringify`-encoded
 * values. JSON encoding is the safe injection boundary: every value is a
 * valid JS literal and cannot break out of the string/array context, even
 * though all four come from our own DB.
 *
 * ## Scope (Quest #88 — Embedded Petitions v1)
 *
 * The floating button (icon-only, MessageSquareWarning chat bubble with
 * a "!") opens the petition popup at `/sigils/:id/request`. The bundle
 * forwards the host page's URL + console tail to the popup over an
 * origin-checked `postMessage` handshake. When the popup reports a
 * successful submit (`lore.sigil.submitted`) the bundle shows a
 * "Thanks!" toast inside its Shadow DOM.
 *
 * ### Screenshot flow (Quest #101)
 *
 * The embed no longer captures the host page itself — canvas/DOM
 * screenshot capture was unreliable and heavy, and host pages often
 * use cross-origin assets or proprietary CSS that confused html2canvas.
 * Instead, the user takes their own OS screenshot and pastes it into
 * the popup; the request form's clipboard `paste` handler turns the
 * pasted image into an attachment. No bundled JS dependency, no
 * `/sigils-vendor/html2canvas.min.js` route.
 *
 * ## Scope (Quest #90 — Blights capture)
 *
 * When `kinds` includes `"blights"`, the bundle registers global `error` /
 * `unhandledrejection` listeners, batches captured crash events ("every 5s
 * or 10 events") and `fetch()`-POSTs them to `/sigils/:id/blights` with the
 * baked `ingestKey`. Keep this under ~10 KB so the served (gzipped) body
 * stays small.
 *
 * ## Scope (Quest #86 — Beacons pageview ingestion)
 *
 * When `kinds` includes `"beacon"`, the bundle sends one fire-and-forget
 * pageview ping to `POST /sigils/:id/beacon` on page load (body `{ path }`,
 * `ingestKey` in the `X-Sigil-Key` header) and exposes
 * `window.LoreSigil.trackRoute()` for host SPAs to ping again after a
 * `history.pushState` route change.
 */

/** The four values baked into the served bundle per request. */
export interface SigilBundleConfig {
  /** Public sigil id — also the `<script>` src path segment. */
  id: string;
  /** Capability manifest — subset of `["petition","blights","beacon"]`. */
  kinds: string[];
  /** Semi-public secret future ingestion POSTs send. Baked in by design. */
  ingestKey: string;
  /** Origins the `postMessage` handshake will trust. */
  allowedOrigins: string[];
  /**
   * Glob patterns matched against `window.location.pathname` to suppress
   * the rendered embed surface (today: the petition button). Empty list
   * → render everywhere. `*` matches within a segment; `**` matches
   * across segments. See `pathMatchesGlob` in the bundle template.
   */
  excludedPaths: string[];
  /** Absolute origin of the Lore server, e.g. `https://lore.alepha.dev`. */
  loreOrigin: string;
}

/**
 * Static bundle body. The `/*__TOKEN__*​/null` markers are replaced by
 * `renderSigilBundle()`; each sits where a JS literal is expected so the
 * un-rendered template is still syntactically valid (handy for linting).
 */
const SIGIL_EMBED_TEMPLATE = `(function(){
  "use strict";
  var CFG = {
    id: /*__SIGIL_ID__*/null,
    kinds: /*__SIGIL_KINDS__*/null,
    ingestKey: /*__SIGIL_INGEST_KEY__*/null,
    allowedOrigins: /*__SIGIL_ALLOWED_ORIGINS__*/null,
    excludedPaths: /*__SIGIL_EXCLUDED_PATHS__*/null,
    loreOrigin: /*__SIGIL_LORE_ORIGIN__*/null
  };
  if (window.__loreSigil && window.__loreSigil[CFG.id]) { return; }
  window.__loreSigil = window.__loreSigil || {};
  window.__loreSigil[CFG.id] = CFG;

  // --- Console-tail interceptor: keep the last 50 console entries as
  // "[level] text" strings. Only the petition flow ships the tail (over
  // the postMessage payload), so the interceptor is petition-gated. ---
  var tail = [];
  if (CFG.kinds.indexOf("petition") !== -1) {
    ["log", "info", "warn", "error"].forEach(function(level) {
      var original = console[level];
      console[level] = function() {
        tail.push("[" + level + "] " +
          Array.prototype.slice.call(arguments).map(String).join(" "));
        if (tail.length > 50) { tail.shift(); }
        return original.apply(console, arguments);
      };
    });
  }

  // --- Blights capability: capture uncaught exceptions, batch, POST. ---
  // Registers global error listeners and ships batched crash events to
  // POST /sigils/:id/blights — the body shape the ingestion endpoint
  // expects: { events: [{ name, message, stack, sourceUrl }] } — the
  // ingestKey travels in the X-Sigil-Key header, not the body.
  // Batched "every 5s or 10 events" so a crash storm is one request.
  if (CFG.kinds.indexOf("blights") !== -1) {
    var BLIGHT_FLUSH_MS = 5000;
    var BLIGHT_MAX_BATCH = 10;
    var blightQueue = [];
    var blightTimer = null;

    function flushBlights() {
      if (blightTimer) { clearTimeout(blightTimer); blightTimer = null; }
      // The batch is drained here, so a second flush (e.g. both
      // visibilitychange and pagehide firing) sees an empty queue and
      // no-ops — no double-send.
      if (!blightQueue.length) { return; }
      var events = blightQueue.splice(0, blightQueue.length);
      try {
        fetch(CFG.loreOrigin.replace(/\\/$/, "") + "/sigils/" +
          encodeURIComponent(CFG.id) + "/blights", {
          method: "POST",
          mode: "cors",
          credentials: "omit",
          keepalive: true,
          headers: {
            "Content-Type": "application/json",
            "X-Sigil-Key": CFG.ingestKey
          },
          body: JSON.stringify({ events: events })
        }).catch(function() {});
      } catch (e) { /* fire-and-forget */ }
    }

    function queueBlight(ev) {
      blightQueue.push(ev);
      if (blightQueue.length >= BLIGHT_MAX_BATCH) {
        flushBlights();
      } else if (!blightTimer) {
        blightTimer = setTimeout(flushBlights, BLIGHT_FLUSH_MS);
      }
    }

    window.addEventListener("error", function(e) {
      var err = e && e.error;
      queueBlight({
        name: (err && err.name) || "Error",
        message: (err && err.message) || (e && e.message) || "",
        stack: (err && err.stack) || "",
        sourceUrl: location.href
      });
    });

    window.addEventListener("unhandledrejection", function(e) {
      var reason = e && e.reason;
      var isErr = reason && typeof reason === "object" && reason.stack;
      queueBlight({
        name: (isErr && reason.name) || "UnhandledRejection",
        message: (isErr && reason.message) || String(reason),
        stack: (isErr && reason.stack) || "",
        sourceUrl: location.href
      });
    });

    // Best-effort flush when the page is being unloaded. visibilitychange
    // (hidden) covers tab-switch / mobile background; pagehide covers the
    // desktop close / navigation / bfcache paths it misses. Both call the
    // same flush, which drains the batch — firing twice is harmless.
    window.addEventListener("visibilitychange", function() {
      if (document.visibilityState === "hidden") { flushBlights(); }
    });
    window.addEventListener("pagehide", function() { flushBlights(); });
  }

  // --- Beacons capability: cookieless pageview pings. ---
  // One ping on page load to POST /sigils/:id/beacon (body { path },
  // ingestKey in the X-Sigil-Key header). window.LoreSigil.trackRoute()
  // lets a host SPA ping again after a history.pushState route change.
  if (CFG.kinds.indexOf("beacon") !== -1) {
    var beaconUrl = CFG.loreOrigin.replace(/\\/$/, "") + "/sigils/" +
      encodeURIComponent(CFG.id) + "/beacon";
    function sendBeacon(path) {
      try {
        fetch(beaconUrl, {
          method: "POST", mode: "cors", credentials: "omit", keepalive: true,
          headers: { "Content-Type": "application/json", "X-Sigil-Key": CFG.ingestKey },
          body: JSON.stringify({ path: path || location.pathname })
        }).catch(function() {});
      } catch (e) { /* fire-and-forget */ }
    }
    window.LoreSigil = window.LoreSigil || {};
    window.LoreSigil.trackRoute = function(path) { sendBeacon(path); };
    sendBeacon(location.pathname);
  }

  // --- Capability dispatch: the floating button is a "petition" capability. ---
  if (CFG.kinds.indexOf("petition") === -1) { return; }

  // --- Excluded paths: suppress the button on host pages whose pathname
  // matches any configured glob (e.g. the host's own "/contact" page or
  // an admin section). Matched against location.pathname ONLY — no host,
  // no query. Glob rules: \`*\` = any chars within a segment (no /),
  // \`**\` = any chars across segments. ---
  function pathMatchesGlob(path, pattern) {
    if (!pattern) { return false; }
    // Build a regex from the glob — escape regex metachars first, then
    // re-expand the glob tokens. \`**\` becomes \`.*\`, \`*\` becomes
    // \`[^/]*\`. Use a sentinel for \`**\` so the second pass doesn't
    // re-expand the stars we just wrote.
    var escaped = pattern.replace(/[.+^$()|[\\]\\\\]/g, "\\\\$&")
      .replace(/\\*\\*/g, "\\u0001")
      .replace(/\\*/g, "[^/]*")
      .replace(/\\u0001/g, ".*");
    try {
      return new RegExp("^" + escaped + "$").test(path);
    } catch (e) {
      return false;
    }
  }
  if (CFG.excludedPaths && CFG.excludedPaths.length) {
    for (var i = 0; i < CFG.excludedPaths.length; i++) {
      if (pathMatchesGlob(location.pathname, CFG.excludedPaths[i])) {
        return;
      }
    }
  }

  // The Lore origin is always trusted for the popup<->opener handshake
  // (the popup is served from there); partner pages never message us.
  var loreOrigin = CFG.loreOrigin.replace(/\\/$/, "");
  function originTrusted(origin) {
    return origin === loreOrigin || CFG.allowedOrigins.indexOf(origin) !== -1;
  }

  // --- postMessage handshake, origin-checked on BOTH ends. ---
  // The popup pulls the console tail + host metadata via this handshake;
  // the user pastes their own screenshot into the form (no capture
  // happens here — see Quest #101 docstring above).
  window.addEventListener("message", function(event) {
    if (!originTrusted(event.origin)) { return; }
    var data = event.data || {};
    if (data.type === "lore.sigil.ready") {
      event.source && event.source.postMessage({
        type: "lore.sigil.payload",
        sigilId: CFG.id,
        // Array of "[level] text" strings — the wire shape the petition
        // expects (petitionSourceSchema.consoleTail is string[]).
        consoleTail: tail.slice(),
        hostUrl: location.href,
        hostPath: location.pathname + location.search
      }, event.origin);
    } else if (data.type === "lore.sigil.submitted" && data.sigilId === CFG.id) {
      showToast();
    }
  });

  // --- Floating icon button inside a style-isolated Shadow DOM.
  // Round, icon-only (lucide MessageSquareWarning — chat bubble with a
  // "!"). Visible accessible name comes from aria-label since there is
  // no text content. ---
  var host = document.createElement("div");
  host.style.cssText = "position:fixed;bottom:16px;right:16px;z-index:2147483000;";
  var root = host.attachShadow ? host.attachShadow({ mode: "open" }) : host;
  var style = document.createElement("style");
  style.textContent =
    ".btn{display:inline-flex;align-items:center;justify-content:center;" +
    "width:44px;height:44px;background:#4f46e5;color:#fff;border:0;" +
    "border-radius:9999px;cursor:pointer;box-shadow:0 4px 12px rgba(0,0,0,.25);}" +
    ".btn:hover{background:#4338ca;}.btn:disabled{opacity:.6;cursor:default;}" +
    ".btn svg{width:20px;height:20px;}" +
    ".toast{position:fixed;bottom:64px;right:16px;font:600 13px system-ui,sans-serif;" +
    "background:#16a34a;color:#fff;border-radius:8px;padding:10px 14px;" +
    "box-shadow:0 4px 12px rgba(0,0,0,.25);}";
  var btn = document.createElement("button");
  btn.className = "btn";
  btn.type = "button";
  btn.setAttribute("aria-label", "Feedback");
  // lucide MessageSquareWarning path data, inlined.
  btn.innerHTML =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
    'stroke-width="2" stroke-linecap="round" stroke-linejoin="round" ' +
    'aria-hidden="true">' +
    '<path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z"/>' +
    '<line x1="12" x2="12" y1="8" y2="12"/>' +
    '<line x1="12" x2="12.01" y1="16" y2="16"/>' +
    '</svg>';

  function showToast() {
    var toast = document.createElement("div");
    toast.className = "toast";
    toast.textContent = "Thanks!";
    root.appendChild(toast);
    setTimeout(function() {
      toast.parentNode && toast.parentNode.removeChild(toast);
    }, 3500);
  }

  btn.addEventListener("click", function() {
    if (btn.disabled) { return; }
    var qs = "?path=" + encodeURIComponent(location.pathname) +
      "&url=" + encodeURIComponent(location.href) + "&type=bug";
    var requestUrl = loreOrigin + "/sigils/" + encodeURIComponent(CFG.id) +
      "/request" + qs;
    // Try a popup first (floats over the partner page so the bug stays
    // visible while the user types + pastes the screenshot). Fall back
    // to a new tab if window.open is blocked or returns null.
    var popupRef = window.open(
      requestUrl, "lore-sigil-" + CFG.id, "width=480,height=720");
    if (!popupRef) {
      window.open(requestUrl, "_blank");
    }
  });
  root.appendChild(style);
  root.appendChild(btn);

  function mount() { (document.body || document.documentElement).appendChild(host); }
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", mount);
  } else {
    mount();
  }
})();
`;

/**
 * Render the embed bundle for a specific sigil. Replaces each placeholder
 * token with the `JSON.stringify`-encoded config value — a safe JS-literal
 * injection boundary.
 */
export const renderSigilBundle = (config: SigilBundleConfig): string => {
  return SIGIL_EMBED_TEMPLATE.replace(
    "/*__SIGIL_ID__*/null",
    JSON.stringify(config.id),
  )
    .replace("/*__SIGIL_KINDS__*/null", JSON.stringify(config.kinds))
    .replace("/*__SIGIL_INGEST_KEY__*/null", JSON.stringify(config.ingestKey))
    .replace(
      "/*__SIGIL_ALLOWED_ORIGINS__*/null",
      JSON.stringify(config.allowedOrigins),
    )
    .replace(
      "/*__SIGIL_EXCLUDED_PATHS__*/null",
      JSON.stringify(config.excludedPaths),
    )
    .replace(
      "/*__SIGIL_LORE_ORIGIN__*/null",
      JSON.stringify(config.loreOrigin),
    );
};
