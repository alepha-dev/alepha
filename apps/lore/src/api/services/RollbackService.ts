import { $inject, AlephaError } from "alepha";
import { CloudflareDeployClient } from "alepha/cli/platform-lib";
import { $logger } from "alepha/logger";
import { $repository } from "alepha/orm";
import { BadRequestError, NotFoundError } from "alepha/server";

import { appInstances } from "../entities/appInstances.ts";
import { type Deployment, deployments } from "../entities/deployments.ts";
import { CredentialSealService } from "./CredentialSealService.ts";
import { DeployGate } from "./DeployGate.ts";
import { DeployRegistry } from "./DeployRegistry.ts";

/**
 * What a rollback would do, before anybody asks for one.
 */
export interface RollbackPlan {
  /**
   * `version` when Cloudflare still holds the bytes and this is seconds;
   * `artifact` when it does not, or the estate cannot do versions at all.
   */
  path: "version" | "artifact";
  deployment: Deployment;
  /**
   * How many migrations have been applied since the chosen version shipped.
   *
   * ⚠️ **Rollback is code-only.** The database is not rolled back with it, so a
   * version that predates a migration runs old code against a new schema. The
   * version path makes this EASIER to get wrong, precisely because it is so
   * fast and cheap that it invites clicking.
   */
  migrationsSince: number;
  /**
   * Why the fast path is unavailable, when it is.
   */
  reason?: string;
}

/**
 * Rolling a deployed copy back to something it ran before.
 *
 * ## Two mechanisms, and the cheap one does not touch the registry
 *
 * Cloudflare keeps **every uploaded Worker version** server-side, so the
 * cheapest rollback creates a new deployment pointing 100% at an older
 * `version_id`: seconds, no artifact fetch, no upload. `deployments.versionId`
 * is what makes that a lookup rather than a search.
 *
 * ⚠️ **That is what decouples rollback from retention.** Without it,
 * `latest`-only retention would mean there is nothing to roll back to, and the
 * epic's headline promise would force a keep-N policy, a GC job and a pin on
 * whatever is live. With it, retention stays "one row, one object".
 *
 * The artifact path is the fallback: the version is gone, or the instance's
 * estate changed since. It is an ordinary deploy of an older artifact.
 *
 * ⚠️ **Cloudflare only.** A `bay` estate has no version history at all, so a
 * rollback there is an artifact deploy through the command queue and the fast
 * path must never be offered for one - not disabled in the UI, unavailable in
 * the plan, so no caller can reach it by asking directly.
 */
export class RollbackService {
  protected readonly log = $logger();
  protected readonly rows = $repository(deployments);
  protected readonly instances = $repository(appInstances);
  protected readonly gate = $inject(DeployGate);
  protected readonly seal = $inject(CredentialSealService);
  protected readonly registry = $inject(DeployRegistry);

  /**
   * What rolling back to this deployment would take, and what it would risk.
   *
   * Answered before anything is done, so the confirm dialog has something true
   * to say rather than a generic warning.
   */
  public async plan(
    projectId: number,
    deploymentId: string,
  ): Promise<RollbackPlan> {
    const target = await this.rows.findOne({
      where: { projectId: { eq: projectId }, id: { eq: deploymentId } },
    });
    if (!target) {
      throw new NotFoundError("No such deploy in this project.");
    }
    if (target.status !== "succeeded") {
      throw new BadRequestError(
        "That run did not succeed, so there is nothing to roll back to.",
      );
    }

    const instance = await this.instances.findById(target.instanceId);
    if (!instance) {
      throw new NotFoundError("That deployed copy is gone.");
    }
    const estate = await this.gate.assert(instance);
    const migrationsSince = await this.migrationsSince(target);

    if (estate.type !== "cloudflare") {
      return {
        path: "artifact",
        deployment: target,
        migrationsSince,
        // Named rather than left blank: an operator wondering why the fast
        // button is missing should not have to guess.
        reason:
          "This estate keeps no version history, so a rollback redeploys the stored artifact.",
      };
    }

    if (!target.versionId) {
      return {
        path: "artifact",
        deployment: target,
        migrationsSince,
        reason:
          "That run recorded no Cloudflare version, so a rollback redeploys the stored artifact.",
      };
    }

    // ⚠️ Asked of Cloudflare rather than assumed from the row. A version can be
    // gone - the Worker was deleted and recreated, or the account pruned it -
    // and offering a fast rollback onto a version that is not there fails after
    // the operator has already confirmed.
    const client = new CloudflareDeployClient({
      apiToken: this.seal.open(
        estate.credential as string,
        CredentialSealService.ESTATE_PURPOSE,
      ),
      accountId: estate.accountId as string,
    });
    const worker = `${target.app}-${instance.env}`;
    const versions = await client
      .listVersions(worker)
      .catch(() => [] as Array<{ id: string }>);

    if (!versions.some((it) => it.id === target.versionId)) {
      return {
        path: "artifact",
        deployment: target,
        migrationsSince,
        reason:
          "Cloudflare no longer holds that version, so a rollback redeploys the stored artifact.",
      };
    }

    return { path: "version", deployment: target, migrationsSince };
  }

