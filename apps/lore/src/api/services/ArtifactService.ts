import { $inject, type FileLike } from "alepha";
import { FileService } from "alepha/api/files";
import { $repository, sql } from "alepha/orm";
import { BadRequestError, ConflictError } from "alepha/server";

import { type Artifact, artifacts } from "../entities/artifacts.ts";
import {
  APP_NAME_MAX_LENGTH,
  APP_NAME_PATTERN,
} from "../schemas/appNameSchema.ts";
import type { ArtifactManifest } from "../schemas/artifactManifestSchema.ts";
import {
  RELEASE_TAG_MAX_LENGTH,
  RELEASE_TAG_PATTERN,
} from "../schemas/releaseTagSchema.ts";
import { ArtifactTarReader } from "./ArtifactTarReader.ts";
import { ImageRegistryClient } from "./ImageRegistryClient.ts";

/**
 * Everything that writes, reads or reclaims an artifact.
 *
 * The controller is the gate and the wire shape; this is where "what does
 * pushing mean" lives, because three callers will eventually ask - the CLI,
 * the MCP tools and the app page - and only one of them should be allowed to
 * decide it.
 *
 * ## The push, in order, and the order matters
 *
 * 1. hash the bytes,
 * 2. read the manifest out of them,
 * 3. look for the row this key already has,
 * 4. only then write anything.
 *
 * Hashing first is what makes a re-push of identical bytes free rather than a
 * second copy in the bucket, and reading the manifest before the write is what
 * keeps a malformed artifact from ever getting a row. A push that fails leaves
 * neither a row nor an object.
 */
export class ArtifactService {
  protected readonly rows = $repository(artifacts);
  protected readonly reader = $inject(ArtifactTarReader);
  protected readonly registry = $inject(ImageRegistryClient);
  protected readonly files = $inject(FileService);

  /**
   * Store a build, or recognise that it is already stored.
   *
   * ## ⚠️ `latest` is mutable. Every other tag is write-once
   *
   * A pinned tag that already holds DIFFERENT bytes is a conflict, not an
   * overwrite. An artifact is what a deploy later fetches by digest, so a tag
   * that quietly changed underneath one would make "which version is running
   * here" unanswerable - the one question content addressing exists to answer.
   * `force` is for the case that actually happens: tagged the wrong commit.
   *
   * {@link MUTABLE_TAG} is the exception, and it is also **the whole retention
   * policy**. Pushing `latest` replaces it in place: one row, one stored
   * object, the previous bytes reclaimed on the way through. That answers
   * "keep only the last build" with no sweep job, no cap and nothing to
   * schedule - which is why there is no `ArtifactJobs` beside this.
   *
   * Rollback is not what that costs. Cloudflare keeps every uploaded Worker
   * version server-side, so a fast rollback never needs an old artifact; and a
   * build worth returning to is a build worth pinning a real tag on.
   */
  public async push(input: ArtifactPushInput): Promise<ArtifactPushResult> {
    const app = this.normalizeApp(input.app);
    const tag = this.normalizeTag(input.tag);

    const bytes = new Uint8Array(await input.file.arrayBuffer());
    if (bytes.length === 0) {
      throw new BadRequestError("The artifact is empty.");
    }

    const sha256 = await this.digest(bytes);
    const manifest = await this.reader.readManifest(bytes);

    const existing = await this.rows.findOne({
      where: {
        projectId: { eq: input.projectId },
        app: { eq: app },
        tag: { eq: tag },
        runtime: { eq: manifest.runtime },
        // ⚠️ The whole key, since `format` joined it. Without this clause a
        // node ARCHIVE push would resolve to the node IMAGE row of the same
        // tag, compare digests that can never match, and then either conflict
        // or `replace` an image row with a tarball.
        format: { eq: ArtifactService.ARCHIVE },
      },
    });

    if (existing) {
      // Identical bytes under an identical key is the same push happening
      // twice - a re-run of a job, a retried step - and answering it with a
      // conflict would turn an idempotent pipeline red for succeeding. Note
      // this comes FIRST, so re-pushing `latest` unchanged replaces nothing
      // and churns no storage.
      if (existing.sha256 === sha256) {
        return { artifact: existing, stored: false };
      }

      if (tag !== ArtifactService.MUTABLE_TAG && !input.force) {
        throw new ConflictError(
          `${app} ${tag} (${manifest.runtime}) already holds different bytes (${existing.sha256.slice(0, 12)}). Every tag but \`${ArtifactService.MUTABLE_TAG}\` is write-once - push --force to move it.`,
        );
      }

      return {
        artifact: await this.replace(existing, {
          projectId: input.projectId,
          app,
          tag,
          sha256,
          size: bytes.length,
          commitSha: input.commitSha,
          file: input.file,
          maps: input.maps,
          manifest,
        }),
        stored: true,
      };
    }

    const stored = await this.files.uploadFile(input.file, {
      bucket: ArtifactService.BUCKET,
      tags: [`project:${input.projectId}`, `app:${app}`, `tag:${tag}`],
    });
    const storedMaps = await this.uploadMaps(
      input.maps,
      input.projectId,
      app,
      tag,
    );

    // The row goes in last. The reverse order leaves, on a failure in between,
    // a row pointing at bytes that were never stored - which every reader
    // would render as an artifact that exists and cannot be fetched.
    try {
      const artifact = await this.rows.create({
        projectId: input.projectId,
        app,
        tag,
        runtime: manifest.runtime,
        format: ArtifactService.ARCHIVE,
        sha256,
        size: bytes.length,
        fileId: stored.id,
        mapsFileId: storedMaps?.id,
        commitSha: input.commitSha,
        manifest: this.serialise(manifest),
      });
      return { artifact, stored: true };
    } catch (error) {
      await this.files.deleteFile(stored.id);
      if (storedMaps) {
        await this.files.deleteFile(storedMaps.id);
      }
      throw error;
    }
  }

