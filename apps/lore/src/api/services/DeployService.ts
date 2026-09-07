import { $inject, AlephaError } from "alepha";
import { $logger } from "alepha/logger";
import { $repository } from "alepha/orm";
import { BadRequestError, NotFoundError } from "alepha/server";

import { appInstances } from "../entities/appInstances.ts";
import { artifacts } from "../entities/artifacts.ts";
import { type Deployment, deployments } from "../entities/deployments.ts";
import { estates } from "../entities/estates.ts";
import { ArtifactService } from "./ArtifactService.ts";
import { CredentialSealService } from "./CredentialSealService.ts";
import { DeployRegistry } from "./DeployRegistry.ts";
import { DeployRunner } from "./DeployRunner.ts";
import { EstateCloudflareService } from "./EstateCloudflareService.ts";

/**
 * Starting a deploy, and running one.
 *
 * The two are separate on purpose. {@link queue} is what an HTTP request does:
 * check, write a row, hand the id back. {@link run} is what the job does, and
 * it can take tens of seconds.
 */
export class DeployService {
  protected readonly log = $logger();
  protected readonly rows = $repository(deployments);
  protected readonly instances = $repository(appInstances);
  protected readonly artifacts = $repository(artifacts);
  protected readonly estates = $repository(estates);
  protected readonly seal = $inject(CredentialSealService);
  protected readonly cloudflare = $inject(EstateCloudflareService);
  protected readonly runner = $inject(DeployRunner);
  protected readonly registry = $inject(DeployRegistry);

  /**
   * Write the row a deploy will be followed through.
   *
   * ⚠️ **The snapshot is taken here**, at the moment of the request, and never
   * updated. Pushing `latest` replaces the artifact row, so a deployment
   * carrying only `artifactId` would start claiming it shipped bytes it never
   * saw.
   */
  public async queue(input: {
    projectId: number;
    instanceId: string;
    tag: string;
    createdBy?: string;
  }): Promise<Deployment> {
    const instance = await this.instances.findOne({
      where: {
        id: { eq: input.instanceId },
        projectId: { eq: input.projectId },
      },
    });
    if (!instance) {
      throw new NotFoundError("No such deployed copy in this project.");
    }
    if (!instance.estateId) {
      throw new BadRequestError(
        `${instance.app}/${instance.env} has no estate, so there is nowhere to deploy it. Choose one on its Settings tab.`,
      );
    }

    const artifact = await this.artifacts.findOne({
      where: {
        projectId: { eq: input.projectId },
        app: { eq: instance.app },
        tag: { eq: input.tag },
      },
    });
    if (!artifact) {
      // ⚠️ Refused rather than built. The tag is what decides whether a deploy
      // builds, and this entry point can only ever deploy stored bytes: CI
      // pushed `0.28.0` on Tuesday from a clean checkout, and promoting it on
      // Friday must not rebuild it from a different machine.
      throw new NotFoundError(
        `${instance.app} has no artifact tagged '${input.tag}'. Push one with \`lore artifacts push\`, or deploy a tag that exists.`,
      );
    }

    return await this.rows.create({
      projectId: input.projectId,
      instanceId: instance.id,
      artifactId: artifact.id,
      app: artifact.app,
      tag: artifact.tag,
      sha256: artifact.sha256,
      status: "queued",
      createdBy: input.createdBy,
    });
  }

  /**
   * Run one queued deployment to a terminal state.
   *
   * ⚠️ **Every exit is terminal.** A row left `running` is a deploy the UI
   * follows forever and the operator cannot retry, so the catch is not
   * optional: it is the only thing that guarantees the row moves.
   */
  public async run(row: Deployment): Promise<void> {
    try {
      const instance = await this.instances.findById(row.instanceId);
      if (!instance?.estateId) {
        throw new BadRequestError(
          "This deployed copy no longer names an estate, so there is nowhere to deploy it.",
        );
      }

      const estate = await this.estates.findById(instance.estateId);
      if (!estate) {
        throw new BadRequestError(
          "The estate this copy deploys to is gone. Lend one again on the project's Estates page.",
        );
      }

      // ⚠️ Before any side effect. `credentialStatus` is DERIVED rather than a
      // column - expiry is applied at read time - so this is local and cheap
      // but not a field read, and a daily job is what keeps the inputs fresh.
      if (this.cloudflare.credentialStatus(estate) !== "valid") {
        throw new BadRequestError(
          `The estate '${estate.slug}' does not have a usable Cloudflare credential. Check it on the account's Estates page before deploying.`,
        );
      }
      if (!estate.accountId) {
        throw new BadRequestError(
          `The estate '${estate.slug}' names no Cloudflare account.`,
        );
      }
      if (!estate.credential) {
        throw new BadRequestError(
          `The estate '${estate.slug}' holds no credential to deploy with.`,
        );
      }

      const artifact = await this.artifacts.findOne({
        where: { projectId: { eq: row.projectId }, sha256: { eq: row.sha256 } },
      });
      if (!artifact) {
        // The snapshot says what should ship and the bytes are gone - which is
        // what replacing `latest` does. Refusing names the fact rather than
        // deploying whatever now wears the tag.
        throw new NotFoundError(
          `The bytes this deployment names (${row.sha256.slice(0, 12)}) are no longer stored. Push ${row.app} ${row.tag} again.`,
        );
      }

      const result = await this.runner.run({
        artifact,
        env: instance.env,
        domain: instance.url ? new URL(instance.url).host : undefined,
        deploymentId: row.id,
        credential: {
          apiToken: this.seal.open(
            estate.credential,
            CredentialSealService.ESTATE_PURPOSE,
          ),
          accountId: estate.accountId,
        },
      });

      void result;
    } catch (error) {
      // `DeployRunner` already marks its own failures; this catches everything
      // that happens before it starts, and marking twice is harmless because
      // the second write lands on a row that is already terminal.
      const message = error instanceof Error ? error.message : String(error);
      await this.registry.failed(row.id, message);
      throw error instanceof AlephaError
        ? error
        : new AlephaError(`Deploy failed: ${message}`);
    }
  }

  /**
   * The runs of one deployed copy, newest first.
   */
  public async list(
    projectId: number,
    instanceId: string,
    limit = 20,
  ): Promise<Deployment[]> {
    return await this.rows.findMany({
      where: {
        projectId: { eq: projectId },
        instanceId: { eq: instanceId },
      },
      orderBy: [{ column: "createdAt", direction: "desc" }],
      limit,
    });
  }

  /**
   * One run, scoped to the project that may read it.
   *
   * ⚠️ The `projectId` filter is the cross-project guard, not decoration: a
   * deployment id is a uuid a caller supplies, and the gate on the path param
   * has already passed by the time this runs.
   */
  public async find(
    projectId: number,
    deploymentId: string,
  ): Promise<Deployment | undefined> {
    return await this.rows.findOne({
      where: { projectId: { eq: projectId }, id: { eq: deploymentId } },
    });
  }

  /**
   * Kept beside {@link list} so a reader of one finds the other: what the
   * artifact registry calls a build, this table calls a run of it.
   */
  public static readonly ARTIFACT_BUCKET = ArtifactService.BUCKET;
}
