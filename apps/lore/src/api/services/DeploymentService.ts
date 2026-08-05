import { $inject, AlephaError } from "alepha";
import { files } from "alepha/api/files";
import { DateTimeProvider } from "alepha/datetime";
import { $repository, DbConflictError } from "alepha/orm";
import { BadRequestError, ConflictError, NotFoundError } from "alepha/server";
import { artifacts } from "../entities/artifacts.ts";
import {
  type Deployment,
  type DeploymentStatus,
  deployments,
} from "../entities/deployments.ts";
import type { Outpost } from "../entities/outposts.ts";

/**
 * The ledger: which artifact was placed where, and what became of it.
 *
 * Bytes are not this service's business — `alepha/api/files` owns the upload
 * and `ArtifactService` owns what the bytes *are*. What lands here is the act
 * of putting one on an environment, which is why a row is the synchronisation
 * point: the client writes it, an outpost claims it, and the client watches it
 * until it settles. No queue and no callback, because a row both sides can
 * read survives either of them restarting mid-deploy.
 */
export class DeploymentService {
  protected readonly deployments = $repository(deployments);
  protected readonly artifacts = $repository(artifacts);
  protected readonly frameworkFiles = $repository(files);
  protected readonly dateTime = $inject(DateTimeProvider);

  /**
   * How long a claim survives without news.
   *
   * A machine that claims a release and then dies would otherwise hold it
   * forever, and the release would be indistinguishable from one no outpost has
   * seen. Sixty seconds, and it must stay **well** under the deploying client's
   * own timeout: a claim that expires later than the client gives up means `up`
   * fails on a release that would have been retried on its own.
   */
  public static readonly CLAIM_EXPIRY_MS = 60_000;

  /**
   * The bucket deployable artifacts live in.
   *
   * Named here rather than in the controller so the write path and any future
   * reader agree by construction — a blob validated against one bucket name and
   * fetched from another is a class of bug that only shows up in production.
   */
  public static readonly BUCKET = "deployments";

  /**
   * Records an artifact that has already been uploaded.
   *
   * The digest is the identity of the release, so it is validated before
   * anything else: a row carrying a malformed one would send every outpost
   * that claims it into a download it can only reject.
   */
  public async register(input: {
    projectId: number;
    app: string;
    environment: string;
    version: string;
    sha256: string;
    fileId: string;
    sizeBytes?: number;
    userId?: string;
  }): Promise<Deployment> {
    const sha256 = this.normaliseDigest(input.sha256);

    const frameworkFile = await this.frameworkFiles.findOne({
      where: { id: { eq: input.fileId } },
    });
    if (!frameworkFile) {
      throw new BadRequestError("Framework file row not found — upload first");
    }
    if (frameworkFile.bucket !== DeploymentService.BUCKET) {
      throw new BadRequestError(
        `Framework file is in bucket '${frameworkFile.bucket}', expected '${DeploymentService.BUCKET}'`,
      );
    }

    try {
      return await this.deployments.create({
        projectId: input.projectId,
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
          `Deployment '${input.version}' already exists for ${input.app}/${input.environment}. Build a new version rather than replacing this one.`,
        );
      }
      throw error;
    }
  }

  /**
   * Places an artifact already in the registry on an environment.
   *
   * This is what promote is: the same artifact, a second environment, a new
   * row. Nothing is rebuilt and — because sha256 is the identity and the
   * outpost already holds those bytes — nothing is even transferred.
   *
   * The identity columns are **copied, not joined**. `latest` is replaced in
   * place, so a row that only pointed at its artifact would start claiming it
   * deployed bytes it never saw the moment someone pushed again.
   */
  public async deployArtifact(input: {
    projectId: number;
    artifactId: string;
    environment: string;
    userId?: string;
  }): Promise<Deployment> {
    const artifact = await this.artifacts.findOne({
      where: {
        id: { eq: input.artifactId },
        projectId: { eq: input.projectId },
      },
    });
    if (!artifact) {
      throw new NotFoundError("No such artifact in this project");
    }

    return this.deployments.create({
      projectId: input.projectId,
      artifactId: artifact.id,
      app: artifact.app,
      tag: artifact.tag,
      environment: input.environment,
      version: this.deploymentId(),
      sha256: artifact.sha256,
      fileId: artifact.fileId,
      sizeBytes: artifact.sizeBytes,
      createdBy: input.userId,
    });
  }

