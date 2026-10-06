import { type Infer, z } from "alepha";

/**
 * What kind of thing an artifact row records.
 *
 * - `archive` - a packed build whose bytes Lore holds in the `artifacts`
 *   `$storage`, addressed by `artifacts.fileId`.
 * - `image` - a container image Lore holds only a REFERENCE to, in
 *   `artifacts.reference`. No bytes, no download, nothing to reclaim.
 *
 * ## ⚠️ A format, deliberately not a fifth runtime
 *
 * Lore's own image and Lore's own node tarball are the SAME build:
 * `release.yml` builds the image from the very `dist/` it then packs. A
 * `runtime: "docker"` would make one build look like two runtimes and throw
 * away the fact that the image runs node - which is exactly what
 * `acceptedRuntimes` needs to answer. As formats the two coexist under one
 * tag, which is what the unique key `(projectId, app, tag, runtime, format)`
 * says.
 *
 * `runtime` therefore keeps its meaning across both: an image is `node`, `bun`
 * or `static` compatible, and never `workerd`. That one cross-field
 * combination is impossible rather than merely unusual - a Worker does not run
 * in a container - and `ArtifactService.pushImage` refuses it by name rather
 * than letting the table hold a row somebody has to debug later.
 *
 * ## ⚠️ Only the LIST is a union; the column is a plain string
 *
 * `artifacts.format` is `z.string()` with a `db.default`, for the reason
 * `artifacts.runtime` is a plain string too: a value that fails a column's
 * schema does not read as `undefined`, it throws every query that touches the
 * table. The constraint belongs on the way in, where a rejection is a 400
 * rather than a table nobody can read.
 */
export const ARTIFACT_FORMATS = ["archive", "image"] as const;

export const artifactFormatSchema = z.enum(ARTIFACT_FORMATS);

export type ArtifactFormat = Infer<typeof artifactFormatSchema>;
