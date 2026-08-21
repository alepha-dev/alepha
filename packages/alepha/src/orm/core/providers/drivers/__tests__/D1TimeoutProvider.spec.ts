import { Alepha } from "alepha";
import { DateTimeProvider } from "alepha/datetime";
import { describe, expect, it } from "vitest";

import { D1TimeoutProvider } from "../D1TimeoutProvider.ts";
import { FakeD1, FakeD1WithoutSessions, result, stall } from "./fakeD1.ts";

/**
 * Exposes the managed-timer registry so a test can prove the wrapper cleans
 * up after itself. Subclassing to reach a protected member is the project's
 * documented alternative to reaching for `vi.spyOn`.
 */
class TestDateTimeProvider extends DateTimeProvider {
  public get pendingTimers(): number {
    return this.timeouts.length;
  }
}

const boot = async () => {
  const alepha = Alepha.create().with({
    provide: DateTimeProvider,
    use: TestDateTimeProvider,
  });
  const timeouts = alepha.inject(D1TimeoutProvider);
  const time = alepha.inject(TestDateTimeProvider);
  await alepha.start();
  time.pause();
  return { alepha, timeouts, time };
};

describe("D1TimeoutProvider", () => {
  it("rejects a read that outlives the budget", async () => {
    const { timeouts, time } = await boot();
    const wrapped = timeouts.wrap(new FakeD1(stall), [5, "seconds"]);

    const pending = wrapped.prepare("select 1").all();
    const settled = await expect(pending).rejects.toThrow(/timed out/i);

    await time.travel([6, "seconds"]);
    settled;
  });

  it("rejects a stalled batch, not just a stalled statement", async () => {
    const { timeouts, time } = await boot();
    const wrapped = timeouts.wrap(new FakeD1(stall), [5, "seconds"]);

    const pending = wrapped.batch([]);
    const settled = await expect(pending).rejects.toThrow(/timed out/i);

    await time.travel([6, "seconds"]);
    settled;
  });

  it("leaves a query that answers in time untouched", async () => {
    const { timeouts } = await boot();
    const rows = [{ id: 1 }];
    const wrapped = timeouts.wrap(new FakeD1(async () => result(rows)), [
      5,
      "seconds",
    ]);

    await expect(wrapped.prepare("select 1").all()).resolves.toEqual(
      result(rows),
    );
  });

  it("keeps values bound through the wrapper", async () => {
    const source = new FakeD1(async () => result([]));
    const { timeouts } = await boot();
    const wrapped = timeouts.wrap(source, [5, "seconds"]);

    await wrapped.prepare("select ?").bind("alice", 42).all();

    // `bind` returns a NEW statement from D1 carrying the values, so a
    // wrapper that returned itself instead of re-wrapping would run every
    // query unbound, silently, and only in production.
    expect(source.executed).toEqual([["alice", 42]]);
  });

  it("clears the timer when the query answers in time", async () => {
    const { timeouts, time } = await boot();
    const wrapped = timeouts.wrap(new FakeD1(async () => result([])), [
      5,
      "seconds",
    ]);

    await wrapped.prepare("select 1").all();

    // Every query arms a timer. Leaking one per query would pin the isolate
    // awake and, under a paused clock, make the next travel() fire timers
    // belonging to queries that already finished.
    expect(time.pendingTimers).toBe(0);
  });

  it("does not leave an unhandled rejection when a timed-out query later fails", async () => {
    const rejections: unknown[] = [];
    const capture = (reason: unknown) => rejections.push(reason);
    process.on("unhandledRejection", capture);

    try {
      const { timeouts, time } = await boot();
      let fail: (error: Error) => void = () => {};
      const wrapped = timeouts.wrap(
        new FakeD1(
          () =>
            new Promise((_, reject) => {
              fail = reject;
            }),
        ),
        [5, "seconds"],
      );

      const pending = wrapped.prepare("select 1").all();
      const settled = await expect(pending).rejects.toThrow(/timed out/i);
      await time.travel([6, "seconds"]);
      settled;

      // The query D1 never answered finally errors, long after we stopped
      // waiting. Nothing is attached to it any more unless the wrapper kept
      // an observer, and on Workers an unhandled rejection can take the
      // isolate down.
      fail(new Error("primary gave up"));
      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(rejections).toEqual([]);
    } finally {
      process.off("unhandledRejection", capture);
    }
  });

  describe("sessions", () => {
    it("carries the budget into a session", async () => {
      const { timeouts, time } = await boot();
      const wrapped = timeouts.wrap(new FakeD1(stall), [5, "seconds"]);

      const session = wrapped.withSession?.("first-unconstrained");
      const pending = session?.prepare("select 1").all();
      const settled = await expect(pending).rejects.toThrow(/timed out/i);

      // The budget is on by default on serverless, so a wrapper that dropped
      // `withSession` would not merely lose the ceiling: it would make the
      // method vanish and take read replication down with it.
      await time.travel([6, "seconds"]);
      settled;
    });

    it("keeps withSession absent when the runtime has none", async () => {
      const { timeouts } = await boot();
      const wrapped = timeouts.wrap(new FakeD1WithoutSessions(), [
        5,
        "seconds",
      ]);

      // The wrapper must not invent the method: callers feature-detect it to
      // decide whether replication is available at all.
      expect(wrapped.withSession).toBeUndefined();
    });

    it("passes the constraint through to the binding", async () => {
      const source = new FakeD1();
      const { timeouts } = await boot();
      const wrapped = timeouts.wrap(source, [5, "seconds"]);

      wrapped.withSession?.("first-primary");

      expect(source.sessions).toEqual(["first-primary"]);
    });

    it("reports the session bookmark through the wrapper", async () => {
      const source = new FakeD1();
      source.bookmark = "bm-42";
      const { timeouts } = await boot();
      const wrapped = timeouts.wrap(source, [5, "seconds"]);

      expect(wrapped.withSession?.()?.getBookmark()).toBe("bm-42");
    });
  });

  describe("write policy", () => {
    it("leaves writes unbounded when applyTo is reads", async () => {
      const { timeouts, time } = await boot();
      const wrapped = timeouts.wrap(new FakeD1(stall), [5, "seconds"], {
        applyTo: "reads",
      });

      let settled = false;
      void wrapped
        .prepare("insert into quests (title) values (?)")
        .run()
        .then(
          () => {
            settled = true;
          },
          () => {
            settled = true;
          },
        );

      await time.travel([60, "seconds"]);
      await new Promise((resolve) => setTimeout(resolve, 10));

      // A timed-out write is not free: D1 has no abort, so the statement may
      // still commit while the caller is told it failed. Under `reads` an app
      // that cannot tolerate a phantom insert keeps the old behaviour.
      expect(settled).toBe(false);
    });

    it("still bounds reads when applyTo is reads", async () => {
      const { timeouts, time } = await boot();
      const wrapped = timeouts.wrap(new FakeD1(stall), [5, "seconds"], {
        applyTo: "reads",
      });

      const pending = wrapped.prepare("SELECT * from quests").all();
      const settled = await expect(pending).rejects.toThrow(/timed out/i);

      await time.travel([6, "seconds"]);
      settled;
    });

    it("treats a CTE as a write, since it may wrap an insert", async () => {
      const { timeouts, time } = await boot();
      const wrapped = timeouts.wrap(new FakeD1(stall), [5, "seconds"], {
        applyTo: "reads",
      });

      let settled = false;
      void wrapped
        .prepare("with rows as (select 1) insert into t select * from rows")
        .run()
        .then(
          () => {
            settled = true;
          },
          () => {
            settled = true;
          },
        );

      await time.travel([60, "seconds"]);
      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(settled).toBe(false);
    });

    it("bounds writes by default", async () => {
      const { timeouts, time } = await boot();
      const wrapped = timeouts.wrap(new FakeD1(stall), [5, "seconds"]);

      const pending = wrapped.prepare("insert into quests values (1)").run();
      const settled = await expect(pending).rejects.toThrow(/timed out/i);

      await time.travel([6, "seconds"]);
      settled;
    });
  });
});