  /**
   * Do it, the fast way.
   *
   * ⚠️ Refuses when the plan says the fast path is unavailable, rather than
   * quietly doing the slow one: the two have different blast radii - one
   * uploads nothing, the other re-runs migrations - and a caller that asked for
   * a version rollback must not get an artifact deploy it did not ask for.
   */
  public async rollback(
    projectId: number,
    deploymentId: string,
    options: { acknowledgeMigrations?: boolean } = {},
  ): Promise<void> {
    const plan = await this.plan(projectId, deploymentId);
    if (plan.path !== "version") {
      throw new BadRequestError(
        plan.reason ?? "A fast rollback is not available for this run.",
      );
    }

    // ⚠️ The database is NOT rolled back. Old code against a new schema is the
    // failure this warning exists for, and the version path invites clicking
    // precisely because it is fast - so the acknowledgement is required rather
    // than displayed.
    if (plan.migrationsSince > 0 && !options.acknowledgeMigrations) {
      throw new BadRequestError(
        `${plan.migrationsSince} migration(s) have been applied since that version shipped. A rollback changes the code and not the database, so that version would run against the current schema. Confirm to proceed anyway.`,
      );
    }

    const instance = await this.instances.findById(plan.deployment.instanceId);
    const estate = await this.gate.assert(instance as never);
    const client = new CloudflareDeployClient({
      apiToken: this.seal.open(
        estate.credential as string,
        CredentialSealService.ESTATE_PURPOSE,
      ),
      accountId: estate.accountId as string,
    });

    const row = await this.rows.create({
      projectId,
      instanceId: plan.deployment.instanceId,
      artifactId: plan.deployment.artifactId,
      app: plan.deployment.app,
      tag: plan.deployment.tag,
      sha256: plan.deployment.sha256,
      versionId: plan.deployment.versionId,
      status: "running",
    });

    try {
      await this.registry.line(
        row.id,
        `Rolling back to version ${plan.deployment.versionId}`,
      );
      await client.rollbackTo(
        `${plan.deployment.app}-${(instance as { env: string }).env}`,
        plan.deployment.versionId as string,
        `Rolled back by Lore to ${plan.deployment.tag}`,
      );
      await this.registry.succeeded(row.id, {
        versionId: plan.deployment.versionId,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      // ⚠️ Cloudflare refuses a rollback across a boundary it considers unsafe
      // - a changed secret, a Durable Object migration a version cannot be
      // rolled past. That refusal is passed through rather than forced past:
      // `force` would deploy a Worker whose bindings no longer match.
      await this.registry.failed(row.id, message);
      throw new AlephaError(`Rollback failed: ${message}`);
    }
  }

  /**
   * How many migrations landed after the chosen version shipped.
   *
   * Counted from the deployments in between rather than from the migration
   * files, because Lore knows when each run happened and not when each
   * migration did - and a run that applied migrations is the only evidence
   * there is.
   */
  protected async migrationsSince(target: Deployment): Promise<number> {
    const later = await this.rows.findMany({
      where: {
        instanceId: { eq: target.instanceId },
        status: { eq: "succeeded" },
      },
      orderBy: [{ column: "createdAt", direction: "desc" }],
      limit: 100,
    });
    // ⚠️ `>=` with the target excluded by id, not `>`. Two runs can land in the
    // same millisecond - a redeploy is 5 to 15 seconds but the ROWS are written
    // together - and a strict comparison then counts zero migrations for a
    // rollback that really is going backwards. Over-counting by a tie costs an
    // extra confirmation; under-counting costs old code against a new schema.
    return later.filter(
      (it) =>
        it.id !== target.id &&
        Date.parse(it.createdAt) >= Date.parse(target.createdAt) &&
        it.sha256 !== target.sha256,
    ).length;
  }
}
