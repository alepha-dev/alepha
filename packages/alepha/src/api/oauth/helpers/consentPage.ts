/**
 * The OAuth consent screen, as a self-contained HTML document.
 *
 * ⚠️ **Server-rendered HTML and nothing else.** No client framework, no
 * `@alepha/ui`, no external stylesheet, no font request. This page is served
 * to a browser that has loaded nothing of the app and may never load anything
 * of it - a native client's popup, an agent's embedded webview - so every byte
 * it needs is in the response. That constraint is why it is a template string
 * rather than a React page, and it is not negotiable.
 *
 * Every authorization parameter is emitted as a hidden input, so the POST back
 * to `/oauth/authorize` carries the whole request and the server keeps no
 * pending-authorization state.
 *
 * ## What the page has to say
 *
 * It is the first page a third party ever sees from an Alepha app, and for a
 * long time it was a bare card in an empty viewport: a client name, a bullet
 * reading `mcp`, two buttons. Somebody being asked to grant access needs four
 * answers, and the layout is built around them:
 *
 * - **who is asking** - the client's name, and the host the authorization code
 *   will be sent to. The host is the only part of a client's identity the
 *   server can vouch for: the name is whatever the client registered, the
 *   redirect URI is what the code is actually delivered to.
 * - **what they get** - each scope as a label and a sentence, never a raw
 *   token. See {@link ConsentScope}.
 * - **who is granting** - the signed-in account, so a wrong-account grant is
 *   caught before it happens rather than after.
 * - **how to undo it** - a link to the account's connected apps, when the app
 *   has such a page.
 */
export interface ConsentPageOptions {
  clientName: string;
  userName: string;
  scopes: ConsentScope[];
  /**
   * Hidden field name -> value; round-trips the authorization request.
   */
  hidden: Record<string, string>;
  /**
   * The app being connected TO, e.g. "Lore". Omitted when the app has not
   * declared one - deliberately not defaulted to `APP_NAME`, which is a log
   * prefix ("RDM") and would put an initialism where a product name goes.
   */
  productName?: string;
  /**
   * Host of the registered `redirect_uri`. See the class note: this is the
   * verifiable half of the client's identity.
   */
  redirectHost?: string;
  /**
   * Where the user can revoke this later. Rendered only when set, because
   * promising a page that does not exist is worse than saying nothing.
   */
  connectionsUrl?: string;
}

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

const escapeHtml = (s: string): string =>
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
 */
const STYLE = `
:root{
  color-scheme:light dark;
  --bg:#f6f6f8; --panel:#fff; --line:#e3e3e9; --text:#17171c;
  --muted:#63636e; --accent:#5b4bd6; --accent-text:#fff;
  --chip:#f0f0f4; --chip-text:#63636e;
}
@media (prefers-color-scheme:dark){
  :root{
    --bg:#0b0b0f; --panel:#141419; --line:#292933; --text:#ececed;
    --muted:#9a9aa5; --accent:#6d5cf0; --accent-text:#fff;
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

export const renderConsentPage = (options: ConsentPageOptions): string => {
  const hidden = Object.entries(options.hidden)
    .map(
      ([k, v]) =>
        `<input type="hidden" name="${escapeHtml(k)}" value="${escapeHtml(v)}" />`,
    )
    .join("");

  const scopes = options.scopes.length
    ? options.scopes
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

  const brand = options.productName
    ? `<div class="brand">${escapeHtml(options.productName)}</div>`
    : "";

  const host = options.redirectHost
    ? `<span class="host">${escapeHtml(options.redirectHost)}</span>`
    : "";

  const heading = options.productName
    ? `${escapeHtml(options.clientName)} wants access to your ${escapeHtml(options.productName)} account`
    : `${escapeHtml(options.clientName)} wants to connect`;

  const footer = options.connectionsUrl
    ? `<p class="footer">You can revoke this at any time from <a href="${escapeHtml(options.connectionsUrl)}">your connected apps</a>.</p>`
    : "";

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<meta name="robots" content="noindex" />
<title>Authorize ${escapeHtml(options.clientName)}</title>
<style>${STYLE}</style></head><body>
<main>
${brand}
<div class="card">
<h1>${heading}</h1>
<p class="sub">Authorization will be sent to${host ? "" : " the address it registered"}</p>
${host}
<div class="section">
<h2>It will be able to</h2>
<ul>${scopes}</ul>
</div>
<div class="account">Granting as <strong>${escapeHtml(options.userName)}</strong></div>
<form method="POST" action="/oauth/authorize">${hidden}
<div class="row">
<button class="deny" type="submit" name="decision" value="deny">Deny</button>
<button class="allow" type="submit" name="decision" value="allow">Allow</button>
</div></form>
</div>
${footer}
</main></body></html>`;
};
