import { type Infer, z } from "alepha";
import { $entity, db } from "alepha/orm";

import { projects } from "./projects.ts";

/**
 * What CI built: one row per `(project, app, tag, runtime, format)`, the bytes
 * in a `$storage` for an archive and a pullable reference for an image.
 *
 * Nothing here deploys anything. An artifact is a build that was kept, and the
 * only questions this table answers are "what has this project built" and "is
 * the tag I am about to reference real".
 *
 * ## ⚠️ Format is the second dimension, and it is not a runtime
 *
 * `archive` is a tarball Lore holds the bytes of; `image` is a reference into
 * a registry Lore holds no bytes of. Lore's own image and Lore's own node
 * tarball are the SAME build - `release.yml` builds the image from the very
 * `dist/` it then packs - so a fifth `runtime` value would make one build look
 * like two runtimes and throw away the fact that the image runs node, which is
 * what `acceptedRuntimes` needs. As formats they coexist:
 * `(lore, 0.30.0, node, archive)` and `(lore, 0.30.0, node, image)`.
 *
 * `(image, workerd)` is impossible - a Worker does not run in a container -
 * and is refused at push time rather than stored, so this table can never hold
 * a row somebody has to debug. See `ArtifactService.pushImage`.
 *
 * ⚠️ **No platform or arch column, deliberately.** A multi-arch build is ONE
 * manifest list under one tag and `docker pull` resolves the arch, so two rows
 * would say "0.30.0 has two images" about a thing that is one image - the
 * mistake `artifactGroupSchema` exists to prevent. The platform list is
 * already inside the OCI index, and the index is what `manifest` holds.
 *
 * ## ⚠️ Runtime is a dimension, not a filename convention
 *
 * `(projectId, app, tag, runtime, format)` is the unique key, so `1.2.3` names
 * ONE release that may carry a workerd build and a node build. The alternative
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
 * ## `fileId` is logical, like `folio_blobs.fileId`, and now also optional
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
     * When the bytes under this key were last replaced.
     *
     * `latest` moves on its own and a pinned tag moves only under `--force`,
     * so on a pinned row this normally equals `createdAt` - and where it does
     * not, somebody retagged deliberately and this is the record of it.
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
     *
     * ⚠️ `latest` is the one tag whose bytes may change, and replacing it in
     * place IS the retention policy: one row and one stored object per key,
     * with no sweep job and nothing to cap. Every other tag is write-once.
     * See `ArtifactService.push`.
     */
    tag: z.string().min(1).max(100),
    /**
     * `node` | `bun` | `workerd` | `static`, read from `dist/manifest.json`
     * for an archive and from the image's `dev.alepha.runtime` label for an
     * image.
     *
     * ⚠️ It keeps its meaning across both formats, which is the whole reason
     * `format` is a separate column: an image runs `node`, `bun` or `static`
     * code, never `workerd`, and a deployer that learns to run containers
     * still needs to know which.
     */
    runtime: z.string().min(1).max(32),
    /**
     * `archive` | `image`. Which kind of thing this row records.
     *
     * `archive` is a tarball whose bytes are in the `artifacts` `$storage`
     * and addressed by {@link fileId}. `image` is a reference into a container
     * registry, in {@link reference}, whose bytes Lore never holds.
     *
     * A plain string with a default rather than an enum, for the reason
     * `runtime` is one: a value that fails a column's schema does not read as
     * `undefined`, it throws every query that touches the table. The
     * constraint lives on the way in, where a rejection is a 400.
     *
     * ⚠️ The `db.default` is also the BACKFILL. Every row that existed before
     * this column is an archive, and the DDL default says so without a
     * separate `UPDATE` and without a window where a row reads as neither.
     */
    format: db.default(z.string().min(1).max(16), "archive"),
    /**
     * The pullable string for an image: `ghcr.io/alepha-dev/lore:0.30.0`.
     *
     * Absent for an archive, which has nothing to pull. Rendered VERBATIM on
     * every surface, which is what makes a project that tags `v0.30.0` in the
     * registry and `0.30.0` here visible rather than hidden - that mismatch is
     * unusual, not wrong, and it is allowed.
     *
     * 512 rather than 255: a registry host plus an org plus a repository plus
     * a tag is comfortably under it, and a `z.text()` cap would be a blank
     * screen the day one overflowed rather than a truncated cell.
     */
    reference: z.string().max(512).optional(),
    /**
     * Lowercase hex sha256. The artifact's identity: a re-push of identical
     * bytes is a no-op, and a deploy that already holds this digest has
     * nothing to download.
     *
     * The tarball's digest for an archive; the INDEX digest for an image, with
     * the registry's `sha256:` prefix already stripped - the column is exactly
     * 64 characters and a registry reports 71.
     */
    sha256: z.string().min(64).max(64),
    /**
     * Size in bytes: the tarball's, exactly, for an archive.
     *
     * ⚠️ **Optional, and best effort for an image.** An image's size is summed
     * from the child manifest the registry client already had in hand, so it
     * costs no extra call and is absent whenever that document did not answer
     * it. Where it is present for an image it is ONE architecture's compressed
     * total for a tag that may carry two. Every surface has to render "no
     * size" rather than `NaN`.
     */
    size: z.integer().min(0).optional(),
    /**
     * The `files` row holding the bytes. Logical, see the class doc.
     *
     * ⚠️ **Absent for an image**: Lore stores a reference, never bytes. A
     * reader that fetches by this must check the format first - the compiler
     * points at both of them (`EstatePullController.pullArtifact` and
     * `DeployRunner.artifactBytes`), and neither should be silenced with a
     * cast.
     */
    fileId: z.uuid().optional(),
    /**
     * The commit CI built from, when it said. Optional because a push from a
     * laptop has no commit to name and an artifact is not a git object.
     */
    commitSha: z.string().max(40).optional(),
    /**
     * The `files` row holding this build's source maps, when it shipped any.
     *
     * ⚠️ **A sibling object, not a second artifact.** `*.map` is excluded from
     * the tarball since #1515 - 266 of 267 server files in a Lore build had
     * one, and they were roughly 5 MB of a 6.4 MB gzipped archive that no
     * runtime reads. They are kept rather than discarded, because they are
     * what makes an error report readable, and they hang off the artifact row
     * so they need no identity, no key and no retention rule of their own:
     * written and deleted with it, `latest` replacement included.
     *
     * Optional because a build may produce none, and because every artifact
     * pushed before #1515 has its maps inside the tarball instead.
     */
    mapsFileId: z.uuid().optional(),
    /**
     * The build's own document, as the server read it. ⚠️ **Two shapes, told
     * apart only by {@link format}.**
     *
     * - `archive`: `dist/manifest.json`, read out of the tarball.
     * - `image`: the OCI index (or manifest list) the registry answered for
     *   the tag, which is where the per-architecture digests and the platform
     *   list already live.
     *
     * A reader MUST switch on `format` before parsing. Nothing enforces this
     * at the type level, so the two shapes are the price paid for reusing the
     * column, and it is paid deliberately: the alternative was a
     * `dev.alepha.manifest` label carrying `dist/manifest.json` inside every
     * image, which buys a capability this schema does not have (deploying an
     * image) at the cost of 3 KB in every `docker inspect`.
     *
     * The one existing reader is `DeployService.declaresSigil`, which looks
     * for an `env` array and finds none in an index. That is the right answer
     * and it is pinned by a spec, so it is a decision rather than an accident.
     *
     * ⚠️ **Derived here, never accepted from the pusher.** The push could
     * carry this as a field and save a scan, and then the registry would
     * describe whatever the client said - with `runtime` being a quarter of
     * this table's unique key, a `workerd` build could be filed as `node` and
     * the deploy would be where anybody found out. The bytes are already
     * resident for the sha256, so reading it from them costs nothing and is
     * the whole difference between a registry and a bucket with a table
     * beside it. See `ArtifactTarReader`.
     *
     * ⚠️ **Absent means UNKNOWN, never "declares nothing".** Every artifact
     * pushed before this column existed has none, so a reader that treats
     * absence as an empty manifest would conclude those builds want no
     * database, no bucket and no variables. `DeployService` reads it only to
     * ADD behaviour (minting a sigil the build asks for), so a null degrades
     * to the previous behaviour rather than to a wrong one.
     *
     * ⚠️ **`ArtifactService.replace()` must rewrite it.** A `--force` re-push
     * swaps the bytes under a tag, and a row still describing the old ones is
     * worse than a row describing none.
     *
     * Stored as text rather than a column per field: it is the build's own
     * document, it is `.loose()` on the way in because a newer build carries
     * fields this Lore has never heard of, and a column per field would have
     * to be migrated every time the manifest grows. Roughly 3 KB for Lore
     * itself, 1 KB for a small app.
     */
    manifest: z.string().max(65_536).optional(),
  }),
  indexes: [
    // The push target, and what makes a re-push resolvable to one row.
    // `format` joins it so one tag can carry a node tarball and a node image
    // without the two colliding into one key.
    { columns: ["projectId", "app", "tag", "runtime", "format"], unique: true },
    // The release detail page: every artifact sharing a tag, across apps.
    { columns: ["projectId", "tag"] },
    // The app page: this app's builds, newest first.
    { columns: ["projectId", "app"] },
  ],
});

export type Artifact = Infer<typeof artifacts.schema>;