  /**
   * Record a container image, or recognise that it is already recorded.
   *
   * The sibling of {@link push}, and deliberately a separate method for the
   * same reason `lore artifacts push-image` is a separate verb: this shares
   * none of the tarball machinery and none of its failure modes. Nothing is
   * uploaded, nothing is hashed here, and no bytes are ever stored - the row
   * records a reference, and `ImageRegistryClient` is what turns that
   * reference into facts by reading the image's own claims.
   *
   * ## ⚠️ No runtime and no platform on the input, and there must never be
   *
   * The runtime comes from the image's `dev.alepha.runtime` label and the
   * platforms are inside the index. Neither is the pusher's to declare, which
   * is the same rule {@link push} follows by reading `dist/manifest.json`
   * rather than accepting a form field.
   *
   * ## Write once, `--force` to move, `latest` excepted
   *
   * Identical to the archive rule, and for the identical reason: an artifact
   * is what answers "which version is running here", and a tag that quietly
   * changed underneath one makes that unanswerable.
   *
   * ⚠️ **The no-op needs BOTH the digest and the reference to match**, where
   * the archive path decides on `sha256` alone. The same image published under
   * two references is a genuinely different answer to "what do I pull", and
   * treating it as a re-push would leave the row naming a string that is no
   * longer what CI pushed.
   */
  public async pushImage(
    input: ArtifactImagePushInput,
  ): Promise<ArtifactPushResult> {
    const app = this.normalizeApp(input.app);
    const tag = this.normalizeTag(input.tag);

    const image = await this.registry.read(input.reference, {
      digest: input.digest,
    });

    // ⚠️ Refused by NAME rather than stored. A Worker does not run in a
    // container, so this row is impossible rather than merely unusual, and a
    // registry that can hold an impossible row is one somebody has to debug
    // later. Note the check is here and not at build time: refusing
    // `target: docker` with `runtime: workerd` in the CLI is a framework
    // behaviour change with its own blast radius, and this is the only moment
    // the combination actually matters.
    if (image.runtime === ArtifactService.CONTAINERLESS_RUNTIME) {
      throw new BadRequestError(
        `${image.reference} declares \`${ImageRegistryClient.RUNTIME_LABEL}: ${image.runtime}\`, and a Worker does not run in a container. Build the image with a \`node\` or \`bun\` runtime, or push the workerd build as an archive with \`lore artifacts push\`.`,
      );
    }

    const existing = await this.rows.findOne({
      where: {
        projectId: { eq: input.projectId },
        app: { eq: app },
        tag: { eq: tag },
        runtime: { eq: image.runtime },
        format: { eq: ArtifactService.IMAGE },
      },
    });

    if (existing) {
      if (
        existing.sha256 === image.digest &&
        existing.reference === image.reference
      ) {
        // A re-run of a release job, which must exit 0 rather than turn an
        // idempotent pipeline red for succeeding.
        return { artifact: existing, stored: false };
      }

      if (tag !== ArtifactService.MUTABLE_TAG && !input.force) {
        throw new ConflictError(
          `${app} ${tag} (${image.runtime}, image) already names ${existing.reference ?? "another image"} at ${existing.sha256.slice(0, 12)}. Every tag but \`${ArtifactService.MUTABLE_TAG}\` is write-once - push --force to move it.`,
        );
      }

      return {
        artifact: await this.rows.updateById(existing.id, {
          reference: image.reference,
          sha256: image.digest,
          // ⚠️ `sql`NULL`` for the same reason the archive replace uses it:
          // the ORM reads an explicit `undefined` as an absent key, so a
          // re-push whose image answers no size would leave the row stating
          // the size of bytes it no longer names.
          size: image.size ?? sql`NULL`,
          commitSha: input.commitSha ?? sql`NULL`,
          manifest: this.serialiseDocument(image.document) ?? sql`NULL`,
        }),
        stored: true,
      };
    }

    return {
      artifact: await this.rows.create({
        projectId: input.projectId,
        app,
        tag,
        runtime: image.runtime,
        format: ArtifactService.IMAGE,
        reference: image.reference,
        sha256: image.digest,
        // Absent is a normal row, never an error: the size is best effort and
        // every surface renders N/A for a variant that has none.
        size: image.size,
        // ⚠️ No `fileId`. Lore stores no bytes for an image, which is what
        // makes this whole path cheap and what `EstatePullController` and
        // `DeployRunner` both check before reaching for one.
        commitSha: input.commitSha,
        manifest: this.serialiseDocument(image.document),
      }),
      stored: true,
    };
  }

