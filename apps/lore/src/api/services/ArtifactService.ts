import { $inject, type FileLike } from "alepha";
import { FileService } from "alepha/api/files";
import { $repository } from "alepha/orm";
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
   * ## ⚠️ Write-once, deliberately
   *
   * A key that already holds DIFFERENT bytes is a conflict, not an overwrite.
   * An artifact is what a deploy will later fetch by digest, so a tag that
   * quietly changed underneath one would make "which version is running here"
   * unanswerable - which is the one question content addressing exists to
   * answer.
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
      // conflict would turn an idempotent pipeline red for succeeding.
      if (existing.sha256 === sha256) {
        return { artifact: existing, stored: false };
      }

      throw new ConflictError(
        `${app} ${tag} (${manifest.runtime}) already holds different bytes (${existing.sha256.slice(0, 12)}). Tags are write-once.`,
      );
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
   * Every artifact of one project, newest first, optionally narrowed to one
   * app or one tag.
   *
   * ⚠️ Ordered by `createdAt`, never by `tag`. A tag is a text column and SQL
   * would sort `1.10.0` above `1.9.0`; the registry has no opinion about
   * version ordering and must not pretend to one.
   */
  public async list(query: ArtifactQuery): Promise<Artifact[]> {
    return this.rows.findMany({
      where: {
        projectId: { eq: query.projectId },
        ...(query.app ? { app: { eq: this.normalizeApp(query.app) } } : {}),
        ...(query.tag ? { tag: { eq: query.tag } } : {}),
      },
      orderBy: [{ column: "createdAt", direction: "desc" }],
      limit: query.limit ?? ArtifactService.DEFAULT_LIMIT,
      offset: query.offset,
    });
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
   * The row goes first, for the reason `FolioBlobService.delete` writes down:
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
   * same way `FolioBlobService.BUCKET` is read by `BlobController`.
   */
  public static readonly BUCKET = "artifacts";

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
