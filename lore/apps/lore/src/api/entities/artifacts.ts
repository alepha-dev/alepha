import { type Infer, z } from "alepha";
import { $entity, db } from "alepha/orm";

import { projects } from "./projects.ts";

/**
 * What CI built: one row per `(project, app, tag, runtime)`, the bytes in a
 * `$storage` and the identity in `sha256`.
 *
 * Nothing here deploys anything. An artifact is a build that was kept, and the
 * only questions this table answers are "what has this project built" and "is
 * the tag I am about to reference real".
 *
 * ## ⚠️ Runtime is a dimension, not a filename convention
 *
 * `(projectId, app, tag, runtime)` is the unique key, so `1.2.3` names ONE
 * release that may carry a workerd build and a node build. The alternative
 * considered and rejected was `my-app_1.2.3_cloudflare.tar.gz`, which gives up
 * exactly that: it makes two builds of one release look like two releases.
 *
 * The value is read from the artifact's own `dist/manifest.json` at push time
 * and never from the filename - see `ArtifactTarReader`. A mislabelled
 * upload therefore still lands under the runtime it was actually built for.
 *
 * The column is a plain string rather than an enum on purpose, the same way
 * `sigils.name` is looser than `appNameSchema`: a value that fails a column's
 * schema does not read as `undefined`, it throws every query that touches the
 * table. The constraint lives on the way in (`artifactManifestSchema`), where
 * a rejection is a 400 rather than a table nobody can read.
 *
 * ## ⚠️ `tag` preserves case, and joins to `releases.tag`
 *
 * The join to a release is `artifacts.tag = releases.tag`, with no join table
 * and no foreign key: a release named `0.28.0` and an artifact tagged `0.28.0`
 * are the same fact stated twice. Case is preserved because CI derives a tag
 * from a git tag byte for byte, so lowercasing `RC1` would silently break the
 * join. See `releaseTagSchema`.
 *
 * An artifact with no release and a release with no artifact are both normal.
 *
 * ## `fileId` is logical, like `folio_blobs.fileId`
 *
 * There is no physical foreign key onto `files`, and there must not be one:
 * adding the constraint means a table rebuild, and a rebuild on D1 is the
 * cascade-wipe this app has already been bitten by once (see "Migration safety
 * on D1" in `apps/lore/CLAUDE.md`). `ArtifactService` is what enforces the
 * relationship: it deletes the framework file whenever it drops a row.
 *
 * `projectId` cascades: wiping a project wipes its artifacts. The bytes are
 * reclaimed by `ProjectDeletionService`, not by the cascade.
 */
export const artifacts = $entity({
  name: "artifacts",
  schema: z.object({
    id: db.primaryKey(z.uuid()),
    createdAt: db.createdAt(),
    /**
     * When the bytes under this key were last replaced. Only a mutable tag can
     * move it; a pinned tag is written once and never updated.
     */
    updatedAt: db.updatedAt(),
    projectId: db.ref(z.integer(), () => projects.cols.id, {
      onDelete: "cascade",
    }),
    /**
     * The app the artifact was built from, matching a sigil's `name` when the
     * project has one enrolled - but NOT a foreign key onto `sigils`.
     *
     * An artifact is pushed by CI and a sigil is enrolled by an operator; a
     * project that ships a build for an app it never enrolled is a normal
     * state, and refusing the push would make the registry depend on a
     * telemetry decision that has nothing to do with it.
     */
    app: z.string().min(1).max(100),
    /**
     * The version this build is named by: `1.2.3`, `latest`, `demo-1`.
     */
    tag: z.string().min(1).max(100),
    /**
     * `node` | `bun` | `workerd` | `static`, read from `dist/manifest.json`.
     */
    runtime: z.string().min(1).max(32),
    /**
     * Lowercase hex sha256 of the tarball. The artifact's identity: a re-push
     * of identical bytes is a no-op, and a deploy that already holds this
     * digest has nothing to download.
     */
    sha256: z.string().min(64).max(64),
    /**
     * Size of the tarball in bytes.
     */
    size: z.integer().min(0),
    /**
     * The `files` row holding the bytes. Logical, see the class doc.
     */
    fileId: z.uuid(),
    /**
     * The commit CI built from, when it said. Optional because a push from a
     * laptop has no commit to name and an artifact is not a git object.
     */
    commitSha: z.string().max(40).optional(),
  }),
  indexes: [
    // The push target, and what makes a re-push resolvable to one row.
    { columns: ["projectId", "app", "tag", "runtime"], unique: true },
    // The release detail page: every artifact sharing a tag, across apps.
    { columns: ["projectId", "tag"] },
    // The app page: this app's builds, newest first.
    { columns: ["projectId", "app"] },
  ],
});

export type Artifact = Infer<typeof artifacts.schema>;
