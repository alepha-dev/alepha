import {
  type ConsentScope,
  escapeHtml,
  OAUTH_PAGE_STYLE,
  renderScopeList,
} from "./oauthPage.ts";

/**
 * The device-flow approval page (RFC 8628 §3.3), as a self-contained HTML
 * document.
 *
 * The human half of the device grant: a CLI prints a code and this URL, and
 * somebody with a browser and a session says yes or no. Same constraint as the
 * consent screen beside it - server-rendered HTML and nothing else - and for a
 * sharper reason: a device flow exists because the thing asking has no
 * browser, so this page may be opened on a phone that has never loaded the app.
 *
 * Three steps, one per shape of the request:
 *
 * - **enter** - no code yet, or a code that was refused. A GET form, so
 *   submitting it lands on the confirm step at a URL that can be reloaded.
 * - **confirm** - the code, what it will be allowed to do, and who is granting
 *   it. The only step that can change anything, and it does so by POST.
 * - **done** - which way it went.
 *
 * ⚠️ The confirm step's copy is part of the security of the grant, not
 * decoration. A device code carries no PKCE binding, so the realistic attack
 * is a phishing link carrying somebody else's code (RFC 8628 §5.4): the page
 * has to tell the human to compare the code with their device and to refuse
 * one they did not ask for.
 */
export type DevicePageOptions =
  | DevicePageEnterOptions
  | DevicePageConfirmOptions
  | DevicePageDoneOptions;

export interface DevicePageEnterOptions {
  step: "enter";
  /**
   * What was typed or carried by the link, kept so a refusal does not also
   * cost retyping it.
   */
  userCode?: string;
  /**
   * Why the page is asking again.
   */
  error?: string;
  productName?: string;
}

export interface DevicePageConfirmOptions {
  step: "confirm";
  userCode: string;
  userName: string;
  scopes: ConsentScope[];
  /**
   * The app the device signs in to, e.g. "Lore". Never defaulted, for the
   * reason given on the consent screen's option of the same name.
   */
  productName?: string;
}

export interface DevicePageDoneOptions {
  step: "done";
  decision: "allow" | "deny";
  productName?: string;
}

/**
 * The rules the consent screen does not need: the code, typed and shown.
 */
const DEVICE_STYLE = `
:root{--danger:#b42318; --danger-bg:#fef3f2}
@media (prefers-color-scheme:dark){
  :root{--danger:#f97066; --danger-bg:#2a1413}
}
.code{
  margin-top:18px; padding:14px; border-radius:10px; text-align:center;
  background:var(--chip); color:var(--text);
  font-family:ui-monospace,SFMono-Regular,Menlo,monospace;
  font-size:28px; font-weight:600; letter-spacing:.14em;
}
.code-input{
  display:block; width:100%; margin-top:18px; padding:12px;
  border:1px solid var(--line); border-radius:10px;
  background:var(--panel); color:var(--text); text-align:center;
  font-family:ui-monospace,SFMono-Regular,Menlo,monospace;
  font-size:24px; letter-spacing:.14em; text-transform:uppercase;
}
.code-input:focus{outline:2px solid var(--accent); outline-offset:2px}
.notice{color:var(--muted); font-size:13px; margin:14px 0 0}
.error{
  margin:16px 0 0; padding:10px 12px; border-radius:9px;
  background:var(--danger-bg); color:var(--danger); font-size:14px;
}
.primary{background:var(--accent); color:var(--accent-text)}
`.trim();

const renderEnter = (options: DevicePageEnterOptions): string => {
  const error = options.error
    ? `<p class="error" role="alert">${escapeHtml(options.error)}</p>`
    : "";
  const value = options.userCode
    ? ` value="${escapeHtml(options.userCode)}"`
    : "";
  return `<h1>Connect a device</h1>
<p class="sub">Enter the code shown on your device.</p>
${error}
<form method="GET" action="/oauth/device">
<input class="code-input" type="text" name="user_code"${value} aria-label="Code" placeholder="XXXX-XXXX" maxlength="16" autocomplete="off" autocapitalize="characters" spellcheck="false" required autofocus />
<div class="row"><button class="primary" type="submit">Continue</button></div>
</form>`;
};

const renderConfirm = (options: DevicePageConfirmOptions): string => {
  const account = options.productName
    ? `your ${escapeHtml(options.productName)} account`
    : "your account";
  const code = escapeHtml(options.userCode);
  return `<h1>Connect a device to ${account}</h1>
<p class="sub">Check that this code matches the code on your device.</p>
<div class="code">${code}</div>
<p class="notice">If you did not start this sign-in yourself, deny it: someone may be trying to get into your account.</p>
<div class="section">
<h2>It will be able to</h2>
<ul>${renderScopeList(options.scopes)}</ul>
</div>
<div class="account">Granting as <strong>${escapeHtml(options.userName)}</strong></div>
<form method="POST" action="/oauth/device"><input type="hidden" name="user_code" value="${code}" />
<div class="row">
<button class="deny" type="submit" name="decision" value="deny">Deny</button>
<button class="allow" type="submit" name="decision" value="allow">Allow</button>
</div></form>`;
};

const renderDone = (options: DevicePageDoneOptions): string =>
  options.decision === "allow"
    ? `<h1>Device connected</h1>
<p class="sub">You can close this page. Your device finishes signing in on its own, within a few seconds.</p>`
    : `<h1>Request denied</h1>
<p class="sub">The device was not given access. You can close this page.</p>`;

export const renderDevicePage = (options: DevicePageOptions): string => {
  const body =
    options.step === "enter"
      ? renderEnter(options)
      : options.step === "confirm"
        ? renderConfirm(options)
        : renderDone(options);

  const brand = options.productName
    ? `<div class="brand">${escapeHtml(options.productName)}</div>`
    : "";

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<meta name="robots" content="noindex" />
<title>Connect a device</title>
<style>${OAUTH_PAGE_STYLE}
${DEVICE_STYLE}</style></head><body>
<main>
${brand}
<div class="card">
${body}
</div>
</main></body></html>`;
};
