import { $hook, $inject } from "alepha";
import { SigilForwardProvider } from "./SigilForwardProvider.ts";

/**
 * Pipes server request errors into the same Sigil blights inbox, tagged
 * server-origin. Low-volume, so forwarded immediately (no batching).
 */
export class SigilServerErrors {
  protected readonly forward = $inject(SigilForwardProvider);

  protected readonly onError = $hook({
    on: "server:onError",
    handler: async ({ route, error }) => {
      if (!this.forward.enabled()) return;
      // Don't forward EXPECTED HTTP auth errors to the blights inbox: 401
      // (UnauthorizedError) and 403 (ForbiddenError / SecurityError) are routine
      // logged-out / under-privileged hits, not crashes — forwarding them buries
      // real blights under noise. Genuine 5xx and uncaught exceptions (no status)
      // still report.
      const status = (error as { status?: number } | undefined)?.status;
      if (status === 401 || status === 403) return;
      await this.forward.forwardIngest(
        {
          errors: [
            {
              name: error?.name ?? "Error",
              message: String(error?.message ?? "").slice(0, 2000),
              stack: String(error?.stack ?? "").slice(0, 4096),
              sourceUrl: route?.path ?? "",
              origin: "server",
            },
          ],
        },
        {},
      );
    },
  });
}
