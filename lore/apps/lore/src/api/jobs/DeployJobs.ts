import { $inject, z } from "alepha";
import { $job } from "alepha/api/jobs";
import { $logger } from "alepha/logger";
import { $repository } from "alepha/orm";

import { deployments } from "../entities/deployments.ts";
import { DeployRegistry } from "../services/DeployRegistry.ts";
import { DeployService } from "../services/DeployService.ts";

/**
 * The run a deploy actually is.
 *
 * ## ⚠️ A job, not an HTTP request, and both reasons still hold
 *
 * A deploy takes tens of seconds. Inside one request it is **cancelled when the
 * client goes away** - `waitUntil` extends only 30 s past the response - so the
 * operator closing a tab would abandon a half-uploaded Worker. A queued job is
 * dispatched and survives the response.
 *
 * And a retried or rescheduled execution **replays work**, so every step has to
 * be idempotent. It already is, and `deploy-idempotence.spec.ts` says so rather
 * than leaving it to be assumed: provisioning checks before it creates, asset
 * upload dedups by content hash, the script upload is a PUT, and migrations are
 * guarded by the `d1_migrations` bookkeeping table.
 *
 * ## ⚠️ `$workflow` is gone (epic #33, 2026-09-05)
 *
 * A multi-stage run is one `$job` switching on `payload.stage`, with
 * `reschedule()` parking the execution and re-dispatching it. This deploy has
 * one stage today - the orchestrator owns the six steps inside it - and the
 * shape is here because `cancelByKey` is what a "stop this deploy" button
 * needs, and because a stage boundary is where a long deploy will have to break
 * if it ever outgrows a single execution.
 *
 * ⚠️ Two traps that shape brings, both worth knowing before adding a stage:
 * `reschedule()` records an INTENT, so nothing is written until the handler
 * resolves and a handler that throws afterwards retries the OLD payload; and
 * `dateTime.travel()` releases every cron in the container, so a spec must park
 * the row to `scheduled` with the expected `payload.stage` BEFORE travelling,
 * then assert end state rather than call counts.
 *
 * ## The key is the deployment
 *
 * One execution per deployment row, which is what makes a second push for the
 * same run land on the same execution instead of starting a second deploy, and
 * what lets `cancelByKey` reach it.
 */
export class DeployJobs {
  protected readonly log = $logger();
  protected readonly deploys = $inject(DeployService);
  protected readonly registry = $inject(DeployRegistry);
  protected readonly rows = $repository(deployments);

  /**
   * The key one deployment's execution is pushed under.
   */
  public static key(deploymentId: string): string {
    return `deploy:${deploymentId}`;
  }

  public readonly runDeploy = $job({
    name: "lore.deploy.run",
    schema: z.object({
      deploymentId: z.uuid(),
      /**
       * Which part of the run this execution is. One value today; the field
       * exists because `reschedule()` is how a second one would arrive, and a
       * payload that gains a discriminator later is a migration of every parked
       * execution.
       */
      stage: z.enum(["deploy"]).default("deploy"),
    }),
    handler: async ({ payload }) => {
      const row = await this.rows.findById(payload.deploymentId);
      if (!row) {
        // The row went with its instance or its project. Nothing to deploy and
        // nothing to report against, so this is a no-op rather than a failure:
        // a retry would find the same absence.
        this.log.warn("Deploy row is gone; nothing to run", {
          deploymentId: payload.deploymentId,
        });
        return;
      }

      if (row.status !== "queued" && row.status !== "running") {
        // Already terminal. A replayed execution must not restart a deploy the
        // operator has seen finish.
        this.log.info("Deploy already finished; not re-running", {
          deploymentId: row.id,
          status: row.status,
        });
        return;
      }

      await this.deploys.run(row);
    },
  });
}