  /**
   * The registry document as the column holds it, or nothing when it will not
   * fit - the same rule {@link serialise} applies to a build manifest, and for
   * the same reason: absent already means "unknown" to every reader, while a
   * truncated document is JSON nobody can parse.
   *
   * An OCI index is about a kilobyte against a 64 KB ceiling, so this
   * normally does nothing. It exists because `ImageRegistryClient` will read
   * up to 256 KB and the column will not hold that.
   */
  protected serialiseDocument(document: string): string | undefined {
    return document.length > ArtifactService.MAX_MANIFEST_BYTES
      ? undefined
      : document;
  }

  /**
   * The sibling source-map object, when the push carried one.
   *
   * Same bucket and the same tags as the artifact itself, so a bucket listing
   * groups the pair. It has no row of its own: `artifacts.mapsFileId` is the
   * only reference, which is what makes "written and deleted with the
   * artifact" true by construction rather than by a sweep.
   */
  protected async uploadMaps(
    maps: FileLike | undefined,
    projectId: number,
    app: string,
    tag: string,
  ): Promise<{ id: string } | undefined> {
    if (!maps) {
      return undefined;
    }
    return await this.files.uploadFile(maps, {
      bucket: ArtifactService.BUCKET,
      tags: [`project:${projectId}`, `app:${app}`, `tag:${tag}`, "maps"],
    });
  }

  /**
   * Point an existing key at new bytes, and reclaim the old ones.
   *
   * Upload, then update, then delete - and the order is the whole method. The
   * reverse leaves, on a failure in between, a row resolving to bytes that are
   * already gone, which every reader renders as an artifact that exists and
   * cannot be fetched. This order can only leak an object, which costs money
   * and lies to nobody.
   *
   * That property survives two pushes racing, which is why there is no lock
   * here. Both read the same row, both upload, and whichever updates last
   * wins: the row ends up pointing at one of the two objects that certainly
   * exists, and the loser's upload is orphaned. A dangling row is the failure
   * worth preventing, and this order cannot produce one.
   */
  protected async replace(
    existing: Artifact,
    next: {
      projectId: number;
      app: string;
      tag: string;
      sha256: string;
      size: number;
      commitSha?: string;
      file: FileLike;
      maps?: FileLike;
      manifest: ArtifactManifest;
    },
  ): Promise<Artifact> {
    const stored = await this.files.uploadFile(next.file, {
      bucket: ArtifactService.BUCKET,
      tags: [`project:${next.projectId}`, `app:${next.app}`, `tag:${next.tag}`],
    });
    const storedMaps = await this.uploadMaps(
      next.maps,
      next.projectId,
      next.app,
      next.tag,
    );

    let updated: Artifact;
    try {
      updated = await this.rows.updateById(existing.id, {
        sha256: next.sha256,
        size: next.size,
        fileId: stored.id,
        // ⚠️ `sql\`NULL\`` for the same reason `commitSha` uses it below: a
        // replace whose build produced no maps must stop naming the PREVIOUS
        // build's maps, and an explicit `undefined` reads as an absent key.
        mapsFileId: storedMaps?.id ?? sql`NULL`,
        // ⚠️ `sql\`NULL\``, not `undefined`. The ORM reads an explicit
        // `undefined` as an absent key and leaves the column alone, so a
        // replace pushed without a commit would leave the row still naming the
        // commit that produced the PREVIOUS bytes - a claim nothing else in
        // the system could contradict.
        commitSha: next.commitSha ?? sql`NULL`,
        // ⚠️ Rewritten with the bytes. A `--force` swaps what this tag points
        // at, and a row still describing the PREVIOUS build is worse than one
        // describing none: every reader would trust it.
        manifest: this.serialise(next.manifest) ?? sql`NULL`,
      });
    } catch (error) {
      await this.files.deleteFile(stored.id);
      if (storedMaps) {
        await this.files.deleteFile(storedMaps.id);
      }
      throw error;
    }

    // Both, and in one call: replacing `latest` IS the retention policy, so a
    // maps object that outlived its artifact would be storage nothing can ever
    // reach or name.
    await this.files.deleteFiles(
      [existing.fileId, existing.mapsFileId].filter((id): id is string =>
        Boolean(id),
      ),
    );
    return updated;
  }

