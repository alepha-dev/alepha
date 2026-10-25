import {
  type ChildProcess,
  type ChildProcessByStdio,
  spawn,
} from "node:child_process";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { Readable } from "node:stream";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const child = join(here, "fixtures", "exclusive-child.ts");

interface Mark {
  event: "enter" | "leave";
  pid: number;
  at: number;
}

describe("exclusive across processes", () => {
  /**
   * The scratch directories and the children of the current case.
   *
   * Tracked so the case can clean up after itself: a scratch directory sits
   * at the root of the system temp directory, where nothing else sweeps it.
   */
  const scratchDirs: string[] = [];
  const children: ChildProcess[] = [];

  const scratch = (): string => {
    const dir = mkdtempSync(join(tmpdir(), "alepha-exclusive-xp-"));
    scratchDirs.push(dir);
    return dir;
  };

  /**
   * Start the fixture with `dir` as its queue base, and record it.
   */
  const spawnChild = (
    dir: string,
    key: string,
    holdMs: number,
    env: Record<string, string> = {},
  ): ChildProcessByStdio<null, Readable, Readable> => {
    const proc = spawn(process.execPath, [child, key, String(holdMs)], {
      env: { ...process.env, ALEPHA_EXCLUSIVE_DIR: dir, ...env },
      stdio: ["ignore", "pipe", "pipe"],
    });
    children.push(proc);
    return proc;
  };

  /**
   * Resolves once `proc` has exited, killing it first if it has not.
   */
  const reap = (proc: ChildProcess): Promise<void> => {
    if (proc.exitCode !== null || proc.signalCode !== null) {
      return Promise.resolve();
    }

    const exited = new Promise<void>((resolve) => {
      proc.once("exit", () => resolve());
    });
    proc.kill("SIGKILL");
    return exited;
  };

  afterEach(async () => {
    // The children share the scratch directory through ALEPHA_EXCLUSIVE_DIR,
    // so it can only go once all of them are gone: a child that has not
    // acquired yet recreates it, and one that has keeps writing its ticket
    // there. A case that passed has seen its children out, bar a SIGTERM'd
    // holder still finishing its handler; one that failed can leave a holder
    // parked on a long hold, so whatever is left is killed, not waited out.
    await Promise.all(children.splice(0).map(reap));

    for (const dir of scratchDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  /**
   * Every ticket under a scratch root, across the one key directory below it.
   *
   * Read by walking rather than by recomputing the hashed directory name, so
   * the assertion does not depend on the provider agreeing with the test about
   * how a key is hashed.
   */
  const tickets = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .flatMap((entry) =>
        readdirSync(join(dir, entry.name)).filter((f) => f.endsWith(".json")),
      );

  const run = (
    dir: string,
    key: string,
    holdMs: number,
    env: Record<string, string> = {},
  ): Promise<Mark[]> =>
    new Promise((resolve, reject) => {
      const proc = spawnChild(dir, key, holdMs, env);

      let out = "";
      let err = "";
      proc.stdout.on("data", (chunk) => {
        out += String(chunk);
      });
      proc.stderr.on("data", (chunk) => {
        err += String(chunk);
      });
      proc.on("error", reject);
      proc.on("close", (code) => {
        if (code !== 0 && code !== 143) {
          reject(new Error(`child exited ${code}: ${err}`));
          return;
        }
        resolve(
          out
            .split("\n")
            .filter(Boolean)
            .map((line) => JSON.parse(line) as Mark),
        );
      });
    });

  it("never lets two processes hold the same key at once", async () => {
    const dir = scratch();

    // Started together on purpose: without the queue they would overlap.
    const results = await Promise.all([
      run(dir, "shared", 400),
      run(dir, "shared", 400),
      run(dir, "shared", 400),
    ]);

    const windows = results.map((marks) => {
      const enter = marks.find((m) => m.event === "enter");
      const leave = marks.find((m) => m.event === "leave");
      expect(enter).toBeDefined();
      expect(leave).toBeDefined();
      return { from: enter!.at, to: leave!.at };
    });

    windows.sort((a, b) => a.from - b.from);

    for (let i = 1; i < windows.length; i++) {
      expect(windows[i].from).toBeGreaterThanOrEqual(windows[i - 1].to);
    }
  }, 60_000);

  it("lets different keys run at the same time", async () => {
    const dir = scratch();

    const started = Date.now();
    await Promise.all([run(dir, "one", 400), run(dir, "two", 400)]);
    const elapsed = Date.now() - started;

    // Serialised they would take at least 800ms plus two process startups.
    expect(elapsed).toBeLessThan(4_000);
  }, 60_000);

  it("keeps the slot while a live holder is stalled", async () => {
    const dir = scratch();

    // The holder spins for well over any heartbeat interval, so no beat can
    // fire from inside it. Sweeping on heartbeat age let a waiter evict it
    // here, and the holder then recreated its own ticket still holding: two
    // processes inside at once. Sweeping on the pid cannot.
    const [holder, waiter] = await Promise.all([
      run(dir, "shared", 0, { CHILD_STALL_MS: "2500" }),
      // Started a beat later so the order is not itself in question.
      new Promise<Mark[]>((resolve, reject) => {
        setTimeout(() => run(dir, "shared", 50).then(resolve, reject), 300);
      }),
    ]);

    const left = holder.find((m) => m.event === "leave");
    const entered = waiter.find((m) => m.event === "enter");
    expect(left).toBeDefined();
    expect(entered).toBeDefined();
    expect(entered!.at).toBeGreaterThanOrEqual(left!.at);
  }, 60_000);

  it("frees the slot when the holder is killed outright", async () => {
    const dir = scratch();

    const holder = spawnChild(dir, "shared", 60_000, {
      CHILD_WAIT_FOR_SIGNAL: "1",
    });

    await new Promise<void>((resolve) => {
      holder.stdout.on("data", (chunk) => {
        if (String(chunk).includes("enter")) {
          resolve();
        }
      });
    });

    // SIGKILL cannot be handled, so nothing unlinks the ticket. Only the sweep
    // can free this queue, which is what the assertion is really about.
    holder.kill("SIGKILL");
    await new Promise<void>((resolve) => holder.on("close", () => resolve()));
    expect(tickets(dir)).toHaveLength(1);

    const started = Date.now();
    await run(dir, "shared", 50);
    expect(Date.now() - started).toBeLessThan(10_000);
    expect(tickets(dir)).toHaveLength(0);
  }, 60_000);

  it("frees the slot when the holder is terminated", async () => {
    const dir = scratch();

    const holder = spawnChild(dir, "shared", 60_000, {
      CHILD_WAIT_FOR_SIGNAL: "1",
    });

    await new Promise<void>((resolve) => {
      holder.stdout.on("data", (chunk) => {
        if (String(chunk).includes("enter")) {
          resolve();
        }
      });
    });

    holder.kill("SIGTERM");

    // The signal handler unlinks the ticket, so the next arrival must get in
    // well before the 15s stale window would have expired.
    const started = Date.now();
    await run(dir, "shared", 50);
    expect(Date.now() - started).toBeLessThan(10_000);
  }, 60_000);
});
