import { $head } from "alepha/react/head";
import { $cookie } from "alepha/server/cookies";
import { uiAtom } from "../atoms/uiAtom.ts";

/**
 * Inline `<script>` rendered by SSR into the document `<head>`. Runs
 * synchronously before any CSS or React hydration: reads the `alepha-ui`
 * cookie, resolves `mode === "system"` via `prefers-color-scheme`, and
 * applies `class="dark"` (and optional `theme-<name>`) on `<html>`.
 *
 * This is what kills the flash-of-wrong-theme (FOUC) you'd otherwise get
 * with React-effect-based theming. Failures are swallowed silently — at
 * worst the page paints in light mode for one frame.
 */
const colorSchemeBoot = `(function(){try{var m=document.cookie.match(/(?:^|;\\s*)alepha-ui=([^;]+)/);var s=m?JSON.parse(decodeURIComponent(m[1])):{};var mode=s.mode||"system";var dark=mode==="dark"||(mode==="system"&&window.matchMedia&&window.matchMedia("(prefers-color-scheme: dark)").matches);var r=document.documentElement;if(dark)r.classList.add("dark");if(s.theme&&s.theme!=="default")r.classList.add("theme-"+s.theme);}catch(e){}})();`;

/**
 * Binds the {@link uiAtom} to an `alepha-ui` cookie + injects an inline
 * boot script into the SSR head to prevent FOUC on first paint.
 *
 * Reading flow: on app boot the cookie is parsed and pushed into the atom
 * (via the `key` option on `$cookie`). Writing flow: every time the atom
 * mutates, the cookie is rewritten — a single `useStore(uiAtom)` call is
 * enough to persist UI preferences across reloads.
 *
 * Persists for 365 days; SameSite=lax so it travels on top-level navigation
 * but not on cross-origin requests.
 */
export class UiPersistence {
  ui = $cookie({
    name: "alepha-ui",
    key: uiAtom.key,
    schema: uiAtom.schema,
    ttl: [365, "days"],
    sameSite: "lax",
  });

  head = $head({
    script: [{ content: colorSchemeBoot }],
  });
}
