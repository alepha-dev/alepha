import { t } from "alepha";
import { $route } from "alepha/server";

/**
 * Build identification — answers "what's running on this server?".
 *
 * `$route` (not `$action`) so the endpoint lives at `/version` directly,
 * not under the `/api` prefix `$action` would impose.
 *
 * Public on purpose: the repo is open-source on github.com/feunard/lore,
 * so commit SHA / version / build date leak nothing that isn't already
 * scrapable from GitHub. Saves a round-trip to the deploy logs when
 * confirming whether a fix has landed in production.
 *
 * The three values are set in `alepha.config.ts`'s `env` block at
 * build/dev/deploy time and end up in `process.env`. The client bundle
 * gets the same values via Vite's `VITE_` prefix auto-exposure
 * (`import.meta.env.VITE_VERSION` etc.).
 */
export class VersionController {
  getBuildInfo = $route({
    method: "GET",
    path: "/version",
    schema: {
      response: t.object({
        version: t.string(),
        commit: t.string(),
        buildDate: t.string(),
      }),
    },
    handler: () => ({
      version: import.meta.env.VITE_VERSION ?? "unknown",
      commit: import.meta.env.VITE_GIT_COMMIT ?? "unknown",
      buildDate: import.meta.env.VITE_BUILD_DATE ?? "unknown",
    }),
  });
}
