/**
 * Renders the OAuth consent screen as a self-contained HTML document.
 * Pure server-rendered HTML — no client framework, no @alepha/ui dependency.
 * All authorization parameters are emitted as hidden inputs so the POST to
 * /oauth/authorize is stateless.
 */
export interface ConsentPageOptions {
  clientName: string;
  userName: string;
  scopes: string[];
  /**
   * Hidden field name -> value; round-trips the authorization request.
   */
  hidden: Record<string, string>;
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

export const renderConsentPage = (options: ConsentPageOptions): string => {
  const hidden = Object.entries(options.hidden)
    .map(
      ([k, v]) =>
        `<input type="hidden" name="${escapeHtml(k)}" value="${escapeHtml(v)}" />`,
    )
    .join("");
  const scopes = options.scopes.length
    ? options.scopes.map((s) => `<li>${escapeHtml(s)}</li>`).join("")
    : "<li>Basic access</li>";
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>Authorize ${escapeHtml(options.clientName)}</title>
<style>
body{font-family:system-ui,sans-serif;background:#0b0b0f;color:#e5e5e5;
display:flex;min-height:100vh;align-items:center;justify-content:center;margin:0}
.card{background:#16161d;border:1px solid #2a2a35;border-radius:12px;
padding:32px;max-width:380px;width:100%}
h1{font-size:18px;margin:0 0 4px}p{color:#9a9aa5;font-size:14px;margin:4px 0 16px}
ul{font-size:14px;padding-left:18px}
.row{display:flex;gap:8px;margin-top:20px}
button{flex:1;padding:10px;border-radius:8px;border:0;font-size:14px;cursor:pointer}
.allow{background:#6d5cf0;color:#fff}.deny{background:#2a2a35;color:#e5e5e5}
</style></head><body>
<div class="card">
<h1>${escapeHtml(options.clientName)} wants to connect</h1>
<p>Signed in as ${escapeHtml(options.userName)}</p>
<p>It will be able to:</p>
<ul>${scopes}</ul>
<form method="POST" action="/oauth/authorize">${hidden}
<div class="row">
<button class="deny" type="submit" name="decision" value="deny">Deny</button>
<button class="allow" type="submit" name="decision" value="allow">Allow</button>
</div></form></div></body></html>`;
};
