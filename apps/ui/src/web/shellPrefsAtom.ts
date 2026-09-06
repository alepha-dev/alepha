import { $atom, z } from "alepha";

/**
 * How the reader wants the shell around the showcase drawn, remembered across
 * visits.
 *
 * `persist: "localStorage"` rather than `"cookie"`: this is a per-browser
 * convenience with no server involvement, and a cookie would ship it on every
 * request for nothing. It is also the reason a trust-bearing value would never
 * live here.
 *
 * ⚠️ **Web storage does not exist during SSR, so a consumer MUST NOT render the
 * stored value on the first client pass.** The server necessarily paints
 * {@link SHELL_PREFS_DEFAULT}; a client that hydrates straight from storage
 * produces a different tree, and React answers with "some attributes of the
 * server rendered HTML didn't match... this won't be patched up" - leaving the
 * DOM attribute permanently disagreeing with what React believes it rendered.
 * `Layout` therefore gates on a mounted flag: first paint matches the server,
 * the stored value lands on the pass after.
 *
 * ⚠️ **`persist: "cookie"` does NOT fix that here, and it was tried.** The
 * server logs a warning per render recommending it, and the recommendation is
 * right for a server-RENDERED app. Every page here is `static: true`, so it is
 * PRERENDERED at build time and no request ever renders it: `AtomCookiePersistence`
 * seeds state on `server:onRequest`, which never runs for an asset served off
 * the manifest. Measured, on a cold load of a prerendered page with the cookie
 * set: the shell came back `floating` when the cookie said `inset`, so the
 * preference was lost outright rather than merely arriving a frame late. The
 * warning is noise this app has to live with until a page stops being static.
 *
 * ⚠️ `headerOutside` only does anything when `variant` is `inset`; `AppShell`
 * ignores it otherwise. `/blocks/shell` says so rather than offering a switch
 * that silently does nothing.
 */
export const SHELL_PREFS_DEFAULT = {
  variant: "floating" as const,
  headerOutside: false,
  breadcrumbs: true,
};

export const shellPrefsAtom = $atom({
  name: "ui.shell.prefs",
  schema: z.object({
    variant: z.enum(["sidebar", "floating", "inset"]).default("floating"),
    headerOutside: z.boolean().default(false),
    breadcrumbs: z.boolean().default(true),
  }),
  default: SHELL_PREFS_DEFAULT,
  persist: "localStorage",
});
