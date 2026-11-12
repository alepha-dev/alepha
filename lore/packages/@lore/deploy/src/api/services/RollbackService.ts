import { $inject, AlephaError } from "alepha";
import { CloudflareDeployClient } from "alepha/cli/infra-lib";
import { $logger } from "alepha/logger";
import { $repository } from "alepha/orm";
import { BadRequestError, NotFoundError } from "alepha/server";

import { appInstances } from "../entities/appInstances.ts";
import { artifacts } from "../entities/artifacts.ts";
import { type Deployment, deployments } from "../entities/deployments.ts";
import { ArtifactSchemaStore } from "./ArtifactSchemaStore.ts";
import { ArtifactService } from "./ArtifactService.ts";
import { CredentialSealService } from "./CredentialSealService.ts";
import { DeployGate } from "./DeployGate.ts";
import { DeployRegistry } from "./DeployRegistry.ts";
import {
  type SchemaChange,
  SchemaCompatibility,
} from "./SchemaCompatibility.ts";

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
   * Whether the chosen build fits the schema every later run left behind,
   * read from the Drizzle snapshots their pushes carried (#Q3542).
   *
   * Absent when that cannot be answered: the chosen build or a later run that
   * may have migrated was pushed without one (an older CLI, an artifact from
   * before #Q3542), or they share no dialect. {@link migrationsSince} is
   * then all there is to go on.
   */
  schema?: RollbackSchemaCheck;
  /**
   * What the operator must acknowledge before rolling back, or absent when
   * nothing needs it. One sentence with no instruction in it: each surface
   * adds its own (a button, a flag, a tool argument).
   *
   * From {@link schema} when it is known, so a rollback past migrations that
   * only ADDED to the schema needs no confirmation; from
   * {@link migrationsSince} otherwise.
   */
  warning?: string;
  /**
   * Why the fast path is unavailable, when it is.
   */
  reason?: string;
}

export interface RollbackSchemaCheck {
  /**
   * `safe` when the live schema only adds to what the build expects,
   * `breaks` when one of its own queries will fail, `risky` when some of its
   * writes may be refused.
   */
  verdict: "safe" | "risky" | "breaks";
  changes: SchemaChange[];
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
  protected readonly artifacts = $repository(artifacts);
  protected readonly gate = $inject(DeployGate);
  protected readonly seal = $inject(CredentialSealService);
  protected readonly registry = $inject(DeployRegistry);
  protected readonly schemas = $inject(ArtifactSchemaStore);
  protected readonly compatibility = $inject(SchemaCompatibility);

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
    const risk = await this.risk(target);

    if (estate.type !== "cloudflare") {
      return {
        path: "artifact",
        deployment: target,
        ...risk,
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
        ...risk,
        reason:
          "That run recorded no Cloudflare version, so a rollback redeploys the stored artifact.",
      };
    }

    // ⚠️ The stored name, never one rebuilt from the app and env: the Worker is
    // `<project>-<app>-<env>` as it was when the copy first deployed, and a
    // rebuilt name misses it (it read `<app>-<env>` until #Q2473, so the fast
    // path was never offered). A copy with no stored name has no Worker Lore
    // can point at.
    if (!instance.resourceName) {
      return {
        path: "artifact",
        deployment: target,
        ...risk,
        reason:
          "Lore has no record of this copy's Worker name, so a rollback redeploys the stored artifact.",
      };
    }

    // ⚠️ Asked of Cloudflare rather than assumed from the row. A version can be
    // gone - the Worker was deleted and recreated, or the account pruned it -
    // and offering a fast rollback onto a version that is not there fails after
    // the operator has already confirmed.
    const client = new CloudflareDeployClient({
      apiToken: await this.seal.open(
        estate.credential as string,
        CredentialSealService.ESTATE_PURPOSE,
      ),
      accountId: estate.accountId as string,
    });
    const versions = await client
      .listVersions(instance.resourceName)
      .catch(() => [] as Array<{ id: string }>);

    if (!versions.some((it) => it.id === target.versionId)) {
      return {
        path: "artifact",
        deployment: target,
        ...risk,
        reason:
          "Cloudflare no longer holds that version, so a rollback redeploys the stored artifact.",
      };
    }

    return { path: "version", deployment: target, ...risk };
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
    if (plan.warning && !options.acknowledgeMigrations) {
      throw new BadRequestError(`${plan.warning} Confirm to proceed anyway.`);
    }

    const instance = await this.instances.findById(plan.deployment.instanceId);
    const estate = await this.gate.assert(instance as never);
    const client = new CloudflareDeployClient({
      apiToken: await this.seal.open(
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
        instance?.resourceName as string,
        plan.deployment.versionId as string,
        `Rolled back by Lore to ${plan.deployment.tag}`,
      );
      await this.registry.succeeded(row.id, {
        versionId: plan.deployment.versionId,
        // A version rollback touches no database (#Q3479).
        migrationsApplied: 0,
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
   * What rolling back to `target` risks: the migration count, the schema
   * check when it can be made, and the warning they amount to.
   */
  protected async risk(
    target: Deployment,
  ): Promise<Pick<RollbackPlan, "migrationsSince" | "schema" | "warning">> {
    const later = await this.laterRuns(target);
    const noDatabase = await this.withoutDatabase(
      later.filter((it) => it.migrationsApplied == null),
    );
    const migrationsSince = this.migrationsSince(later, noDatabase);
    const schema = await this.schemaSince(target, later, noDatabase);
    return {
      migrationsSince,
      schema,
      warning: this.warningOf(migrationsSince, schema),
    };
  }

  protected warningOf(
    migrationsSince: number,
    schema?: RollbackSchemaCheck,
  ): string | undefined {
    if (schema) {
      if (schema.verdict === "safe") {
        return undefined;
      }
      const listed = schema.changes.map((it) => it.change).join(", ");
      return schema.verdict === "breaks"
        ? `That build will break on the current schema: ${listed}. A rollback changes the code and not the database.`
        : `Some of that build's writes may be refused by the current schema: ${listed}. A rollback changes the code and not the database.`;
    }
    if (migrationsSince > 0) {
      return `${migrationsSince} migration(s) have been applied since that version shipped. A rollback changes the code and not the database, so that version would run against the current schema.`;
    }
    return undefined;
  }

  /**
   * The schema the chosen build expects, compared with what every later run
   * expected (#Q3542).
   *
   * ⚠️ **Every later run, not only the newest.** A rollback is itself a run,
   * carrying OLDER bytes, so after "deploy A2, roll back to A1" the newest
   * run's snapshot is A1's while the database still has A2's schema. Each
   * later snapshot is a schema the database reached, and migrations only go
   * forward, so every one of them is compared.
   *
   * `undefined`, so the caller falls back to counting, when a later run that
   * may have migrated has no stored schema: what it did cannot be known, and
   * unknown never reads as safe. A run that applied none, or whose build has
   * no database, changed nothing and is passed over.
   */
  protected async schemaSince(
    target: Deployment,
    later: Deployment[],
    noDatabase: Set<string>,
  ): Promise<RollbackSchemaCheck | undefined> {
    const read = new Map<
      string,
      Promise<Awaited<ReturnType<ArtifactSchemaStore["read"]>>>
    >();
    const schemaOf = (sha256: string) => {
      if (!read.has(sha256)) {
        read.set(
          sha256,
          this.schemas.read(ArtifactService.BUCKET, target.projectId, sha256),
        );
      }
      return read.get(sha256) as ReturnType<ArtifactSchemaStore["read"]>;
    };

    const expected = await schemaOf(target.sha256);
    if (!expected) {
      return undefined;
    }
    const changes = new Map<string, SchemaChange>();
    for (const run of later) {
      const reached = await schemaOf(run.sha256);
      if (!reached) {
        if (run.migrationsApplied === 0 || noDatabase.has(run.id)) {
          continue;
        }
        return undefined;
      }
      const dialects = Object.keys(expected.dialects).filter(
        (it) => reached.dialects[it],
      );
      if (dialects.length === 0) {
        return undefined;
      }
      for (const dialect of dialects) {
        for (const change of this.compatibility.compare(
          expected.dialects[dialect],
          reached.dialects[dialect],
        )) {
          changes.set(change.change, change);
        }
      }
    }
    const all = [...changes.values()];
    return {
      verdict: all.some((it) => it.severity === "breaks")
        ? "breaks"
        : all.length > 0
          ? "risky"
          : "safe",
      changes: all,
    };
  }

  /**
   * The successful runs of the same copy after `target`, with other bytes.
   */
  protected async laterRuns(target: Deployment): Promise<Deployment[]> {
    const rows = await this.rows.findMany({
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
    return rows.filter(
      (it) =>
        it.id !== target.id &&
        Date.parse(it.createdAt) >= Date.parse(target.createdAt) &&
        it.sha256 !== target.sha256,
    );
  }

  /**
   * How many migrations landed after the chosen version shipped.
   *
   * Summed from what each later run recorded applying (#Q3479). It used to
   * count every later run with different bytes as one migration, so the
   * warning fired on nearly every rollback of every app, a database or not,
   * and a warning that always fires trains people to acknowledge it.
   *
   * A later run that recorded nothing is UNKNOWN: it counts one, as before,
   * unless its artifact's manifest says the build has no database. Unknown
   * never reads as none, because under-counting costs old code against a
   * new schema while over-counting costs one confirmation.
   */
  protected migrationsSince(
    later: Deployment[],
    noDatabase: Set<string>,
  ): number {
    let count = 0;
    for (const it of later) {
      if (it.migrationsApplied != null) {
        count += it.migrationsApplied;
      } else if (!noDatabase.has(it.id)) {
        count += 1;
      }
    }
    return count;
  }

  /**
   * The runs, among these, whose artifact's manifest says the build has no
   * database (`resources.hasDatabase: false`). A run whose artifact is gone,
   * or whose manifest is absent or says nothing, is not among them.
   */
  protected async withoutDatabase(runs: Deployment[]): Promise<Set<string>> {
    const ids = [
      ...new Set(runs.map((it) => it.artifactId).filter((it) => !!it)),
    ] as string[];
    if (ids.length === 0) {
      return new Set();
    }
    const found = await this.artifacts.findMany({
      where: { id: { inArray: ids } },
      columns: ["id", "manifest"],
    });
    const plain = new Set<string>();
    for (const artifact of found) {
      if (this.declaresNoDatabase(artifact.manifest)) {
        plain.add(artifact.id);
      }
    }
    return new Set(
      runs
        .filter((it) => it.artifactId && plain.has(it.artifactId))
        .map((it) => it.id),
    );
  }

  protected declaresNoDatabase(manifest?: string | null): boolean {
    if (!manifest) {
      return false;
    }
    try {
      const parsed = JSON.parse(manifest) as {
        resources?: { hasDatabase?: unknown };
      };
      return parsed.resources?.hasDatabase === false;
    } catch {
      return false;
    }
  }
}