  /**
   * The manifest as the column holds it, or nothing when it will not fit.
   *
   * ⚠️ A manifest past the column's ceiling is dropped rather than truncated
   * or refused. Truncating stores JSON that no reader can parse; refusing
   * would fail a push over a field nothing needs yet. Absent already means
   * "unknown" to every reader, which is exactly what an unstorable manifest
   * is.
   */
  protected serialise(manifest: ArtifactManifest): string | undefined {
    const json = JSON.stringify(manifest);
    return json.length > ArtifactService.MAX_MANIFEST_BYTES ? undefined : json;
  }

  /**
   * Matches the column's own `max`, and is the reason {@link serialise} can
   * drop rather than let the insert fail.
   */
  public static readonly MAX_MANIFEST_BYTES = 65_536;

  /**
   * Every artifact of one project, newest first, optionally narrowed to one
   * app or one tag.
   *
   * ⚠️ Ordered by `updatedAt`, and by neither of the two columns that look
   * more obvious.
   *
   * Not `tag`: a tag is a text column, so SQL would sort `1.10.0` above
   * `1.9.0`. The registry has no opinion about version ordering and must not
   * pretend to one - the same trap that put `optional` above `high` on Lore's
   * own board for its whole life.
   *
   * Not `createdAt` either: `latest` is replaced in place, so its `createdAt`
   * is the day that tag first existed. For a tag that moves daily, ordering by
   * it buries today's build under every pinned version pushed since.
   */
  public async list(query: ArtifactQuery): Promise<Artifact[]> {
    return this.rows.findMany({
      where: {
        projectId: { eq: query.projectId },
        ...(query.app ? { app: { eq: this.normalizeApp(query.app) } } : {}),
        ...(query.tag ? { tag: { eq: query.tag } } : {}),
      },
      orderBy: [{ column: "updatedAt", direction: "desc" }],
      limit: query.limit ?? ArtifactService.DEFAULT_LIMIT,
      offset: query.offset,
    });
  }

  /**
   * The same listing, with every runtime of a tag folded into one entry.
   *
   * This is what every read surface renders, and it is grouped here rather
   * than in each of them: `(app, tag, runtime)` being the key is what makes
   * `1.2.3` one release with two variants, and three components each
   * reassembling that from a flat list is three chances to render it as two
   * releases.
   *
   * Groups keep the row order, so the newest push is first; variants inside a
   * group are sorted by `(runtime, format)` - the whole key minus the project,
   * app and tag - so a group does not reshuffle between two reads that pushed
   * nothing.
   */
  public async listGrouped(query: ArtifactQuery): Promise<ArtifactListing> {
    const limit = query.limit ?? ArtifactService.DEFAULT_LIMIT;
    const rows = await this.list({ ...query, limit });

    const groups: ArtifactGrouping[] = [];
    const byKey = new Map<string, ArtifactGrouping>();
    for (const row of rows) {
      // NUL rather than a printable separator: `app` cannot contain one and a
      // tag cannot either, so two different pairs can never collide into one
      // key the way `my-app:1.2` and `my:app:1.2` would.
      const key = `${row.app}\u0000${row.tag}`;
      let group = byKey.get(key);
      if (!group) {
        // The first row of a group is the newest of its variants, since the
        // rows arrive newest first. That is what makes `pushedAt` and
        // `commitSha` below the newest variant's without a second pass.
        group = {
          app: row.app,
          tag: row.tag,
          pushedAt: row.updatedAt,
          commitSha: row.commitSha,
          variants: [],
        };
        byKey.set(key, group);
        groups.push(group);
      }
      group.variants.push(row);
    }

    for (const group of groups) {
      // ⚠️ `(runtime, format)`, not `runtime` alone. Two variants sharing a
      // runtime - a node tarball and a node image of one tag - both return 0
      // from a runtime-only comparator, which makes the guarantee this sort
      // exists for ("a group does not reshuffle between two reads that pushed
      // nothing") false. It also decides what `AppArtifactsRow` shows, since
      // that takes `variants[0]` for the digest: without the second key,
      // whether the row shows a tarball digest or an index digest is a coin
      // flip.
      group.variants.sort(
        (a, b) =>
          a.runtime.localeCompare(b.runtime) ||
          a.format.localeCompare(b.format),
      );
    }

    return { groups, truncated: rows.length >= limit };
  }