  /**
   * Names one deployment, which is what the timestamp always was.
   *
   * UTC rather than local: two deploys from machines in different zones would
   * otherwise sort against each other wrongly. Shaped like Bay's on-disk
   * release directories so one string names the same thing on both sides.
   */
  protected deploymentId(): string {
    const at = new Date(this.dateTime.nowMillis());
    const pad = (n: number) => String(n).padStart(2, "0");
    return [
      at.getUTCFullYear(),
      pad(at.getUTCMonth() + 1),
      pad(at.getUTCDate()),
      `${pad(at.getUTCHours())}${pad(at.getUTCMinutes())}${pad(at.getUTCSeconds())}`,
    ].join("-");
  }

  public async get(id: string): Promise<Deployment | undefined> {
    return this.deployments.findOne({ where: { id: { eq: id } } });
  }

  /**
   * The project's recent deployments, newest first.
   *
   * Capped rather than paginated: this answers "what happened lately", and the
   * caller that needs more than twenty is asking a different question that
   * deserves its own query.
   */
  public async listByProject(projectId: number): Promise<Deployment[]> {
    return this.deployments.findMany({
      where: { projectId: { eq: projectId } },
      orderBy: [{ column: "createdAt", direction: "desc" }],
      limit: 20,
    });
  }

  /**
   * Hands the oldest waiting release to a machine, and marks it taken.
   *
   * Also picks up deployments whose claim has gone stale, which is the only way a
   * deploy survives the machine that took it dying mid-pull. The two cases are
   * one query on purpose: "nobody has it" and "whoever had it stopped talking"
   * want identical handling, and splitting them would mean a second sweep with
   * its own schedule to get wrong.
   */
  public async claim(outpost: Outpost): Promise<Deployment | undefined> {
    const now = this.dateTime.nowMillis();
    const staleBefore = new Date(
      now - DeploymentService.CLAIM_EXPIRY_MS,
    ).toISOString();

    // Filtered on status in the query, not after it. Ordering by age and
    // taking the first N of *every* release would, after fifty deploys, return
    // fifty finished ones and leave a fresh `pending` outside the window —
    // a machine that stops deploying and never says why.
    const waiting = await this.deployments.findMany({
      where: {
        projectId: { eq: outpost.projectId },
        status: { inArray: ["pending", "claimed"] },
      },
      orderBy: [{ column: "createdAt", direction: "asc" }],
      limit: 50,
    });

    const next = waiting.find(
      (release: Deployment) =>
        release.status === "pending" ||
        (release.status === "claimed" &&
          (release.claimedAt ?? "") < staleBefore),
    );
    if (!next) {
      return undefined;
    }

    return this.deployments.updateOne(
      { id: { eq: next.id } },
      {
        status: "claimed",
        outpostId: outpost.id,
        claimedAt: new Date(now).toISOString(),
      },
    );
  }

  /**
   * Records what a machine says became of a release it took.
   *
   * **Scoped to the reporting outpost**, and that is not a formality: without
   * it, any enrolled machine in the project could mark another machine's
   * deploy failed, and the deploying client would believe it. Omitting the
   * filter instead of matching on it would leave the query unscoped, which is
   * the same bug wearing a different shape.
   *
   * Terminal states are final. A late report from a machine that was killed
   * mid-deploy must not reopen a release the client has already concluded on.
   */
  public async transition(
    releaseId: string,
    outpostId: string,
    status: DeploymentStatus,
    failureReason?: string,
  ): Promise<Deployment> {
    const release = await this.deployments.findOne({
      where: { id: { eq: releaseId }, outpostId: { eq: outpostId } },
    });
    if (!release) {
      throw new NotFoundError("No such release claimed by this outpost");
    }
    if (release.status === "serving" || release.status === "failed") {
      throw new ConflictError(
        `Deployment '${release.version}' already finished as '${release.status}'`,
      );
    }

    return this.deployments.updateOne(
      { id: { eq: releaseId } },
      {
        status,
        failureReason: status === "failed" ? (failureReason ?? "") : undefined,
      },
    );
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
