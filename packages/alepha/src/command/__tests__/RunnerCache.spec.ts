import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Alepha, AlephaError } from "alepha";
import { describe, expect, it } from "vitest";

import { Runner } from "../index.ts";

/**
 * `RunOptions.cache` lets a pipeline skip a step that has already passed
 * against the same inputs.
 *
 * The key is the caller's to compute, and everything the step reads has to be
 * in it. What this file pins is the part the caller cannot get wrong on its
 * own: a failed step is never recorded, and a skip is never silent.
 */
describe("Runner: RunOptions.cache", () => {
  const runner = (): Runner => {
    const dir = mkdtempSync(join(tmpdir(), "alepha-runner-cache-"));
    const alepha = Alepha.create({
      env: { LOG_LEVEL: "silent", ALEPHA_CACHE_DIR: dir },
    });
    return alepha.inject(Runner);
  };

  it("should run a task whose key has never been recorded", async () => {
    const { run } = runner();
    let calls = 0;

    await run({ name: "first", handler: () => calls++ }, { cache: "key-a" });

    expect(calls).toBe(1);
  });

  it("should skip a task whose key already passed", async () => {
    const { run } = runner();
    let calls = 0;
    const task = () => ({ name: "twice", handler: () => calls++ });

    await run(task(), { cache: "key-a" });
    await run(task(), { cache: "key-a" });

    expect(calls).toBe(1);
  });

  it("should still run a task under a different key", async () => {
    const { run } = runner();
    let calls = 0;
    const task = () => ({ name: "twice", handler: () => calls++ });

    await run(task(), { cache: "key-a" });
    await run(task(), { cache: "key-b" });

    expect(calls).toBe(2);
  });

  /**
   * ⚠️ The property the whole thing rests on. Recording before knowing the
   * outcome, or recording in a `finally`, turns one red run into a permanently
   * green one: the second run skips the step that failed and the pipeline
   * reports success having never fixed anything.
   */
  it("should not record a task that threw", async () => {
    const { run } = runner();
    let calls = 0;
    const task = () => ({
      name: "boom",
      handler: () => {
        calls++;
        throw new AlephaError("nope");
      },
    });

    await expect(run(task(), { cache: "key-a" })).rejects.toThrowError();
    await expect(run(task(), { cache: "key-a" })).rejects.toThrowError();

    expect(calls).toBe(2);
  });

  it("should run every task when no key is given", async () => {
    const { run } = runner();
    let calls = 0;
    const task = () => ({ name: "uncached", handler: () => calls++ });

    await run(task());
    await run(task());

    expect(calls).toBe(2);
  });

  /**
   * A group is one unit of work under one key, the same way `exclusive` takes
   * one slot for a group rather than one each.
   */
  it("should treat a group of tasks as one cached unit", async () => {
    const { run } = runner();
    let calls = 0;
    const tasks = () => [
      { name: "a", handler: () => calls++ },
      { name: "b", handler: () => calls++ },
    ];

    await run(tasks(), { cache: "key-a" });
    await run(tasks(), { cache: "key-a" });

    expect(calls).toBe(2);
  });

  /**
   * A group is only as cacheable as its worst task: if either half failed,
   * nothing about the group passed.
   */
  it("should not record a group when one task threw", async () => {
    const { run } = runner();
    let calls = 0;
    const tasks = () => [
      { name: "a", handler: () => calls++ },
      {
        name: "b",
        handler: () => {
          throw new AlephaError("nope");
        },
      },
    ];

    await expect(run(tasks(), { cache: "key-a" })).rejects.toThrowError();
    await expect(run(tasks(), { cache: "key-a" })).rejects.toThrowError();

    expect(calls).toBe(2);
  });
});
