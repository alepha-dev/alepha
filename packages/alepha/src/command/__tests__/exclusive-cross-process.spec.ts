import { spawn } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const child = join(here, "fixtures", "exclusive-child.ts");

interface Mark {
  event: "enter" | "leave";
  pid: number;
  at: number;
}

describe("exclusive across processes", () => {
  const scratch = (): string =>
    mkdtempSync(join(tmpdir(), "alepha-exclusive-xp-"));

  const run = (
    dir: string,
    key: string,
    holdMs: number,
    env: Record<string, string> = {},
  ): Promise<Mark[]> =>
    new Promise((resolve, reject) => {
      const proc = spawn(process.execPath, [child, key, String(holdMs)], {
        env: { ...process.env, ALEPHA_EXCLUSIVE_DIR: dir, ...env },
        stdio: ["ignore", "pipe", "pipe"],
      });

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

  it("frees the slot when the holder is terminated", async () => {
    const dir = scratch();

    const holder = spawn(process.execPath, [child, "shared", "60000"], {
      env: {
        ...process.env,
        ALEPHA_EXCLUSIVE_DIR: dir,
        CHILD_WAIT_FOR_SIGNAL: "1",
      },
      stdio: ["ignore", "pipe", "pipe"],
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
