import { $hook } from "alepha";
import { $logger } from "alepha/logger";
import { ForbiddenError } from "alepha/server";

const STATE_CHANGING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/**
 * CSRF protection via Origin header validation.
 *
 * On every state-changing request (POST, PUT, PATCH, DELETE), validates that the
 * `Origin` header (or `Referer` fallback) matches the server's own origin.
 *
 * Requests without an `Origin` or `Referer` header are allowed through,
 * as SameSite cookies already prevent cross-site requests in that scenario.
 */
export class ServerCsrfProvider {
  protected readonly log = $logger();

  protected readonly onRequest = $hook({
    on: "server:onRequest",
    handler: ({ request }) => {
      if (!STATE_CHANGING_METHODS.has(request.method)) {
        return;
      }

      const origin =
        request.headers.origin ??
        this.extractOriginFromReferer(request.headers.referer);

      if (!origin) {
        return;
      }

      const host = request.headers.host;
      const serverOrigin = host
        ? `${request.protocol}://${host}`
        : request.url.origin;

      if (origin !== serverOrigin) {
        this.log.warn("CSRF origin mismatch", {
          expected: serverOrigin,
          received: origin,
        });
        throw new ForbiddenError("Origin mismatch");
      }
    },
  });

  protected extractOriginFromReferer(referer?: string): string | undefined {
    if (!referer) return undefined;
    try {
      return new URL(referer).origin;
    } catch {
      return undefined;
    }
  }
}
