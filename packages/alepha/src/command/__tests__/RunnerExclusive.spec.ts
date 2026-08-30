import { mkdtempSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Alepha, AlephaError } from "alepha";
import {
  LogDestinationProvider,
  MemoryDestinationProvider,
} from "alepha/logger";
import { describe, expect, it } from "vitest";

import { ExclusiveProvider, exclusiveOptions, Runner } from "../index.ts";

/**
 * `RunOptions.exclusive` puts one step of a pipeline in the machine-wide
 * queue instead of the whole command.
 *
 * The distinction that matters: what two checkouts contend for is a resource
 * (the one postgres every `vitest.config.ts` points at), not a command. A slot
 * held for the whole of `verify` makes a second checkout wait out `lint` and
 * `typecheck` too, which contend for nothing.
 */
describe("Runner: RunOptions.exclusive", () => {
  const scratch = (): string =>
    mkdtempSync(join(tmpdir(), "alepha-runner-exclusive-"));

  /**
   * A runner whose queue lives in `dir`, with the windows shrunk so the test
   * does not spend seconds sleeping.
   *
   * `store.mut` MUST run before the injection: `$store` is a class field, so
   * `ExclusiveProvider` reads the atom when it is constructed.
   */
  const runner = (dir: string): Runner => {
    const alepha = Alepha.create({ env: { LOG_LEVEL: "silent" } }).with({
      provide: LogDestinationProvider,
      use: MemoryDestinationProvider,
    });
    alepha.store.mut(exclusiveOptions, (old) => ({
      ...old,
      dir,
      pollIntervalMs: 10,
      heartbeatIntervalMs: 20,
      staleAfterMs: 120,
      hintAfterMs: 60_000,
    }));
    return alepha.inject(Runner);
  };

  const tickets = (dir: string, key: string): string[] => {
    const alepha = Alepha.create();
    alepha.store.mut(exclusiveOptions, (old) => ({ ...old, dir }));
    return readdirSync(alepha.inject(ExclusiveProvider).queueDir(key));
  };

  it("makes a second runner wait for the slot", async () => {
    const dir = scratch();
    const first = runner(dir);
    const second = runner(dir);

    let releaseFirst: () => void = () => {};
    const firstHeld = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    let secondStarted = false;

    const firstRun = first.run(
      { name: "first", handler: () => firstHeld },
      { exclusive: "k" },
    );

    // Let the first task reach its handler before the second one queues.
    await new Promise((r) => setTimeout(r, 40));

    const secondRun = second.run(
      {
        name: "second",
        handler: async () => {
          secondStarted = true;
        },
      },
      { exclusive: "k" },
    );

    await new Promise((r) => setTimeout(r, 60));
    expect(secondStarted).toBe(false);

    releaseFirst();
    await firstRun;
    await secondRun;

    expect(secondStarted).toBe(true);
  });

  it("does not serialise tasks that name no key", async () => {
    const dir = scratch();
    const first = runner(dir);
    const second = runner(dir);

    let releaseFirst: () => void = () => {};
    const firstHeld = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    let secondStarted = false;

    const firstRun = first.run({ name: "first", handler: () => firstHeld });
    await new Promise((r) => setTimeout(r, 40));

    await second.run({
      name: "second",
      handler: async () => {
        secondStarted = true;
      },
    });

    expect(secondStarted).toBe(true);

    releaseFirst();
    await firstRun;
  });

  it("takes one slot for a whole parallel group", async () => {
    const dir = scratch();
    const group = runner(dir);

    const started: string[] = [];
    let bothStarted: () => void = () => {};
    const both = new Promise<void>((resolve) => {
      bothStarted = resolve;
    });
    let finish: () => void = () => {};
    const done = new Promise<void>((resolve) => {
      finish = resolve;
    });

    const task = (name: string) => ({
      name,
      handler: async () => {
        started.push(name);
        if (started.length === 2) {
          bothStarted();
        }
        await done;
      },
    });

    const running = group.run([task("a"), task("b")], { exclusive: "k" });

    // One ticket per task would serialise the group against itself, and the
    // second task would never start while the first holds the slot.
    const outcome = await Promise.race([
      both.then(() => "overlapped"),
      new Promise((resolve) => setTimeout(() => resolve("serialised"), 300)),
    ]);

    finish();
    await running;

    expect(outcome).toBe("overlapped");
  });

  it("releases the slot when the task throws", async () => {
    const dir = scratch();
    const failing = runner(dir);

    await expect(
      failing.run(
        {
          name: "boom",
          handler: () => {
            throw new AlephaError("boom");
          },
        },
        { exclusive: "k" },
      ),
    ).rejects.toThrowError();

    // A leaked ticket is invisible until the next process waits out the stale
    // window, so assert on the queue rather than on the next acquire.
    expect(tickets(dir, "k")).toEqual([]);
  });
});
