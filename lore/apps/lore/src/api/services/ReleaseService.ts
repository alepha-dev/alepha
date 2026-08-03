import { AlephaError } from "alepha";
import { files } from "alepha/api/files";
import { $repository, DbConflictError } from "alepha/orm";
import { BadRequestError, ConflictError } from "alepha/server";
import { type Release, releases } from "../entities/releases.ts";

/**
 * The registry, on the writing side.
 *
 * Bytes are not this service's business: `alepha/api/files` owns the upload
 * flow and the provider behind it, exactly as the Archive does for blobs. What
 * lands here is a row describing an artifact that has already been stored —
 * which is what keeps the registry portable the day Lore leaves Workers, since
 * nothing in it names a storage provider.
 */
export class ReleaseService {
  protected readonly releases = $repository(releases);
  protected readonly frameworkFiles = $repository(files);

  /**
   * The bucket deployable artifacts live in.
   *
   * Named here rather than in the controller so the write path and any future
   * reader agree by construction — a blob validated against one bucket name and
   * fetched from another is a class of bug that only shows up in production.
   */
  public static readonly BUCKET = "releases";

  /**
   * Records an artifact that has already been uploaded.
   *
   * The digest is the identity of the release, so it is validated before
   * anything else: a row carrying a malformed one would send every outpost
   * that claims it into a download it can only reject.
   */
  public async register(input: {
    campaignId: number;
    app: string;
    environment: string;
    version: string;
    sha256: string;
    fileId: string;
    sizeBytes?: number;
    userId?: string;
  }): Promise<Release> {
    const sha256 = this.normaliseDigest(input.sha256);

    const frameworkFile = await this.frameworkFiles.findOne({
      where: { id: { eq: input.fileId } },
    });
    if (!frameworkFile) {
      throw new BadRequestError("Framework file row not found — upload first");
    }
    if (frameworkFile.bucket !== ReleaseService.BUCKET) {
      throw new BadRequestError(
        `Framework file is in bucket '${frameworkFile.bucket}', expected '${ReleaseService.BUCKET}'`,
      );
    }

    try {
      return await this.releases.create({
        campaignId: input.campaignId,
        app: input.app,
        environment: input.environment,
        version: input.version,
        sha256,
        fileId: input.fileId,
        sizeBytes: input.sizeBytes,
        createdBy: input.userId,
      });
    } catch (error) {
      // The unique index is what actually guarantees one row per version; this
      // catch only exists to explain it. Redeploying a version already on file
      // is an operator mistake, and answering 409 says so — silently returning
      // the existing row would let a rebuilt artifact be quietly ignored while
      // the pipeline reported success.
      if (error instanceof DbConflictError) {
        throw new ConflictError(
          `Release '${input.version}' already exists for ${input.app}/${input.environment}. Build a new version rather than replacing this one.`,
        );
      }
      throw error;
    }
  }

  public async get(id: string): Promise<Release | undefined> {
    return this.releases.findOne({ where: { id: { eq: id } } });
  }

  /**
   * The campaign's recent releases, newest first.
   *
   * Capped rather than paginated: this answers "what happened lately", and the
   * caller that needs more than twenty is asking a different question that
   * deserves its own query.
   */
  public async listByCampaign(campaignId: number): Promise<Release[]> {
    return this.releases.findMany({
      where: { campaignId: { eq: campaignId } },
      orderBy: [{ column: "createdAt", direction: "desc" }],
      limit: 20,
    });
  }

  /**
   * Lowercases a digest and refuses anything that is not 64 hex characters.
   *
   * The value is echoed back truncated: a rejected digest is worth showing so
   * the caller can see the shape it sent, but a full unvalidated string in an
   * error message is a log-injection surface for no benefit.
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
