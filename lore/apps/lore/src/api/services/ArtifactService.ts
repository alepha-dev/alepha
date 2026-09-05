import { $inject, type FileLike } from "alepha";
import { FileService } from "alepha/api/files";
import { $repository, sql } from "alepha/orm";
import { BadRequestError, ConflictError } from "alepha/server";

import { type Artifact, artifacts } from "../entities/artifacts.ts";
import {
  APP_NAME_MAX_LENGTH,
  APP_NAME_PATTERN,
} from "../schemas/appNameSchema.ts";
import {
  RELEASE_TAG_MAX_LENGTH,
  RELEASE_TAG_PATTERN,
} from "../schemas/releaseTagSchema.ts";
import { ArtifactTarReader } from "./ArtifactTarReader.ts";

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
        }),
        stored: true,
      };
    }

    const stored = await this.files.uploadFile(input.file, {
      bucket: ArtifactService.BUCKET,
      tags: [`project:${input.projectId}`, `app:${app}`, `tag:${tag}`],
    });

    // The row goes in last. The reverse order leaves, on a failure in between,
    // a row pointing at bytes that were never stored - which every reader
    // would render as an artifact that exists and cannot be fetched.
    try {
      const artifact = await this.rows.create({
        projectId: input.projectId,
        app,
        tag,
        runtime: manifest.runtime,
        sha256,
        size: bytes.length,
        fileId: stored.id,
        commitSha: input.commitSha,
      });
      return { artifact, stored: true };
    } catch (error) {
      await this.files.deleteFile(stored.id);
      throw error;
    }
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
    },
  ): Promise<Artifact> {
    const stored = await this.files.uploadFile(next.file, {
      bucket: ArtifactService.BUCKET,
      tags: [`project:${next.projectId}`, `app:${next.app}`, `tag:${next.tag}`],
    });

    let updated: Artifact;
    try {
      updated = await this.rows.updateById(existing.id, {
        sha256: next.sha256,
        size: next.size,
        fileId: stored.id,
        // ⚠️ `sql\`NULL\``, not `undefined`. The ORM reads an explicit
        // `undefined` as an absent key and leaves the column alone, so a
        // replace pushed without a commit would leave the row still naming the
        // commit that produced the PREVIOUS bytes - a claim nothing else in
        // the system could contradict.
        commitSha: next.commitSha ?? sql`NULL`,
      });
    } catch (error) {
      await this.files.deleteFile(stored.id);
      throw error;
    }

    await this.files.deleteFiles([existing.fileId]);
    return updated;
  }

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
   * group are sorted by runtime name, so a group does not reshuffle between
   * two reads that pushed nothing.
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
      group.variants.sort((a, b) => a.runtime.localeCompare(b.runtime));
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
      },
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
    await this.files.deleteFiles([artifact.fileId]);
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
   * How many artifacts a listing hands back when the caller names no bound.
   */
  protected static readonly DEFAULT_LIMIT = 200;
}

export interface ArtifactKey {
  projectId: number;
  app: string;
  tag: string;
  runtime: string;
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
