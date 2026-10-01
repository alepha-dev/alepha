import { escapeHtml, OAUTH_PAGE_STYLE } from "./oauthPage.ts";

/**
 * The page `/oauth/authorize` answers with when it does not know the
 * `client_id`, as a self-contained HTML document.
 *
 * ⚠️ **It never redirects.** RFC 6749 §4.1.2.1: with no valid client there
 * is no registered redirect URI to trust, so the error goes to the human in
 * the browser, not back to the client. That makes this page the whole of the
 * diagnosis, and a bare `unknown client_id` told nobody what to do.
 *
 * What it has to say is the fix. A client that registered once through
 * RFC 7591 and kept its `client_id` (ChatGPT does, for the life of a
 * connector) never registers again on its own, so every retry lands here
 * until a human removes the connector and adds it back (#Q2413).
 */
export interface UnknownClientPageOptions {
  /**
   * The id the client sent, shown so a report can quote it.
   */
  clientId: string;
  /**
   * The app being connected to, e.g. "Lore". Never defaulted, for the reason
   * given on the consent screen's option of the same name.
   */
  productName?: string;
}

export const renderUnknownClientPage = (
  options: UnknownClientPageOptions,
): string => {
  const brand = options.productName
    ? `<div class="brand">${escapeHtml(options.productName)}</div>`
    : "";
  const target = options.productName
    ? escapeHtml(options.productName)
    : "this server";

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<meta name="robots" content="noindex" />
<title>Connection not recognized</title>
<style>${OAUTH_PAGE_STYLE}</style></head><body>
<main>
${brand}
<div class="card">
<h1>This connection is no longer recognized</h1>
<p class="sub">The app that sent you here is signing in with a registration ${target} does not hold, or has revoked.</p>
<span class="host">${escapeHtml(options.clientId)}</span>
<div class="section">
<h2>To connect again</h2>
<p class="sub">Remove the connector from the app you came from, then add it again. Adding it registers a new connection, and signing in will work from there. Retrying from the app as it is will keep landing on this page.</p>
</div>
</div>
</main></body></html>`;
};
