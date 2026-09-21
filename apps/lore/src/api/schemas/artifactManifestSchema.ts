import { type Infer, z } from "alepha";

/**
 * The runtimes an artifact may declare, matching `buildManifestSchema`'s own
 * `runtime` enum in `alepha/cli`.
 *
 * Three of the four name a JavaScript runtime; `static` is "nothing, serve the
 * files". Restated here rather than imported because the import would pull
 * `alepha/cli` into a Worker bundle that has no business carrying a build
 * pipeline. The manifest schema is `.loose()` by design, so reading a narrow
 * subset of it is the contract working as intended - not a shortcut.
 */
export const ARTIFACT_RUNTIMES = ["node", "bun", "workerd", "static"] as const;

/**
 * What Lore reads out of an artifact's `manifest.json`.
 *
 * ## ⚠️ `runtimes` is REQUIRED, and it is the whole runtime declaration
 *
 * Every runtime slice the archive carries, in declared order (#Q2462). The
 * first is the primary, which is the row's `runtime` and a quarter of the
 * `artifacts` unique key; the list is what a deploy matches an estate against,
 * so a `node,workerd` archive deploys to a Bay and to a Cloudflare account
 * alike. An artifact that declares none is refused by name rather than
 * guessed at: guessing would silently file a workerd build under `node`.
 *
 * There is no version field and no scalar `runtime`: the framework dropped
 * both in manifest v2 (#Q2460, #Q2465), and no older archive remains.
 *
 * ## Loose, in both directions
 *
 * `.loose()` for the same reason the framework's own schema is: a newer build
 * carries fields this one has never heard of, and refusing them would make
 * Lore the reason a newer artifact cannot be stored.
 */
export const artifactManifestSchema = z
  .object({
    runtimes: z
      .array(z.object({ runtime: z.enum(ARTIFACT_RUNTIMES) }).loose())
      .min(1),
  })
  .loose();

/**
 * The subset of `manifest.json` this registry reads.
 */
export type ArtifactManifest = Infer<typeof artifactManifestSchema>;
