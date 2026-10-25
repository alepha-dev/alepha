import { $atom, type Infer, z } from "alepha";

/**
 * How `GET /version` behaves.
 *
 * ⚠️ This configures the ROUTE, never the values. What the record contains is
 * decided at build time and baked into the bundle, so nothing here can change
 * it - see `defineConfig({ meta })` for that half.
 */
export const versionOptions = $atom({
  name: "alepha.server.version.options",
  description: "GET /version route options",
  schema: z.object({
    /**
     * Serve the route at all.
     *
     * Disabled, the path answers 404, which is indistinguishable from no such
     * route. Its own switch rather than a shared one on purpose: an app that
     * would rather not disclose what it is running must be able to say so
     * without also taking down `/health`, which supervisors depend on.
     */
    enabled: z.boolean().default(true).optional(),

    /**
     * Where to serve it.
     *
     * Read once, when the route's field initializes during configure, so set
     * it while wiring the container rather than later.
     */
    path: z.text().default("/version").optional(),

    /**
     * Which top-level fields to publish.
     *
     * Naming `build` includes or drops its three members together: the
     * granularity is deliberately coarse, because the real ask this serves is
     * "publish the version, withhold the SHA" and a finer cut would mean a
     * nested configuration language for a five-field record.
     */
    expose: z
      .array(z.enum(["name", "version", "commit", "build", "framework"]))
      .default(["name", "version", "commit", "build", "framework"])
      .optional(),
  }),
  // `.optional()` on every field so a partial `alepha.set` validates: the
  // store re-validates on write, and a required field would refuse
  // `{ enabled: false }`. The `.default()`s still apply, so what is actually
  // stored is always complete - the optionality is a typing concession, not a
  // runtime one.
  default: {},
  serverOnly: true,
});

export type VersionOptions = Infer<typeof versionOptions.schema>;
