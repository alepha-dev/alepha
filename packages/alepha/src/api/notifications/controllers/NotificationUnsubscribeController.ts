import { $inject, z } from "alepha";
import { $logger } from "alepha/logger";
import { $route } from "alepha/server";

import { NotificationSuppressionService } from "../services/NotificationSuppressionService.ts";
import { NotificationUnsubscribeService } from "../services/NotificationUnsubscribeService.ts";

/**
 * The page and the endpoint an unsubscribe link points at.
 *
 * **A `$route`, not an `$action`.** `$action` lives under `/api`, which mail
 * clients and one-click POSTs have no business reaching, and the `$action`
 * dispatcher shadows anything under `/api/*` anyway. This is a root path.
 *
 * **Unauthenticated by design.** Someone arriving from a six-month-old email
 * has no session, and the app's SPA may be behind a login they cannot pass.
 * The token is the credential, and it is the only input this controller
 * trusts: no cookie, no session, no current tenant.
 */
export class NotificationUnsubscribeController {
  protected readonly url: string = "/notifications/unsubscribe";
  protected readonly tokens = $inject(NotificationUnsubscribeService);
  protected readonly suppressions = $inject(NotificationSuppressionService);
  protected readonly log = $logger();

  public readonly confirmPage = $route({
    method: "GET",
    path: `${this.url}/:token`,
    schema: {
      params: z.object({ token: z.text() }),
    },
    handler: async ({ params, reply }) => {
      const claims = this.tokens.verify(params.token);
      reply.headers["content-type"] = "text/html; charset=utf-8";
      if (!claims) {
        reply.status = 400;
        return this.page(
          "This link is not valid",
          "It may have been altered, or the application's signing key has changed since the message was sent.",
        );
      }

      // A GET must not change anything: mail clients and security scanners
      // both prefetch links, and a scanner that unsubscribed everyone it
      // scanned would be a very bad afternoon.
      return this.page(
        "Confirm you want to stop these emails",
        "You will keep receiving messages you need for your account, such as password resets.",
        params.token,
      );
    },
  });

  public readonly unsubscribe = $route({
    method: "POST",
    path: `${this.url}/:token`,
    schema: {
      params: z.object({ token: z.text() }),
      // No body schema on purpose. Everything this handler needs is in the
      // token, and the callers send wildly different shapes: a mail provider
      // does RFC 8058 one-click with `List-Unsubscribe=One-Click` as a form
      // body, the confirmation page posts an empty form, and a curl does
      // neither. Declaring a schema makes the bodyless case a 400, which
      // would break the page's own button.
    },
    handler: async ({ params, reply }) => {
      const claims = this.tokens.verify(params.token);
      reply.headers["content-type"] = "text/html; charset=utf-8";

      if (!claims) {
        reply.status = 400;
        return this.page("This link is not valid", "Nothing has been changed.");
      }

      await this.suppressions.suppress({
        organizationId: claims.organizationId,
        contact: claims.contact,
        channel: claims.channel,
        reason: "unsubscribed",
        category: claims.category,
        source: "link",
      });

      this.log.info("Contact unsubscribed", {
        template: claims.template,
        category: claims.category,
        channel: claims.channel,
      });

      return this.page(
        "You have been unsubscribed",
        "You will not receive these messages again.",
      );
    },
  });

  /**
   * Server-rendered HTML, deliberately not a React page: the recipient has
   * no session and the app's SPA may be behind a login.
   *
   * ⚠️ **Never echo the address.** Rendering the contact would turn a leaked
   * or guessed link into a way to confirm who it belongs to.
   */
  protected page(title: string, detail: string, token?: string): string {
    const form = token
      ? `<form method="post" action="${this.url}/${token}">
      <button type="submit">Unsubscribe</button>
    </form>`
      : "";

    return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="robots" content="noindex" />
    <title>${title}</title>
    <style>
      body { font-family: system-ui, sans-serif; max-width: 32rem; margin: 4rem auto; padding: 0 1rem; line-height: 1.5; }
      button { font: inherit; padding: 0.6rem 1.2rem; border-radius: 0.4rem; border: 1px solid currentColor; background: none; cursor: pointer; }
    </style>
  </head>
  <body>
    <h1>${title}</h1>
    <p>${detail}</p>
    ${form}
  </body>
</html>`;
  }
}
