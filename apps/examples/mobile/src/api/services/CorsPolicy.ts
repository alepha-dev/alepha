import { $env, $hook, $inject, Alepha, z } from "alepha";
import { CAPACITOR_ORIGINS, corsOptions } from "alepha/server/cors";

/**
 * Who may call this API from a browser context: the native app's two
 * WebView origins, plus whatever `MOBILE_CORS_ORIGINS` adds.
 *
 * The extra list is for the origins only a machine knows: the static shell
 * of the browser suite on its e2e port, or a development shell served over
 * the LAN by `alepha capacitor dev`. Credentials stay off: the app sends a
 * Bearer token, never a cookie.
 */
export class CorsPolicy {
  protected readonly alepha = $inject(Alepha);

  protected readonly env = $env(
    z.object({
      MOBILE_CORS_ORIGINS: z.text({
        default: "",
        description:
          "Extra origins allowed to call the API, comma-separated, e.g. http://localhost:4302.",
      }),
    }),
  );

  protected readonly onConfigure = $hook({
    on: "configure",
    handler: () => {
      const extra = this.env.MOBILE_CORS_ORIGINS.split(",")
        .map((origin) => origin.trim())
        .filter(Boolean);
      this.alepha.store.mut(corsOptions, (options) => ({
        ...options,
        origin: [CAPACITOR_ORIGINS, ...extra].join(","),
        credentials: false,
      }));
    },
  });
}
