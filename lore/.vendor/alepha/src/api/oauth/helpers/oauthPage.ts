/**
 * What the two pages this module renders itself have in common: the consent
 * screen and the device approval page.
 *
 * Both are served to a browser that has loaded nothing of the app, so both are
 * one self-contained document, and both list the scopes being granted the same
 * way. Kept in one place so the two cannot drift into describing the same
 * grant differently.
 */

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

export const escapeHtml = (s: string): string =>
  s.replace(
    /[&<>"']/g,
    (c) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[c] as string,
  );

/**
 * The stylesheet, inline. Light and dark both defined, because the viewport
 * this lands in belongs to whoever opened it and the page has no theme toggle
 * and nowhere to remember one.
 *
 * The accent is neutral, the text colour on the panel, rather than a brand
 * hue (#Q2233). These pages speak for whichever app mounts the module, and a
 * colour of the framework's own choosing was the one thing on them that
 * belonged to no app at all.
 */
export const OAUTH_PAGE_STYLE = `
:root{
  color-scheme:light dark;
  --bg:#f6f6f8; --panel:#fff; --line:#e3e3e9; --text:#17171c;
  --muted:#63636e; --accent:#17171c; --accent-text:#fff;
  --chip:#f0f0f4; --chip-text:#63636e;
}
@media (prefers-color-scheme:dark){
  :root{
    --bg:#0b0b0f; --panel:#141419; --line:#292933; --text:#ececed;
    --muted:#9a9aa5; --accent:#ececed; --accent-text:#0b0b0f;
    --chip:#1e1e26; --chip-text:#9a9aa5;
  }
}
*{box-sizing:border-box}
body{
  margin:0; background:var(--bg); color:var(--text);
  font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;
  font-size:15px; line-height:1.5;
  display:flex; min-height:100vh; align-items:center; justify-content:center;
  padding:24px;
}
main{width:100%; max-width:440px}
.brand{
  display:flex; align-items:center; gap:8px; justify-content:center;
  margin-bottom:16px; color:var(--muted); font-size:13px;
  letter-spacing:.04em; text-transform:uppercase;
}
.card{
  background:var(--panel); border:1px solid var(--line); border-radius:14px;
  padding:28px;
}
h1{font-size:20px; line-height:1.3; margin:0 0 6px; font-weight:600}
.sub{color:var(--muted); font-size:14px; margin:0}
.host{
  display:inline-block; margin-top:10px; padding:3px 8px; border-radius:6px;
  background:var(--chip); color:var(--chip-text);
  font-family:ui-monospace,SFMono-Regular,Menlo,monospace; font-size:12px;
}
.section{
  margin-top:22px; padding-top:20px; border-top:1px solid var(--line);
}
h2{
  font-size:12px; letter-spacing:.04em; text-transform:uppercase;
  color:var(--muted); margin:0 0 12px; font-weight:600;
}
ul{list-style:none; margin:0; padding:0; display:grid; gap:14px}
.scope-head{display:flex; align-items:baseline; gap:8px; flex-wrap:wrap}
.scope-label{font-weight:550}
.scope-id{
  font-family:ui-monospace,SFMono-Regular,Menlo,monospace; font-size:11px;
  color:var(--chip-text); background:var(--chip);
  padding:1px 6px; border-radius:5px;
}
.scope-desc{color:var(--muted); font-size:14px; margin:2px 0 0}
.account{
  margin-top:22px; padding-top:20px; border-top:1px solid var(--line);
  color:var(--muted); font-size:13px;
}
.account strong{color:var(--text); font-weight:550}
.row{display:flex; gap:10px; margin-top:22px}
button{
  flex:1; padding:11px 12px; border-radius:9px; font-size:15px;
  font-family:inherit; font-weight:550; cursor:pointer; border:1px solid transparent;
}
button:focus-visible{outline:2px solid var(--accent); outline-offset:2px}
.allow{background:var(--accent); color:var(--accent-text)}
.deny{background:transparent; color:var(--text); border-color:var(--line)}
.deny:hover{background:var(--chip)}
.footer{
  margin-top:16px; text-align:center; color:var(--muted); font-size:12.5px;
}
.footer a{color:var(--muted)}
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
