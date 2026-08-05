import { AlephaError } from "alepha";
import { files } from "alepha/api/files";
import { $repository } from "alepha/orm";
import { BadRequestError, ConflictError } from "alepha/server";
import {
  type Artifact,
  artifacts,
  isMutableTag,
} from "../entities/artifacts.ts";

/**
 * The registry, on the writing side.
 *
 * Bytes are not this service's business: `alepha/api/files` owns the upload and
 * the provider behind it, exactly as folios do for blobs. What lands here is a
 * row describing bytes that are already stored — which is what keeps the
 * registry portable the day Lore leaves Workers, since nothing in it names a
 * storage provider.
 */
export class ArtifactService {
  protected readonly artifacts = $repository(artifacts);
  protected readonly frameworkFiles = $repository(files);

  /**
   * The bucket deployable artifacts live in.
   *
   * Kept as `releases` rather than renamed alongside the entity: it is a value
   * already persisted on every existing `files` row, and changing it would
   * orphan every artifact ever uploaded. Same reasoning that keeps Lore's
   * `archive-blobs` and `petition-attachments` buckets un-renamed.
   */
  public static readonly BUCKET = "releases";

  /**
   * Records an artifact whose bytes are already uploaded.
   *
   * A mutable tag is replaced in place — one row and one stored object, always
   * current, which is the retention policy rather than a convenience. A pinned
   * tag is write-once, because promote is only meaningful if the bytes behind a
   * tag cannot change between environments.
   *
   * `force` exists for the one case that is not a mistake: having tagged the
   * wrong commit and noticing before anything depends on it.
   */
  public async register(input: {
    projectId: number;
    app: string;
    tag: string;
    sha256: string;
    fileId: string;
    sizeBytes?: number;
    userId?: string;
    force?: boolean;
  }): Promise<Artifact> {
    const sha256 = this.normaliseDigest(input.sha256);

    const frameworkFile = await this.frameworkFiles.findOne({
      where: { id: { eq: input.fileId } },
    });
    if (!frameworkFile) {
      throw new BadRequestError("Framework file row not found — upload first");
    }
    if (frameworkFile.bucket !== ArtifactService.BUCKET) {
      throw new BadRequestError(
        `Framework file is in bucket '${frameworkFile.bucket}', expected '${ArtifactService.BUCKET}'`,
      );
    }

    const existing = await this.resolve(input.projectId, input.app, input.tag);

    if (existing && !isMutableTag(input.tag) && !input.force) {
      throw new ConflictError(
        `${input.app}:${input.tag} already exists (sha ${existing.sha256.slice(0, 12)}…). ` +
          "Pinned tags are immutable — push a new tag, or force to replace it.",
      );
    }

    if (existing) {
      return this.artifacts.updateOne(
        { id: { eq: existing.id } },
        {
          sha256,
          fileId: input.fileId,
          sizeBytes: input.sizeBytes,
          createdBy: input.userId,
        },
      );
    }

    return this.artifacts.create({
      projectId: input.projectId,
      app: input.app,
      tag: input.tag,
      sha256,
      fileId: input.fileId,
      sizeBytes: input.sizeBytes,
      createdBy: input.userId,
    });
  }

  /**
   * The artifact currently behind a tag, if any.
   */
  public async resolve(
    projectId: number,
    app: string,
    tag: string,
  ): Promise<Artifact | undefined> {
    return this.artifacts.findOne({
      where: {
        projectId: { eq: projectId },
        app: { eq: app },
        tag: { eq: tag },
      },
    });
  }

  /**
   * One artifact by id, scoped to its project.
   *
   * Scoped rather than a bare lookup: an id from one project must not resolve
   * for another, or "deploy this artifact" becomes a cross-tenant read.
   */
  public async getInProject(
    projectId: number,
    artifactId: string,
  ): Promise<Artifact | undefined> {
    return this.artifacts.findOne({
      where: { id: { eq: artifactId }, projectId: { eq: projectId } },
    });
  }

  /**
   * The project's artifacts, most recently pushed first.
   */
  public async listByProject(projectId: number): Promise<Artifact[]> {
    return this.artifacts.findMany({
      where: { projectId: { eq: projectId } },
      orderBy: [{ column: "updatedAt", direction: "desc" }],
      limit: 50,
    });
  }

  /**
   * Lowercases a digest and refuses anything that is not 64 hex characters.
   *
   * Echoed back truncated: a rejected digest is worth showing so the caller can
   * see the shape it sent, but a full unvalidated string in an error message is
   * a log-injection surface for no benefit.
   */
  protected normaliseDigest(raw: string): string {
    const sha256 = raw.trim().toLowerCase();
    if (!/^[0-9a-f]{64}$/.test(sha256)) {
      throw new AlephaError(
        `Not a sha256 digest: '${raw.slice(0, 16)}…' (${raw.length} chars, expected 64 hex)`,
      );
    }
    return sha256;
  }
}
