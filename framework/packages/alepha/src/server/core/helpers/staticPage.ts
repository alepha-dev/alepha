/**
 * The framework's own server-rendered pages, and the one look they share.
 *
 * Some pages are answered by the framework itself rather than by the app's
 * React tree: the OAuth consent screen, the device approval page, the
 * unsubscribe link of a notification. They are served to a browser that may
 * have loaded nothing of the app, so each is one self-contained document: no
 * script, no external stylesheet, no font request.
 *
 * Kept in one place so they cannot drift apart. The buttons follow
 * `@alepha/ui`'s `Button`: a solid primary with a darker border, a hover fill,
 * a one-pixel press on `:active` and a focus ring, beside an outlined
 * secondary.
 */

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
 *
 * Classes: `brand`, `card`, `sub`, `host`, `section`, `notice`, `error`,
 * `account`, `row`, `footer`, and `primary` or `secondary` on a button.
 */
export const STATIC_PAGE_STYLE = `
:root{
  color-scheme:light dark;
  --bg:#f6f6f8; --panel:#fff; --line:#e3e3e9; --text:#17171c;
  --muted:#63636e; --accent:#17171c; --accent-text:#fff;
  --chip:#f0f0f4; --chip-text:#63636e; --hover:#f0f0f4;
  --ring:rgba(23,23,28,.25);
  --danger:#b42318; --danger-bg:#fef3f2;
}
@media (prefers-color-scheme:dark){
  :root{
    --bg:#0b0b0f; --panel:#141419; --line:#292933; --text:#ececed;
    --muted:#9a9aa5; --accent:#ececed; --accent-text:#0b0b0f;
    --chip:#1e1e26; --chip-text:#9a9aa5; --hover:#22222b;
    --ring:rgba(236,236,237,.3);
    --danger:#f97066; --danger-bg:#2a1413;
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
.notice{color:var(--muted); font-size:13px; margin:14px 0 0}
.error{
  margin:16px 0 0; padding:10px 12px; border-radius:9px;
  background:var(--danger-bg); color:var(--danger); font-size:14px;
}
.account{
  margin-top:22px; padding-top:20px; border-top:1px solid var(--line);
  color:var(--muted); font-size:13px;
}
.account strong{color:var(--text); font-weight:550}
.row{display:flex; gap:10px; margin-top:22px}
button{
  flex:1; display:inline-flex; align-items:center; justify-content:center;
  min-height:40px; padding:0 14px; border-radius:8px;
  border:1px solid transparent; background:var(--panel); color:var(--text);
  font-family:inherit; font-size:14px; font-weight:500; line-height:1;
  white-space:nowrap; cursor:pointer; user-select:none; outline:none;
  transition:background-color .15s,border-color .15s,box-shadow .15s,transform .05s;
}
button:focus-visible{box-shadow:0 0 0 3px var(--ring)}
button:not(:disabled):active{transform:translateY(1px)}
button:disabled{cursor:not-allowed; opacity:.5}
.primary{
  background:var(--accent); color:var(--accent-text);
  border-color:color-mix(in oklch,var(--accent),black 25%);
}
.primary:hover{background:color-mix(in oklch,var(--accent),black 12%)}
.secondary{border-color:var(--line)}
.secondary:hover{background:var(--hover)}
input{
  display:block; width:100%; padding:10px 12px; border-radius:8px;
  border:1px solid var(--line); background:var(--panel); color:var(--text);
  font:inherit; outline:none; transition:border-color .15s,box-shadow .15s;
}
input:focus-visible{border-color:var(--muted); box-shadow:0 0 0 3px var(--ring)}
.footer{
  margin-top:16px; text-align:center; color:var(--muted); font-size:12.5px;
}
.footer a{color:var(--muted)}
.footer a:hover{color:var(--text)}
`.trim();

export interface StaticPageOptions {
  /**
   * The document title, as plain text: it is escaped here.
   */
  title: string;
  /**
   * The card's content, as HTML. Escape what it interpolates.
   */
  body: string;
  /**
   * The app speaking, e.g. "Lore", shown above the card. Plain text.
   */
  brand?: string;
  /**
   * Rules only this page needs, appended after the shared stylesheet.
   */
  style?: string;
  /**
   * HTML under the card, such as a `<p class="footer">`.
   */
  footer?: string;
}

/**
 * A complete document in the shared look: the brand, then one card.
 */
export const renderStaticPage = (options: StaticPageOptions): string => {
  const brand = options.brand
    ? `<div class="brand">${escapeHtml(options.brand)}</div>\n`
    : "";
  const style = options.style
    ? `${STATIC_PAGE_STYLE}\n${options.style}`
    : STATIC_PAGE_STYLE;

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<meta name="robots" content="noindex" />
<title>${escapeHtml(options.title)}</title>
<style>${style}</style></head><body>
<main>
${brand}<div class="card">
${options.body}
</div>
${options.footer ?? ""}
</main></body></html>`;
};
