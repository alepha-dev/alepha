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
