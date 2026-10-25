import { $inject, $store, Alepha, type AlephaMeta } from "alepha";

import { versionOptions } from "../atoms/versionOptions.ts";
import { NotFoundError } from "../errors/NotFoundError.ts";
import { $route } from "../primitives/$route.ts";
import { versionSchema } from "../schemas/versionSchema.ts";

/**
 * Registers `GET /version`, answering "what is running here?".
 *
 * Part of `AlephaServer` rather than opt-in, for the same reason `/health` is:
 * every app wants it and every app was writing it by hand. The values come
 * from {@link Alepha.meta}, resolved once at build time, so this route costs
 * nothing to serve and cannot disagree with what the client bundle shows.
 *
 * **Separate from `/health` on purpose.** They answer different questions and
 * have opposite caching rules: this is immutable for the life of a deploy,
 * while readiness must never be cached. `/health` is also polled on a loop by
 * supervisors, so its payload stays minimal and its schema stays a frozen
 * contract. And an app that would rather not say what it is running can turn
 * this off without turning off readiness, which a shared route could not offer.
 *
 * Not a security concern by default: it discloses a version, a commit and a
 * build date, which say nothing an unauthorized caller can act on. An app that
 * disagrees has {@link versionOptions} - `expose` to withhold fields, `enabled`
 * to remove the route.
 */
export class ServerVersionProvider {
  protected readonly alepha = $inject(Alepha);

  protected readonly options = $store(versionOptions);

  /**
   * ⚠️ `path` is read HERE, while the class field initializes, which is before
   * the container has started. That makes it the one option of the three that
   * an `alepha.set()` cannot change: routes are registered during configure,
   * so by the time a post-creation write lands, this route already has its
   * path. Seed it at construction instead:
   *
   * ```ts
   * Alepha.create({ "alepha.server.version.options": { path: "/_version" } });
   * ```
   *
   * `enabled` and `expose` have no such constraint - they are read per
   * request, long after everything has settled, so `alepha.set()` works for
   * them at any point.
   */
  public readonly version = $route({
    path: this.options.path ?? "/version",
    schema: {
      response: versionSchema,
    },
    silent: true,
    handler: () => this.buildInfo(),
  });

  protected buildInfo() {
    // A disabled route answers exactly like a route that was never registered.
    // Anything else would confirm the endpoint exists, which defeats the point
    // of turning it off.
    if (this.options.enabled === false) {
      throw new NotFoundError();
    }

    const meta = this.alepha.meta;
    const shown: Record<string, unknown> = {};
    for (const field of [
      "name",
      "version",
      "commit",
      "build",
      "framework",
    ] as const) {
      if (this.shows(field)) {
        shown[field] = meta[field];
      }
    }
    return shown;
  }

  /**
   * Whether one top-level field is published.
   *
   * No allowlist configured means no restriction, which is why this reads the
   * absent case as "show it" rather than repeating the full default list here.
   */
  protected shows(field: keyof AlephaMeta): boolean {
    const expose = this.options.expose;
    return !expose || expose.includes(field);
  }
}
