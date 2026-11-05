import { escapeHtml, renderStaticPage } from "alepha/server";

import {
  type ConsentScope,
  OAUTH_PAGE_STYLE,
  renderScopeList,
} from "./oauthPage.ts";

export type { ConsentScope } from "./oauthPage.ts";

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
   * Host that published the client's metadata document, for a client that
   * identified itself by a Client ID Metadata Document URL. Like the
   * redirect host, it is the part of the identity this server can vouch
   * for: the document was fetched from there.
   */
  clientHost?: string;
  /**
   * Where the user can revoke this later. Rendered only when set, because
   * promising a page that does not exist is worse than saying nothing.
   */
  connectionsUrl?: string;
}

export const renderConsentPage = (options: ConsentPageOptions): string => {
  const hidden = Object.entries(options.hidden)
    .map(
      ([k, v]) =>
        `<input type="hidden" name="${escapeHtml(k)}" value="${escapeHtml(v)}" />`,
    )
    .join("");

  const scopes = renderScopeList(options.scopes);

  const host = options.redirectHost
    ? `<span class="host">${escapeHtml(options.redirectHost)}</span>`
    : "";

  const publisher = options.clientHost
    ? `<p class="sub">Client published by <span class="host">${escapeHtml(options.clientHost)}</span></p>`
    : "";

  const heading = options.productName
    ? `${escapeHtml(options.clientName)} wants access to your ${escapeHtml(options.productName)} account`
    : `${escapeHtml(options.clientName)} wants to connect`;

  const footer = options.connectionsUrl
    ? `<p class="footer">You can revoke this at any time from <a href="${escapeHtml(options.connectionsUrl)}">your connected apps</a>.</p>`
    : "";

  return renderStaticPage({
    title: `Authorize ${options.clientName}`,
    brand: options.productName,
    style: OAUTH_PAGE_STYLE,
    footer,
    body: `<h1>${heading}</h1>
${publisher}
<p class="sub">Authorization will be sent to${host ? "" : " the address it registered"}</p>
${host}
<div class="section">
<h2>It will be able to</h2>
<ul>${scopes}</ul>
</div>
<div class="account">Granting as <strong>${escapeHtml(options.userName)}</strong></div>
<form method="POST" action="/oauth/authorize">${hidden}
<div class="row">
<button class="secondary" type="submit" name="decision" value="deny">Deny</button>
<button class="primary" type="submit" name="decision" value="allow">Allow</button>
</div></form>`,
  });
};
