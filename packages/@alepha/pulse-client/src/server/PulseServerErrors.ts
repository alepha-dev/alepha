import { $hook, $inject } from "alepha";
import { PulseSinkProvider } from "./PulseSinkProvider.ts";

/**
 * Feeds server-side request errors into the same pipeline as the browser's,
 * tagged `origin: "server"`.
 *
 * Handed to the sink provider rather than sent directly, so a server-side crash
 * loop is aggregated by fingerprint exactly like a client one — which is the
 * case that matters most, since a failing endpoint can produce thousands of
 * identical errors a minute.
 */
export class PulseServerErrors {
  protected readonly sink = $inject(PulseSinkProvider);

  protected readonly onError = $hook({
    on: "server:onError",
    handler: async ({ route, error }) => {
      // Expected auth outcomes are not crashes: 401 and 403 are a logged-out
      // visitor and an under-privileged one, and forwarding them buries real
      // errors under routine traffic. Genuine 5xx and uncaught exceptions (no
      // status at all) still report.
      const status = (error as { status?: number } | undefined)?.status;
      if (status === 401 || status === 403) return;

      await this.sink.ingest({
        errors: [
          {
            name: error?.name ?? "Error",
            message: String(error?.message ?? "").slice(0, 2000),
            stack: String(error?.stack ?? "").slice(0, 4096),
            sourceUrl: route?.path ?? "",
            origin: "server",
          },
        ],
      });
    },
  });
}
