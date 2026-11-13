import { $inject, z } from "alepha";
import {
  $job,
  type JobRescheduleOptions,
  jobExecutionEntity,
} from "alepha/api/jobs";
import { DateTimeProvider } from "alepha/datetime";
import { $logger } from "alepha/logger";
import { $repository, DbConnectionError, DbTimeoutError } from "alepha/orm";

import { type Deployment, deployments } from "../entities/deployments.ts";
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
 * `src/cli/infra-lib/__tests__/deployIdempotence.spec.ts` in alepha-dev/alepha
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
  protected readonly executions = $repository(jobExecutionEntity);

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
   * ⚠️ **Three, down from ten** (#Q3387). A fan-out of one artifact to many
   * tenants queues them all at once, and a busy slot used to cost each
   * waiting deploy up to ten seconds after the slot freed, a large share of
   * the 5 to 34 s measured between queueing and starting. With the byte work
   * native (#E137) a tenant deploy holds a slot for less time, so the look
   * comes round more often; a wait of the whole deploy timeout is still a
   * few hundred looks, each one row read, never thousands.
   */
  public static readonly SLOT_RETRY_SECONDS = 3;

  /**
   * The line a deploy waiting for a slot writes, once.
   */
  public static readonly WAITING_LINE = "Waiting for a free deploy slot";

  /**
   * How Lore runs the framework's job sweep (`jobConfig`), set by
   * `main.server.ts` before any module is registered.
   *
   * ⚠️ **Before any module, not in `LoreDeployApi.register`.** The job provider
   * creates its sweep cron when it is constructed, and whichever module
   * imports `alepha/api/jobs` first constructs it: set later, `sweepCron` is
   * silently ignored (`staleThreshold` is read live and would still apply).
   *
   * A queue delivery Cloudflare loses leaves its row `pending` until the
   * sweep re-dispatches it: on 2026-09-22 a deploy waited 827 s for it
   * (#Q2478). The sweep runs on the every-five-minutes expression
   * {@link sweepAbandoned} already uses, because cron triggers are counted
   * per account (see `EstateCommandJobs`), and a row counts as lost after
   * one minute instead of five: a lost delivery costs about 6 minutes, not
   * about 20. Re-dispatching a message that was only slow is safe, since
   * `claim()` is the guard.
   */
  public static readonly JOB_SWEEP = {
    sweepCron: "*/5 * * * *",
    staleThreshold: 60_000,
  } as const;

  /**
   * The execution's own timeout: one minute past the longest deploy timer
   * `DeployLimits` allows, and still under the queue consumer's 15 minutes.
   *
   * ⚠️ **Its job is the crash threshold, not the abort.** The run is bounded
   * by `DeployService`'s own timer, which writes a readable failure; this
   * value exists because the sweep calls a silent execution dead after twice
   * the job's timeout, and with none declared that fell back to twice the
   * default `runTimeout`, so a run the platform killed was noticed 30 to 45
   * minutes later (blight #616, #Q2344). It sits ABOVE the deploy timer so it
   * never fires first on a run that is still going to report.
   */
  public static readonly RUN_TIMEOUT_MS = DeployLimits.MAX_TIMEOUT_MS + 60_000;

  /**
   * How many times a run that hit a transient database error is tried again.
   *
   * ⚠️ **Only a database that did not answer** (#Q3551). On 2026-11-12 a
   * deploy's very first read, the row itself, timed out on D1; with no retry
   * the execution died there, the row stayed `queued`, and the operator
   * waited 15 minutes for the sweep. A transient D1 timeout is ordinary in
   * production, and the run is idempotent (see the class doc), so trying it
   * again is safe. Any other failure is a real answer and is not retried: a
   * refused gate or a missing artifact would only be refused again.
   *
   * Three retries on a 2 s doubling curve, capped at 15 s, so at most about
   * half a minute of waiting before the failure is written to the row.
   */
  public static readonly RUN_RETRIES = 3;

  public readonly runDeploy = $job({
    name: "deploys.run",
    description:
      "Runs one deployment, waiting for a free slot, and fails it once past its timeout.",
    timeout: [DeployJobs.RUN_TIMEOUT_MS, "milliseconds"],
    retry: {
      retries: DeployJobs.RUN_RETRIES,
      when: (error) => this.isTransient(error),
      backoff: { initial: [2, "seconds"], max: [15, "seconds"] },
    },
    // A few deploys a day, and an operator wants both outcomes: a queue job
    // keeps no successes by default, which made every deploy look failed.
    retention: { ok: { days: 30 }, error: { days: 30 } },
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
    handler: async ({ payload, reschedule, attempt }) => {
      try {
        await this.runOnce(payload.deploymentId, reschedule);
      } catch (error) {
        // ⚠️ The retry decision is the job's, made from the same predicate:
        // a transient error with attempts left goes back to the queue
        // untouched, anything else is the end of this deploy, said on its row
        // NOW rather than by the sweep 15 minutes later.
        if (!this.isTransient(error) || attempt > DeployJobs.RUN_RETRIES) {
          await this.failForGood(payload.deploymentId, error);
        }
        throw error;
      }
    },
  });

  /**
   * Whether a failure is the database not answering, the one kind
   * {@link runDeploy} retries.
   *
   * Found in the cause chain, since drizzle demotes the driver's error to
   * `cause` and throws its own on top.
   */
  public isTransient(error: unknown): boolean {
    return (
      DbTimeoutError.find(error) !== undefined ||
      DbConnectionError.find(error) !== undefined
    );
  }

  /**
   * Write a run's final failure to its deployment row, with the real reason.
   *
   * ⚠️ **Best-effort.** The database may still not be answering, and this
   * must not replace the error the execution records with its own: a write
   * that fails here leaves the row to the sweep, which then reads the
   * execution's error (see {@link sweepAbandoned}).
   */
  protected async failForGood(
    deploymentId: string,
    error: unknown,
  ): Promise<void> {
    try {
      const row = await this.rows.findById(deploymentId);
      if (!row || (row.status !== "queued" && row.status !== "running")) {
        // Gone, or already terminal: `DeployService.run` writes its own
        // failures, and the first terminal write is the one that stands.
        return;
      }
      await this.registry.failed(row.id, this.failureReason(row, error));
    } catch (writeError) {
      this.log.warn("Could not record a deploy's failure on its row", {
        deploymentId,
        error: writeError,
      });
    }
  }

  /**
   * What the operator reads on a row whose run failed for good.
   *
   * A row still `queued` never reached the runner, which records the start
   * before anything leaves for Cloudflare, so it can say nothing shipped.
   */
  protected failureReason(row: Deployment, error: unknown): string {
    const message = error instanceof Error ? error.message : String(error);
    const shipped =
      row.status === "queued"
        ? "Nothing reached Cloudflare, so it is safe to retry."
        : "It may have reached Cloudflare; check the Worker before retrying.";
    if (this.isTransient(error)) {
      return `The database did not answer (${message}), and still did not after ${DeployJobs.RUN_RETRIES} retries. ${shipped}`;
    }
    return `${message} ${shipped}`;
  }

  /**
   * One pass of {@link runDeploy}.
   */
  protected async runOnce(
    deploymentId: string,
    reschedule: (options: JobRescheduleOptions) => void,
  ): Promise<void> {
    const row = await this.load(deploymentId);
    if (!row) {
      // The row went with its instance or its project. Nothing to deploy and
      // nothing to report against, so this is a no-op rather than a failure:
      // a retry would find the same absence.
      this.log.warn("Deploy row is gone; nothing to run", {
        deploymentId,
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

    // Said once on the row, so its log tells waiting for a slot apart from
    // waiting for delivery; every later look would only fill the log's cap.
    if (
      !(row.log ?? []).some((line) => line.text === DeployJobs.WAITING_LINE)
    ) {
      await this.registry.line(row.id, DeployJobs.WAITING_LINE);
    }
    this.log.info("No free deploy slot; waiting for one", {
      deploymentId: row.id,
      retryInSeconds: DeployJobs.SLOT_RETRY_SECONDS,
    });
    reschedule({ delay: [DeployJobs.SLOT_RETRY_SECONDS, "seconds"] });
  }

  /**
   * The deployment row a run is for. Its own method so a spec can make the
   * first read fail the way D1 does in production.
   */
  protected async load(deploymentId: string): Promise<Deployment | undefined> {
    return await this.rows.findById(deploymentId);
  }

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
    name: "deploys.sweep-abandoned",
    description:
      "Marks deployments stuck in queued or running past their timeout plus five minutes as failed.",
    // ⚠️ Cron-only, so no `schema`: a job may declare one or the other and a
    // job carrying both is refused at boot. There is nothing to say anyway -
    // the sweep reads the rows and takes no payload.
    cron: "*/5 * * * *",
    // One minute. The sweep reads the stuck rows and writes a result each;
    // its trigger measures 1.1 s at p99 in production, so this is sixty
    // times the observed cost. The number matters for the LOCK, not the
    // handler: the TTL is twice the timeout, and the five-minute default
    // equals this job's own interval, so a crashed run would have held the
    // lock right up to the next tick.
    timeout: [60, "seconds"],
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
        if (row.commandId) {
          // Follows its estate command, whose own sweep fails it with the
          // machine's reason (a Bay deploy may run 15 minutes): the messages
          // below are about a Worker run it never had (#Q2706).
          continue;
        }
        const since = row.startedAt ?? row.createdAt;
        if (!since || new Date(since).getTime() > nowMs - budgetMs) {
          // Queued a long time and started recently: alive, and its own timer
          // owns it.
          continue;
        }
        const minutes = Math.round(budgetMs / 60_000);
        if (row.status === "queued") {
          // ⚠️ A run may have picked it up and failed before writing a thing
          // (#Q3551): its own failure write is best-effort, and lost when the
          // database is what failed. That is a failure with a reason, not a
          // delivery nobody made, and the operator is told which.
          const failed = await this.failedExecutionOf(row);
          if (failed) {
            this.log.warn("Deploy run failed before starting; marking it", {
              deploymentId: row.id,
              executionId: failed.id,
            });
            await this.registry.failed(
              row.id,
              `This deploy failed before it started: ${failed.error ?? "its run ended in an error"}. Nothing reached Cloudflare, so it is safe to retry.`,
            );
            continue;
          }
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

  /**
   * The errored execution of a deployment's run, if one exists.
   *
   * ⚠️ **By payload, never by key.** The framework clears an execution's key
   * the moment it is terminal (`ok`, `error`, `cancelled`), so the unique
   * `(jobName, key)` index frees it for a later push: `deploy:<id>` finds a
   * run only while it is `pending` or `scheduled`, which is all `cancelByKey`
   * needs. A finished run is found by its `deploymentId`, among the runs
   * created since the row was, a handful at most.
   */
  protected async failedExecutionOf(
    row: Deployment,
  ): Promise<{ id: string; error?: string } | undefined> {
    const executions = await this.executions.findMany({
      where: {
        jobName: { eq: this.runDeploy.name },
        status: { eq: "error" },
        createdAt: { gte: row.createdAt },
      },
      orderBy: [{ column: "createdAt", direction: "desc" }],
      limit: 50,
    });
    return executions.find(
      (execution) => execution.payload?.deploymentId === row.id,
    );
  }
}
