import { $env, $hook, z } from "alepha";
import { $logger } from "alepha/logger";

/**
 * The "indefinitely pending API" scenario of the test app.
 *
 * With `MOBILE_API_STALL=true`, every API and auth request is accepted and
 * never answered, which is what a captive portal or a dead backend behind a
 * live load balancer looks like to a phone. The page that boots the shell is
 * still served, so only the requests a loader or a session restore makes
 * hang. The unreachable case needs no switch: stop the API.
 */
export class ApiStallSwitch {
  protected readonly log = $logger();

  protected readonly env = $env(
    z.object({
      MOBILE_API_STALL: z
        .boolean()
        .describe("Accept every /api and /_auth request and never answer it.")
        .default(false),
    }),
  );

  protected readonly onRequest = $hook({
    on: "server:onRequest",
    priority: "first",
    handler: async ({ request }) => {
      if (!this.env.MOBILE_API_STALL) return;
      const path = request.url.pathname;
      if (!path.startsWith("/api/") && !path.startsWith("/_auth/")) return;

      this.log.warn("Stalling request", { path });
      await new Promise<never>(() => {});
    },
  });
}
