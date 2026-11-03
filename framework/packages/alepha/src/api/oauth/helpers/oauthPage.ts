/**
 * What the consent screen and the device approval page have in common, beyond
 * the look every static page shares (`renderStaticPage` in `alepha/server`).
 *
 * Both are served to a browser that has loaded nothing of the app, so both are
 * one self-contained document, and both list the scopes being granted the same
 * way. Kept in one place so the two cannot drift into describing the same
 * grant differently.
 */

import { escapeHtml } from "alepha/server";

/**
 * One scope, as the reader sees it.
 *
 * `id` is always carried even when a label exists: it is what the token will
 * actually contain, so a reader who knows what they are looking at can check
 * the copy against it. Shown small and monospaced, beside the label rather
 * than in place of it.
 */
export interface ConsentScope {
  id: string;
  label?: string;
  description?: string;
}

/**
 * The rules the shared stylesheet does not carry: a scope, as listed.
 */
export const OAUTH_PAGE_STYLE = `
.scope-head{display:flex; align-items:baseline; gap:8px; flex-wrap:wrap}
.scope-label{font-weight:550}
.scope-id{
  font-family:ui-monospace,SFMono-Regular,Menlo,monospace; font-size:11px;
  color:var(--chip-text); background:var(--chip);
  padding:1px 6px; border-radius:5px;
}
.scope-desc{color:var(--muted); font-size:14px; margin:2px 0 0}
`.trim();

/**
 * The scopes about to be granted, as list items.
 */
export const renderScopeList = (scopes: ConsentScope[]): string =>
  scopes.length
    ? scopes
        .map((scope) => {
          const label = escapeHtml(scope.label ?? scope.id);
          // The raw id is redundant beside itself when no label was declared.
          const id =
            scope.label && scope.label !== scope.id
              ? `<span class="scope-id">${escapeHtml(scope.id)}</span>`
              : "";
          const description = scope.description
            ? `<p class="scope-desc">${escapeHtml(scope.description)}</p>`
            : "";
          return `<li><div class="scope-head"><span class="scope-label">${label}</span>${id}</div>${description}</li>`;
        })
        .join("")
    : /*
       * No scopes is a real outcome, not a bug: a client may ask for none,
       * and the intersection with what it is registered for may come out
       * empty. Saying so beats an empty list, which reads as a page that
       * failed to load.
       */
      `<li><div class="scope-head"><span class="scope-label">Sign you in</span></div><p class="scope-desc">No other access is being granted.</p></li>`;
