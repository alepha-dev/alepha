import { $inject, Alepha, z } from "alepha";
import {
  $repository,
  DatabaseProvider,
  AlephaOrmTestPostgres,
} from "alepha/orm";
import { describe, it } from "vitest";

import {
  $job,
  AlephaApiJobs,
  AlephaApiJobsQueue,
  DirectJobDispatcher,
  jobExecutionEntity,
} from "../index.ts";

/**
 * A dispatcher that cannot dispatch, to prove the failure is contained.
 */
class FailingDispatcher extends DirectJobDispatcher {
  public override async dispatch(): Promise<void> {
    throw new Error("dispatcher down");
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Poll `fn` until `predicate` holds, or throw on timeout.
 */
async function waitFor<T>(
  fn: () => Promise<T> | T,
  predicate: (v: T) => boolean,
  { timeout = 3000, interval = 10, label = "condition" } = {},
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

type Mode = "direct" | "queue";

interface Run {
  /**
   * Whether the handler ran while it could still see the caller's transaction.
   */
  sawTransaction: boolean;
  /**
   * Whether the caller's transaction had committed when the handler ran.
   */
  afterCommit: boolean;
}

const boot = async (mode: Mode, name: string) => {
  let alepha = Alepha.create().with(AlephaOrmTestPostgres).with(AlephaApiJobs);
  if (mode === "queue") alepha = alepha.with(AlephaApiJobsQueue);
  const runs: Run[] = [];
  const state = { committed: false };
  class App {
    db = $inject(DatabaseProvider);
    executions = $repository(jobExecutionEntity);
    work = $job({
      name,
      description: "Records what it saw when it ran.",
      retention: { ok: { last: 100 } },
      schema: z.object({ v: z.integer() }),
      handler: async () => {
        runs.push({
          sawTransaction: alepha.get("alepha.orm.tx") !== undefined,
          afterCommit: state.committed,
        });
      },
    });
    batch = $job({
      name: `${name}-batch`,
      description: "Records what it saw when it ran, pushed many at once.",
      retention: { ok: { last: 100 } },
      schema: z.object({ v: z.integer() }),
      handler: async () => {
        runs.push({
          sawTransaction: alepha.get("alepha.orm.tx") !== undefined,
          afterCommit: state.committed,
        });
      },
    });
  }
  const app = alepha.inject(App);
  await alepha.start();
  const rows = (jobName: string) =>
    app.executions.findMany({ where: { jobName: { eq: jobName } } });
  return { alepha, app, runs, state, rows };
};

describe("$job pushed inside a transaction", () => {
  for (const mode of ["direct", "queue"] as const) {
    describe(`${mode} mode`, () => {
      it("a commit runs the handler after the commit, outside the transaction, without a sweep", async ({
        expect,
      }) => {
        const { app, runs, state, rows } = await boot(
          mode,
          `tx-${mode}.commit`,
        );
        await app.db.transactional(async () => {
          await app.work.push({ v: 1 });
          // Give a dispatch made inside the transaction every chance to run.
          await sleep(150);
          state.committed = true;
        });
        await waitFor(
          () => runs.length,
          (n) => n === 1,
          { label: "handler ran" },
        );
        expect(runs).toEqual([{ sawTransaction: false, afterCommit: true }]);
        const [row] = await waitFor(
          () => rows(`tx-${mode}.commit`),
          (r) => r[0]?.status === "ok",
          { label: "row succeeded" },
        );
        // Run by the dispatch made at the commit, not by a sweep.
        expect(row.redispatchCount ?? 0).toBe(0);
      });

      it("a rollback leaves no execution row and the handler never runs", async ({
        expect,
      }) => {
        const { app, runs, rows } = await boot(mode, `tx-${mode}.rollback`);
        await expect(
          app.db.transactional(async () => {
            await app.work.push({ v: 1 });
            await app.batch.pushMany([
              { payload: { v: 1 } },
              { payload: { v: 2 } },
            ]);
            await sleep(150);
            throw new Error("roll back");
          }),
        ).rejects.toThrow("roll back");
        await sleep(200);
        expect(runs).toEqual([]);
        expect(await rows(`tx-${mode}.rollback`)).toEqual([]);
        expect(await rows(`tx-${mode}.rollback-batch`)).toEqual([]);
      });

      it("pushMany, keyed and delayed pushes wait for the commit too", async ({
        expect,
      }) => {
        const { app, runs, state, rows } = await boot(mode, `tx-${mode}.many`);
        await app.db.transactional(async () => {
          await app.batch.pushMany([
            { payload: { v: 1 } },
            { payload: { v: 2 }, key: "k2" },
          ]);
          await app.work.push({ v: 3 }, { key: "k3" });
          await app.work.push({ v: 4 }, { delay: [10, "milliseconds"] });
          await sleep(150);
          state.committed = true;
        });
        await waitFor(
          () => runs.length,
          (n) => n === 4,
          { label: "four handlers ran" },
        );
        for (const run of runs) {
          expect(run).toEqual({ sawTransaction: false, afterCommit: true });
        }
        const all = [
          ...(await rows(`tx-${mode}.many`)),
          ...(await rows(`tx-${mode}.many-batch`)),
        ];
        expect(all).toHaveLength(4);
      });

      it("a push outside any transaction runs as before", async ({
        expect,
      }) => {
        const { app, runs } = await boot(mode, `tx-${mode}.outside`);
        await app.work.push({ v: 1 });
        await waitFor(
          () => runs.length,
          (n) => n === 1,
          { label: "handler ran" },
        );
        expect(runs[0].sawTransaction).toBe(false);
      });
    });
  }

  it("a dispatch that fails after the commit is logged and left to the sweep, never thrown at the caller", async ({
    expect,
  }) => {
    const alepha = Alepha.create()
      .with(AlephaOrmTestPostgres)
      .with({ provide: DirectJobDispatcher, use: FailingDispatcher })
      .with(AlephaApiJobs);
    class App {
      db = $inject(DatabaseProvider);
      executions = $repository(jobExecutionEntity);
      work = $job({
        name: "tx-failing.work",
        description: "Never dispatched.",
        schema: z.object({ v: z.integer() }),
        handler: async () => {},
      });
    }
    const app = alepha.inject(App);
    await alepha.start();
    const id = await app.db.transactional(() => app.work.push({ v: 1 }));
    const [row] = await app.executions.findMany({ where: { id: { eq: id } } });
    expect(row.status).toBe("pending");
    // Outside a transaction the failure still reaches the caller, as before.
    await expect(app.work.push({ v: 2 })).rejects.toThrow("dispatcher down");
  });

  it("a driver without transactions dispatches in place", async ({
    expect,
  }) => {
    const alepha = Alepha.create({
      env: { DATABASE_URL: "sqlite://:memory:", DATABASE_TRANSACTIONS: false },
    }).with(AlephaApiJobs);
    let calls = 0;
    class App {
      db = $inject(DatabaseProvider);
      work = $job({
        name: "tx-none.work",
        description: "Counts its runs.",
        schema: z.object({ v: z.integer() }),
        handler: async () => {
          calls++;
        },
      });
    }
    const app = alepha.inject(App);
    await alepha.start();
    await app.db.transactional(async () => {
      await app.work.push({ v: 1 });
      await waitFor(
        () => calls,
        (n) => n === 1,
        { label: "ran inside the block" },
      );
    });
    expect(calls).toBe(1);
  });
});