  /**
   * One artifact by its whole key.
   */
  public async findOne(key: ArtifactKey): Promise<Artifact | undefined> {
    return this.rows.findOne({
      where: {
        projectId: { eq: key.projectId },
        app: { eq: this.normalizeApp(key.app) },
        tag: { eq: key.tag },
        runtime: { eq: key.runtime },
        // ⚠️ Omitted rather than defaulted when the caller names no format:
        // `(app, tag, node)` genuinely identifies two rows now, and answering
        // with whichever came back first is how a caller asking about the
        // image gets told about the tarball. A caller that means one says so.
        ...(key.format ? { format: { eq: key.format } } : {}),
      },
    });
  }

  /**
   * One artifact by its id, scoped to the project that may read it.
   *
   * ⚠️ The `projectId` filter is the cross-project guard, not decoration: an
   * artifact id is a uuid a caller supplies, and without the filter a member of
   * one project could name another project's build and the gate on the path
   * param would already have passed.
   */
  public async findById(
    projectId: number,
    id: string,
  ): Promise<Artifact | undefined> {
    return this.rows.findOne({
      where: { projectId: { eq: projectId }, id: { eq: id } },
    });
  }

  /**
   * Drop an artifact and the bytes behind it.
   *
   * The row goes first, for the reason `FolioAttachmentService.delete` writes down:
   * the reverse order leaves, on a failure in between, a row that resolves to
   * nothing. Losing the bytes and keeping nothing is the better half.
   */
  public async delete(artifact: Artifact): Promise<void> {
    await this.rows.deleteById(artifact.id);
    await this.files.deleteFiles(
      [artifact.fileId, artifact.mapsFileId].filter((id): id is string =>
        Boolean(id),
      ),
    );
  }

  /**
   * Lowercase hex sha256 of the whole artifact.
   *
   * `crypto.subtle`, not `node:crypto`: this runs on workerd in production and
   * there is no streaming digest there anyway - the bytes are already in hand
   * because `z.file()` materialised them.
   */
  protected async digest(bytes: Uint8Array): Promise<string> {
    const hash = await crypto.subtle.digest(
      "SHA-256",
      bytes as unknown as ArrayBuffer,
    );
    return Array.from(new Uint8Array(hash))
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("");
  }

  /**
   * An app name, normalised the way `SigilController` normalises one.
   *
   * Lowercased before testing rather than refused, because `Lore-Staging` and
   * `lore-staging` are not a difference an operator means - and because the
   * name has to survive `/:projectSlug/apps/:appName` unescaped.
   */
  protected normalizeApp(app: string): string {
    const normalized = app.trim().toLowerCase();
    if (!normalized || normalized.length > APP_NAME_MAX_LENGTH) {
      throw new BadRequestError(
        `App name must be 1 to ${APP_NAME_MAX_LENGTH} characters.`,
      );
    }
    if (!APP_NAME_PATTERN.test(normalized)) {
      throw new BadRequestError(
        `Invalid app name "${app}": lowercase letters, digits and interior hyphens only.`,
      );
    }
    return normalized;
  }

