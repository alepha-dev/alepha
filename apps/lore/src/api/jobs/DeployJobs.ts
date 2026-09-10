import { $inject, z } from "alepha";
import { $job } from "alepha/api/jobs";
import { DateTimeProvider } from "alepha/datetime";
import { $logger } from "alepha/logger";
import { $repository } from "alepha/orm";

import { deployments } from "../entities/deployments.ts";
import { DeployLimits } from "../services/DeployLimits.ts";
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
 * be idempotent. It is, and
 * `packages/alepha/src/cli/platform-lib/__tests__/deployIdempotence.spec.ts`
 * says so rather than leaving it to be assumed, by running one deploy twice
 * against a fake account that refuses a duplicate the way Cloudflare does:
 * provisioning finds before it creates, asset upload dedups by content hash,
 * the script upload is a PUT, the queue consumer is found and rebound rather
 * than created again, and migrations are guarded by the `d1_migrations`
 * bookkeeping table. It lives beside the adapter rather than here because
 * every one of those steps is framework code.
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
  protected readonly limits = $inject(DeployLimits);
  protected readonly dateTime = $inject(DateTimeProvider);
  protected readonly rows = $repository(deployments);

  /**
   * The key one deployment's execution is pushed under.
   */
  public static key(deploymentId: string): string {
    return `deploy:${deploymentId}`;
  }

  /**
   * How long past its own budget a run may go before the sweep calls it dead.
   *
   * ⚠️ **The margin is the whole safety of {@link sweepAbandoned}.** A run
   * inside its budget is bounded by its own timer and will write its own
   * failure; a run past its budget by less than this is one whose timer is
   * about to fire. Sweeping either would mark a live deploy failed while the
   * upload it started carries on at Cloudflare, which is a worse lie than the
   * stuck row this exists to clear.
   *
   * Five minutes: long enough that only a run with nothing left alive to
   * report is caught, short enough that the operator is not left following a
   * dead row for an afternoon.
   */
  public static readonly SWEEP_GRACE_MS = 5 * 60 * 1000;

  /**
   * How long a deploy that found no free slot waits before it looks again.
   *
   * A redeploy takes 5 to 15 seconds, so ten is about one run's worth: short
   * enough that a burst drains at the pace the slots free up, long enough
   * that a wait of the whole deploy timeout is sixty looks, not thousands.
   */
  public static readonly SLOT_RETRY_SECONDS = 10;

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
    handler: async ({ payload, reschedule }) => {
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

      if ((await this.deploys.run(row)) === "done") {
        return;
      }

      // ⚠️ No slot in this isolate. Waiting is not a failure, so this is a
      // `reschedule`, never a `retry` policy: a reschedule resets `attempt`
      // and leaves the row `queued`, where a retry would spend a budget meant
      // for real failures and could run out halfway through a burst. And it
      // RETURNS after the call rather than throwing: `reschedule` only
      // records an intent, and a handler that throws takes the retry path on
      // the old payload and drops it.
      //
      // The next look may well land in another isolate with a slot free,
      // which is fine: the cap bounds one isolate's memory, not the account.
      const budgetMs = await this.limits.timeoutMs();
      const waitedMs =
        this.dateTime.nowMillis() - new Date(row.createdAt).getTime();
      if (waitedMs >= budgetMs) {
        // Bounded by the same timeout a run gets, so a wedged pair of deploys
        // cannot leave a third one looking for a slot forever.
        await this.registry.failed(
          row.id,
          `This deploy waited ${Math.round(waitedMs / 60_000)} minutes for a free slot and never got one: this Lore instance was already running as many deploys as it may. Nothing reached Cloudflare; retry it once the others have finished.`,
        );
        return;
      }

      this.log.info("No free deploy slot; waiting for one", {
        deploymentId: row.id,
        retryInSeconds: DeployJobs.SLOT_RETRY_SECONDS,
      });
      reschedule({ delay: [DeployJobs.SLOT_RETRY_SECONDS, "seconds"] });
    },
  });

  /**
   * Rows whose run stopped existing, closed.
   *
   * ## ⚠️ Why the in-isolate timer is not enough
   *
   * `DeployService` races every run against a timer, and that timer runs in
   * the same isolate as the run. It covers a deploy that HANGS. It cannot
   * cover a deploy whose isolate DIES - the timer dies with it, no status is
   * written, and the row reads `running` for ever while the UI follows it and
   * the operator cannot retry.
   *
   * That is not hypothetical: a `docs` deploy on 2026-09-08 exhausted the
   * Worker's 128 MB unpacking a 60 MB artifact, and its row was still reading
   * `["Fetching…", "Unpacking"]` an hour later.
   *
   * ## ⚠️ It says "stopped reporting", not "failed"
   *
   * The sweep knows one thing - that nothing has been heard - and must not
   * claim more. The Worker upload may well have reached Cloudflare before the
   * isolate went, so the message sends the operator to look rather than
   * asserting that nothing shipped.
   *
   * ## ⚠️ Except for a row that never started
   *
   * A row still `queued` never reached the runner, which records the start
   * before it contacts Cloudflare. Telling that operator to check a Worker
   * would send them looking for a deploy that never happened, so it gets its
   * own message: nothing was deployed, retry it.
   *
   * ## The age is `startedAt`, falling back to `createdAt`
   *
   * A row that never started has no `startedAt`, and that is exactly the row
   * stuck before any work happened - the one kind the sweep would otherwise
   * be blind to. The SQL filter is on `createdAt` because it is never later
   * than `startedAt`, so it can only over-select, and the check that decides
   * is done per row.
   */
  public readonly sweepAbandoned = $job({
    name: "lore.deploy.sweep",
    // ⚠️ Cron-only, so no `schema`: a job may declare one or the other and a
    // job carrying both is refused at boot. There is nothing to say anyway -
    // the sweep reads the rows and takes no payload.
    cron: "*/5 * * * *",
    handler: async () => {
      const nowMs = this.dateTime.nowMillis();
      const budgetMs =
        (await this.limits.timeoutMs()) + DeployJobs.SWEEP_GRACE_MS;
      const cutoff = new Date(nowMs - budgetMs).toISOString();

      const rows = await this.rows.findMany({
        where: {
          status: { inArray: ["queued", "running"] },
          createdAt: { lt: cutoff },
        },
      });

      for (const row of rows) {
        const since = row.startedAt ?? row.createdAt;
        if (!since || new Date(since).getTime() > nowMs - budgetMs) {
          // Queued a long time and started recently: alive, and its own timer
          // owns it.
          continue;
        }
        const minutes = Math.round(budgetMs / 60_000);
        if (row.status === "queued") {
          this.log.warn("Deploy never started; marking it failed", {
            deploymentId: row.id,
            since,
          });
          await this.registry.failed(
            row.id,
            `This deploy never started: no run picked it up in ${minutes} minutes. Nothing reached Cloudflare, so it is safe to retry.`,
          );
          continue;
        }
        this.log.warn("Deploy stopped reporting; marking it failed", {
          deploymentId: row.id,
          status: row.status,
          since,
        });
        await this.registry.failed(
          row.id,
          `This deploy stopped reporting after ${minutes} minutes and was abandoned. The run holding it is gone - a large artifact can exhaust the Worker's memory while unpacking - so it never got to write its own result. It may still have reached Cloudflare; check the Worker before retrying.`,
        );
      }
    },
  });
}
