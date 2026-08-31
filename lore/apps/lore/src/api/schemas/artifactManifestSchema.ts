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
 * What Lore reads out of an artifact's `dist/manifest.json`.
 *
 * ## ⚠️ `version` is a literal, and refusing it is the point
 *
 * `buildManifestSchema` pins `version: 1`. An artifact whose manifest is
 * missing, unparseable, or from a future contract is refused at push time
 * rather than stored and discovered broken by whatever tries to deploy it.
 * The registry's one job is that a row in it describes real, legible bytes.
 *
 * ## ⚠️ `runtime` is REQUIRED here and optional there
 *
 * The framework's manifest makes it optional so that an artifact built before
 * the field existed still reads, with an absent value meaning `node`. Lore
 * cannot take that default: `runtime` is a quarter of this table's unique key,
 * so guessing it would silently file a workerd build under `node` and let the
 * next push overwrite it. An artifact that declares none is refused by name.
 *
 * ## Loose, in both directions
 *
 * `.loose()` for the same reason the framework's own schema is: a newer build
 * carries fields this one has never heard of, and refusing them would make
 * Lore the reason a newer artifact cannot be stored.
 */
export const artifactManifestSchema = z
  .object({
    version: z.literal(1),
    runtime: z.enum(ARTIFACT_RUNTIMES),
  })
  .loose();

/**
 * The subset of `dist/manifest.json` this registry reads.
 */
export type ArtifactManifest = Infer<typeof artifactManifestSchema>;
