/**
 * One answer from one call to Cloudflare's REST API.
 *
 * `status` is `0` when the request never got an answer at all, which is what
 * separates "Cloudflare said no" from "Lore could not ask", the distinction
 * the whole three-valued verdict rests on.
 */
export interface CloudflareProbeResponse {
  /**
   * True only for a `2xx` whose envelope also says `success`.
   */
  ok: boolean;
  /**
   * The HTTP status, or `0` for a network error, a timeout or an aborted
   * request.
   */
  status: number;
  /**
   * Cloudflare's own error codes from the envelope. Every missing permission
   * is `10000`, which is why the permission is named by the probe that
   * failed rather than by anything in here.
   */
  errors: number[];
  /**
   * The envelope's `result`, when the body was a Cloudflare envelope. The
   * identity probe reads `status`, `expires_on` and `not_before` off it.
   */
  result?: Record<string, any>;
}

/**
 * The whole Cloudflare client Lore has: one authenticated `GET`.
 *
 * ⚠️ **Not `alepha/cli/platform-lib`'s `CloudflareApi`.** That one injects
 * `WranglerApi`, which injects `ShellProvider`, so it cannot enter a Worker
 * bundle at all; and its `resolveAccountId` reads
 * `process.env.CLOUDFLARE_ACCOUNT_ID`, which on Lore's own Worker is **Lore's
 * account**, set for Analytics Engine. Importing it would check a user's
 * token against the operator's account and pass.
 *
 * ⚠️ **The token is an argument.** It is never read from the environment,
 * never stored on this class, and never logged: this service has no logger
 * for exactly that reason, and its failures are returned rather than thrown
 * so no stack trace can carry a request it made.
 *
 * The seam for specs is this class: `Alepha.with({ provide, use })` swaps in
 * a scripted one, and nothing here uses `vi.mock`.
 */
export class CloudflareProbeService {
  public static readonly API_BASE = "https://api.cloudflare.com/client/v4";

  /**
   * How long one probe may take. Seven of these run at save time behind a
   * dialog somebody is watching, so a hung connection has to become an
   * "inconclusive" quickly rather than hold the request open.
   */
  public static readonly TIMEOUT_MS = 10_000;

  async get(path: string, token: string): Promise<CloudflareProbeResponse> {
    try {
      const response = await globalThis.fetch(
        `${CloudflareProbeService.API_BASE}${path}`,
        {
          headers: {
            authorization: `Bearer ${token}`,
            accept: "application/json",
          },
          signal: AbortSignal.timeout(CloudflareProbeService.TIMEOUT_MS),
        },
      );

      const body = await this.envelope(response);
      return {
        // Cloudflare answers `200` with `success: false` in some cases, so
        // both halves are required before this counts as a pass.
        ok: response.ok && body.success !== false,
        status: response.status,
        errors: body.errors,
        result: body.result,
      };
    } catch {
      // Deliberately swallowed and reduced to `status: 0`. The caller turns
      // that into "Cloudflare could not be reached", and a thrown error here
      // would have to be caught by every one of the seven call sites to say
      // the same thing.
      return { ok: false, status: 0, errors: [] };
    }
  }

  /**
   * Reads a Cloudflare envelope out of a response, tolerating a body that is
   * not one.
   *
   * An HTML error page from an edge in front of the API is a real answer to
   * a real request, and it must not become an exception: the status is what
   * the verdict is built on, and the body is a bonus.
   */
  protected async envelope(response: Response): Promise<{
    success?: boolean;
    errors: number[];
    result?: Record<string, any>;
  }> {
    try {
      const body = (await response.json()) as {
        success?: boolean;
        errors?: Array<{ code?: number }>;
        result?: Record<string, any>;
      };
      return {
        success: body?.success,
        errors: (body?.errors ?? []).flatMap((error) =>
          typeof error?.code === "number" ? [error.code] : [],
        ),
        result:
          body?.result && typeof body.result === "object"
            ? body.result
            : undefined,
      };
    } catch {
      return { errors: [] };
    }
  }
}
