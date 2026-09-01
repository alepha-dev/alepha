import { Alepha, z } from "alepha";
import { LockProvider, MemoryLockProvider } from "alepha/lock";
import { $repository } from "alepha/orm";
import { AlephaOrmPostgres } from "alepha/orm/postgres";
import { describe, it } from "vitest";

import {
  $workflow,
  AlephaApiWorkflows,
  WorkflowProvider,
  workflowExecutions,
  workflowStepExecutions,
} from "../index.ts";

// -----------------------------------------------------------------------------------------------------------------

async function waitFor<T>(
  fn: () => Promise<T> | T,
  predicate: (v: T) => boolean,
  { timeout = 5_000, interval = 10, label = "condition" } = {},
): Promise<T> {
  const deadline = Date.now() + timeout;
  let last: T = await fn();
  while (Date.now() < deadline) {
    if (predicate(last)) return last;
    await new Promise((r) => setTimeout(r, interval));
    last = await fn();
  }
  if (predicate(last)) return last;
  throw new Error(
    `waitFor: ${label} not met within ${timeout}ms; last value: ${JSON.stringify(last)}`,
  );
}

/**
 * A lock provider on which one key can be made to look held by another
 * worker: every NX `set` on `contended` answers with a foreign value, the
 * way it does when a concurrent dispatch for the same execution is between
 * its `set` and its `del`.
 */
class ContendedLockProvider extends MemoryLockProvider {
  public contended?: string;

  public override async set(
    key: string,
    value: string,
    nx?: boolean,
    px?: number,
  ): Promise<string> {
    if (nx && key === this.contended) {
      return "another-worker,2026-01-01T00:00:00.000Z";
    }
    return super.set(key, value, nx, px);
  }
}

/**
 * Parks the dispatch of one named step so the test can arrange the
 * contention before the dispatch is allowed to arrive.
 */
class GatedDispatchProvider extends WorkflowProvider {
  public gateStep?: string;
  public gate?: Promise<void>;
  public arrived?: () => void;
  public release: () => void = () => {};

  protected override async dispatchStep(
    workflowId: string,
    stepName: string,
    priority: number,
    scheduledAt?: string,
  ): Promise<void> {
    if (stepName === this.gateStep && this.gate) {
      const gate = this.gate;
      this.gate = undefined;
      this.arrived?.();
      await gate;
    }
    return super.dispatchStep(workflowId, stepName, priority, scheduledAt);
  }

  public arm(stepName: string): Promise<void> {
    this.gateStep = stepName;
    this.gate = new Promise<void>((resolve) => {
      this.release = resolve;
    });
    return new Promise<void>((resolve) => {
      this.arrived = resolve;
    });
  }
}

// -----------------------------------------------------------------------------------------------------------------

/**
 * The per-workflow lock in `processStep` is an optimisation over the
 * compare-and-set step claim, not the guarantee. A dispatch that found it
 * held used to return silently, which consumed the outbox row and left the
 * step `pending` with no stamp: nothing short of the next recovery sweep
 * would ever deliver it. The holder is routinely a late duplicate dispatch
 * for the PREVIOUS step that only reads and returns, so a real dispatch was
 * being dropped for a no-op that would have released the lock a few
 * milliseconds later. The repeat-steps test parked on its last step this
 * way whenever a sweep nudge and the completion chain crossed.
 */
describe("$workflow: a dispatch that meets a held workflow lock", () => {
  it("is not dropped, and the step still runs", async ({ expect }) => {
    const order: string[] = [];

    class App {
      repo = $repository(workflowExecutions);
      stepRepo = $repository(workflowStepExecutions);
      pair = $workflow({
        schema: z.object({ id: z.text() }),
        steps: [
          {
            name: "first",
            handler: async () => {
              order.push("first");
              return { ok: true };
            },
          },
          {
            name: "second",
            handler: async () => {
              order.push("second");
              return { ok: true };
            },
          },
        ],
      });
    }

    const alepha = Alepha.create()
      .with({ provide: LockProvider, use: ContendedLockProvider })
      .with({ provide: WorkflowProvider, use: GatedDispatchProvider })
      .with(AlephaOrmPostgres)
      .with(AlephaApiWorkflows)
      .with(App);
    await alepha.start();

    const app = alepha.inject(App);
    const provider = alepha.inject(GatedDispatchProvider);
    const lock = alepha.inject(ContendedLockProvider);

    const arrived = provider.arm("second");
    const executionId = await app.pair.start({ id: "x" });

    // `first` has completed and `advance()` is about to dispatch `second`.
    await arrived;
    expect(order).toEqual(["first"]);

    // Another dispatch for this execution holds the lock while `second`
    // arrives, and keeps holding it for longer than the arrival takes.
    lock.contended = `workflow:${executionId}`;
    provider.release();
    await new Promise((r) => setTimeout(r, 1_000));
    lock.contended = undefined;

    await waitFor(
      () => app.repo.findById(executionId),
      (e) => e?.status === "completed",
      { label: "workflow completed past the contended lock" },
    );
    expect(order).toEqual(["first", "second"]);

    const steps = await app.stepRepo.findMany({
      where: { workflowExecutionId: { eq: executionId } },
      orderBy: { column: "stepIndex", direction: "asc" },
    });
    expect(steps.map((s) => s.status)).toEqual(["completed", "completed"]);
    expect(steps[1].attempt).toBe(1);
  });
});