  /**
   * ⚠️ Trimmed but NOT lowercased. The tag is the join key to `releases.tag`,
   * which CI derives from a git tag byte for byte, so a project that tags
   * `RC1` must not find its artifacts filed under `rc1`.
   */
  protected normalizeTag(tag: string): string {
    const normalized = tag.trim();
    if (!normalized || normalized.length > RELEASE_TAG_MAX_LENGTH) {
      throw new BadRequestError(
        `Tag must be 1 to ${RELEASE_TAG_MAX_LENGTH} characters.`,
      );
    }
    if (!RELEASE_TAG_PATTERN.test(normalized)) {
      throw new BadRequestError(
        `Invalid tag "${tag}": letters, digits and interior '.', '_' or '-' only.`,
      );
    }
    return normalized;
  }

  /**
   * The `$storage` the bytes live in.
   *
   * Static so `ArtifactController` can name it from a field initializer, the
   * same way `FolioAttachmentService.BUCKET` is read by `FolioAttachmentController`.
   */
  public static readonly BUCKET = "artifacts";

  /**
   * The one tag whose bytes may change.
   *
   * A literal rather than a project setting: a mutable tag is a promise the
   * whole toolchain has to agree on, and one that varied per project would
   * mean a CLI could not tell whether `--force` was needed without asking.
   */
  public static readonly MUTABLE_TAG = "latest";

  /**
   * The two formats, as the service names them. `artifactFormatSchema` is the
   * validated list; these are so a query filter cannot be a typo.
   */
  public static readonly ARCHIVE = "archive";
  public static readonly IMAGE = "image";

  /**
   * The one runtime an image can never be.
   *
   * A Worker does not run in a container. Stated as a constant rather than
   * inline because it is a claim about the world, not a string.
   */
  public static readonly CONTAINERLESS_RUNTIME = "workerd";

  /**
   * How many artifacts a listing hands back when the caller names no bound.
   */
  protected static readonly DEFAULT_LIMIT = 200;
}

export interface ArtifactKey {
  projectId: number;
  app: string;
  tag: string;
  runtime: string;
  /**
   * Narrow to one format. Optional, because a caller that does not care about
   * the distinction should not have to state one - but a `(app, tag, node)`
   * that matches both a tarball and an image is genuinely ambiguous, and this
   * is how a caller says which it meant.
   */
  format?: string;
}

/**
 * One `(app, tag)` and its variants, as the service builds it. The wire shape
 * is `artifactGroupSchema`; this carries whole rows, because the controller is
 * what decides which columns leave the server.
 */
export interface ArtifactGrouping {
  app: string;
  tag: string;
  pushedAt: string;
  commitSha?: string;
  variants: Artifact[];
}

export interface ArtifactListing {
  groups: ArtifactGrouping[];
  truncated: boolean;
}

export interface ArtifactQuery {
  projectId: number;
  app?: string;
  tag?: string;
  limit?: number;
  offset?: number;
}

export interface ArtifactPushInput {
  projectId: number;
  app: string;
  tag: string;
  commitSha?: string;
  /**
   * Move a pinned tag onto new bytes. Ignored for `latest`, which moves
   * anyway, and it is not an error to pass it there: a CI job that always
   * passes it should not have to know which tag it is pushing.
   */
  force?: boolean;
  file: FileLike;
  /**
   * This build's source maps, as a sibling archive.
   *
   * Optional in both directions: a build may produce none, and a CLI older
   * than #1515 sends none because its maps are still inside the tarball. The
   * object is written and deleted with the artifact row, `latest` replacement
   * included, so it needs no lifecycle of its own.
   */
  maps?: FileLike;
}

export interface ArtifactImagePushInput {
  projectId: number;
  app: string;
  tag: string;
  /**
   * The pullable string, exactly as it should be rendered back.
   *
   * ⚠️ Its docker tag is allowed to differ from `tag`. A project that tags
   * `v0.30.0` in ghcr and `0.30.0` in Lore is doing nothing wrong, and the
   * reference is rendered verbatim so the difference is visible rather than
   * hidden. That is a different class of thing from `(image, workerd)`, which
   * is impossible rather than unusual.
   */
  reference: string;
  commitSha?: string;
  force?: boolean;
  /**
   * What the pusher believes it pushed, checked against what the registry
   * reports.
   *
   * Optional, and `release.yml` sends none: with the record step at the end
   * of the job, a `--metadata-file` value from minutes earlier would have to
   * travel through `$GITHUB_ENV` to guard against a re-tag that cannot happen
   * inside one job. Somebody else's CI may want it, and an unexercised branch
   * is worse than an unused field.
   */
  digest?: string;
}

export interface ArtifactPushResult {
  artifact: Artifact;
  /**
   * False when the push resolved to bytes already held, which is what lets the
   * CLI say "already pushed" instead of claiming an upload that never
   * happened.
   */
  stored: boolean;
}
