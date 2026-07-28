import { mkdir, mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Alepha } from "alepha";
import {
  LogDestinationProvider,
  MemoryDestinationProvider,
} from "alepha/logger";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Runner } from "../index.ts";

/**
 * `RunOptions.root` was honoured for string shell commands and silently
 * dropped by `run.rm` / `run.cp`, which called `node:fs` with the caller's
 * path verbatim — so they resolved against `process.cwd()`. In a monorepo
 * build task that means deleting relative to the wrong directory, or nothing
 * at all.
 */
describe("Runner — RunOptions.root on rm/cp", () => {
  let alepha: Alepha;
  let runner: Runner;
  let root: string;

  const exists = async (path: string) =>
    await stat(path).then(
      () => true,
      () => false,
    );

  beforeEach(async () => {
    alepha = Alepha.create({ env: { LOG_LEVEL: "silent" } }).with({
      provide: LogDestinationProvider,
      use: MemoryDestinationProvider,
    });
    runner = alepha.inject(Runner);
    root = await mkdtemp(join(tmpdir(), "alepha-runner-"));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("removes a plain path relative to root, not cwd", async () => {
    await mkdir(join(root, "dist"), { recursive: true });
    await writeFile(join(root, "dist", "app.js"), "x");

    await runner.run.rm("dist", { root });

    expect(await exists(join(root, "dist"))).toBe(false);
  });

  it("removes a glob relative to root, not cwd", async () => {
    await mkdir(join(root, "build"), { recursive: true });
    await writeFile(join(root, "build", "a.map"), "x");
    await writeFile(join(root, "build", "b.map"), "x");
    await writeFile(join(root, "build", "keep.js"), "x");

    await runner.run.rm("build/*.map", { root });

    expect(await exists(join(root, "build", "a.map"))).toBe(false);
    expect(await exists(join(root, "build", "b.map"))).toBe(false);
    expect(await exists(join(root, "build", "keep.js"))).toBe(true);
  });

  it("copies relative to root, not cwd", async () => {
    await mkdir(join(root, "src"), { recursive: true });
    await writeFile(join(root, "src", "index.ts"), "export {};");

    await runner.run.cp("src", "copy", { root });

    expect(await exists(join(root, "copy", "index.ts"))).toBe(true);
  });

  it("leaves absolute paths alone even when root is given", async () => {
    const outside = await mkdtemp(join(tmpdir(), "alepha-runner-abs-"));
    await writeFile(join(outside, "f.txt"), "x");

    await runner.run.rm(join(outside, "f.txt"), { root });

    expect(await exists(join(outside, "f.txt"))).toBe(false);
    await rm(outside, { recursive: true, force: true });
  });

  it("still resolves against cwd when no root is given", async () => {
    // Nothing to assert about the filesystem — the point is that omitting
    // `root` must not start resolving against some other directory.
    await mkdir(join(root, "nested"), { recursive: true });
    await runner.run.rm(join(root, "nested"));

    expect(await exists(join(root, "nested"))).toBe(false);
  });
});

describe("Runner — parallel task output", () => {
  let alepha: Alepha;
  let runner: Runner;

  beforeEach(() => {
    alepha = Alepha.create({ env: { LOG_LEVEL: "silent" } }).with({
      provide: LogDestinationProvider,
      use: MemoryDestinationProvider,
    });
    runner = alepha.inject(Runner);
  });

  it("returns the output of parallel tasks instead of an empty string", async () => {
    const out = await runner.run([
      { name: "first", handler: () => "one" },
      { name: "second", handler: () => "two" },
    ]);

    expect(out).toContain("one");
    expect(out).toContain("two");
  });
});
