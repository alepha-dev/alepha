import { Alepha } from "alepha";
import { FileSystemProvider, MemoryFileSystemProvider } from "alepha/system";
import { describe, it } from "vitest";

import { INSPECTOR_PROTOCOL } from "../constants/INSPECTOR_PROTOCOL.ts";
import { AlephaInspector } from "../index.ts";
import { InspectorRunProvider } from "../providers/InspectorRunProvider.ts";
import { InspectorSocketServer } from "../providers/InspectorSocketServer.ts";
import type { InspectorRun } from "../schemas/InspectorRun.ts";
import { InspectorRegistry } from "../services/InspectorRegistry.ts";

const RUN_DIR = "/tmp/alepha-run-spec";

/**
 * Liveness without sockets: the files live in memory, so the spec decides
 * which runs answer. The real probe is covered by `InspectorSocketServer.spec`.
 */
class TestInspectorRegistry extends InspectorRegistry {
  public dead = new Set<string>();

  protected override async probe(
    run: InspectorRun,
  ): Promise<"live" | "refused" | "timeout"> {
    return this.dead.has(run.runId) ? "refused" : "live";
  }
}

/**
 * A socket that is always "listening", without binding anything: the entry is
 * only written for a process a tool can reach.
 */
class FakeSocketServer extends InspectorSocketServer {
  protected override async listen(): Promise<void> {
    this.path = `${RUN_DIR}/fake.sock`;
  }

  protected override async close(): Promise<void> {
    this.path = undefined;
  }
}

const boot = async () => {
  const alepha = Alepha.create({
    env: { ALEPHA_INSPECT: "1", ALEPHA_RUN_DIR: RUN_DIR },
  })
    .with({ provide: FileSystemProvider, use: MemoryFileSystemProvider })
    .with({ provide: InspectorRegistry, use: TestInspectorRegistry })
    .with({ provide: InspectorSocketServer, use: FakeSocketServer })
    .with(AlephaInspector);

  const fs = alepha.inject(MemoryFileSystemProvider);
  await alepha.start();

  return {
    alepha,
    fs,
    run: alepha.inject(InspectorRunProvider),
    registry: alepha.inject(TestInspectorRegistry),
  };
};

describe("the inspector run registry", () => {
  it("writes <runId>.json on ready, 0600 in a 0700 directory, and removes it on stop", async ({
    expect,
  }) => {
    const { alepha, fs, run } = await boot();

    expect(run.runId).toMatch(/^[0-9a-z]{8}$/);
    const file = `${RUN_DIR}/${run.runId}.json`;
    expect(run.file).toBe(file);
    expect(fs.wasWrittenWithMode(file, 0o600)).toBe(true);
    expect((await fs.stat(RUN_DIR)).mode).toBe(0o700);

    await alepha.stop();

    expect(fs.wasDeleted(file)).toBe(true);
    expect(await fs.exists(file)).toBe(false);
  });

  it("names the file by run id, never the pid", async ({ expect }) => {
    const first = await boot();
    const second = await boot();

    // Two processes that are both pid 1 in their containers would collide on
    // `1.json`. Two runs of one pid here make the same point.
    expect(first.run.runId).not.toBe(second.run.runId);

    await first.alepha.stop();
    await second.alepha.stop();
  });

  it("carries the entry fields, the socket as a bare file name", async ({
    expect,
  }) => {
    const { alepha, fs, run } = await boot();

    const entry = JSON.parse(fs.getFileContent(run.file!)!);
    expect(entry).toMatchObject({
      runId: run.runId,
      cwd: process.cwd(),
      pid: process.pid,
      mode: "development",
      protocol: INSPECTOR_PROTOCOL,
      socket: `${run.runId}.sock`,
    });
    expect(typeof entry.name).toBe("string");
    expect(typeof entry.alephaVersion).toBe("string");
    expect(Number.isNaN(Date.parse(entry.startedAt))).toBe(false);
    expect(entry.logFile).toMatch(/devtools[\\/]logs\.jsonl$/);
    // Absolute, so a tool that is not this process can open it.
    expect(entry.logFile.startsWith("/")).toBe(true);

    await alepha.stop();
  });

  it("names the run after the nearest package.json, and finds the git root", async ({
    expect,
  }) => {
    const { alepha, fs, run } = await boot();

    const cwd = process.cwd();
    const parent = cwd.split("/").slice(0, -1).join("/");
    await fs.mkdir(cwd, { recursive: true });
    await fs.writeFile(
      `${cwd}/package.json`,
      JSON.stringify({ name: "spec-app" }),
    );
    await fs.writeFile(`${parent}/.git`, "gitdir: elsewhere");

    const entry = await run.entry();
    expect(entry.name).toBe("spec-app");
    expect(entry.gitRoot).toBe(parent);

    await alepha.stop();
  });

  it("falls back to the cwd's basename, and no git root", async ({
    expect,
  }) => {
    const { alepha, run } = await boot();

    const entry = await run.entry();
    expect(entry.name).toBe(process.cwd().split("/").pop());
    expect(entry.gitRoot).toBeUndefined();

    await alepha.stop();
  });

  it("discover() lists the runs that answer, drops the others and torn files", async ({
    expect,
  }) => {
    const { alepha, fs, run, registry } = await boot();

    const own = JSON.parse(fs.getFileContent(run.file!)!);
    await fs.writeFile(
      `${RUN_DIR}/deadbeef.json`,
      JSON.stringify({
        ...own,
        runId: "deadbeef",
        pid: 999_999,
        socket: "deadbeef.sock",
      }),
    );
    registry.dead.add("deadbeef");
    await fs.writeFile(`${RUN_DIR}/torn0000.json`, '{"runId":"torn');
    await fs.writeFile(`${RUN_DIR}/notes.txt`, "not an entry");

    const live = await registry.discover();
    expect(live.map((r) => r.runId)).toEqual([run.runId]);
    expect(live[0].file).toBe(run.file);

    // `list()` is everything that parses, alive or not.
    const all = await registry.list();
    expect(all.map((r) => r.runId).sort()).toEqual(
      [run.runId, "deadbeef"].sort(),
    );

    await alepha.stop();
  });

  it("resolves the socket against the directory the entry was found in", async ({
    expect,
  }) => {
    const { alepha, fs, run, registry } = await boot();

    // What a container writes: its own absolute path, meaningless here.
    const own = JSON.parse(fs.getFileContent(run.file!)!);
    await fs.writeFile(
      run.file!,
      JSON.stringify({ ...own, socket: `/root/.alepha/run/${run.runId}.sock` }),
    );

    const [found] = await registry.discover();
    expect(found.socketPath).toBe(`${RUN_DIR}/${run.runId}.sock`);

    await alepha.stop();
  });

  it("uses ~/.alepha/run without ALEPHA_RUN_DIR", ({ expect }) => {
    const alepha = Alepha.create({ env: { ALEPHA_INSPECT: "1" } });
    const dir = alepha.inject(InspectorRegistry).directory();

    expect(dir.endsWith("/.alepha/run")).toBe(true);
  });

  describe("dead runs", () => {
    /**
     * Another run's entry, as a process that is gone would have left it.
     */
    const writeRun = async (
      fs: MemoryFileSystemProvider,
      own: Record<string, unknown>,
      fields: Record<string, unknown>,
    ) => {
      const entry = { ...own, ...fields };
      await fs.writeFile(
        `${RUN_DIR}/${String(entry.runId)}.json`,
        JSON.stringify(entry),
      );
      return entry;
    };

    it("keeps a dead run while its log file exists, marked dead", async ({
      expect,
    }) => {
      const { alepha, fs, run, registry } = await boot();
      const own = JSON.parse(fs.getFileContent(run.file!)!);

      await writeRun(fs, own, {
        runId: "crashed1",
        startedAt: "2026-01-01T00:00:00.000Z",
        cwd: "/apps/other",
        socket: "crashed1.sock",
        logFile: "/apps/other/logs.jsonl",
      });
      registry.dead.add("crashed1");
      await fs.mkdir("/apps/other", { recursive: true });
      await fs.writeFile("/apps/other/logs.jsonl", "");

      const runs = await registry.discover();
      // Oldest first.
      expect(runs.map((r) => [r.runId, r.status])).toEqual([
        ["crashed1", "dead"],
        [run.runId, "live"],
      ]);

      await alepha.stop();
    });

    it("drops a dead run whose log file is gone", async ({ expect }) => {
      const { alepha, fs, run, registry } = await boot();
      const own = JSON.parse(fs.getFileContent(run.file!)!);

      await writeRun(fs, own, {
        runId: "nologs00",
        cwd: "/apps/other",
        socket: "nologs00.sock",
        logFile: "/apps/other/missing.jsonl",
      });
      registry.dead.add("nologs00");

      expect((await registry.discover()).map((r) => r.runId)).toEqual([
        run.runId,
      ]);

      await alepha.stop();
    });

    it("keeps one dead run per cwd, replaced by any newer run of that app", async ({
      expect,
    }) => {
      const { alepha, fs, run, registry } = await boot();
      const own = JSON.parse(fs.getFileContent(run.file!)!);
      await fs.mkdir("/apps/other", { recursive: true });
      await fs.writeFile("/apps/other/logs.jsonl", "");

      for (const [runId, startedAt] of [
        ["older000", "2026-01-01T00:00:00.000Z"],
        ["newer000", "2026-01-02T00:00:00.000Z"],
      ]) {
        await writeRun(fs, own, {
          runId,
          startedAt,
          cwd: "/apps/other",
          socket: `${runId}.sock`,
          logFile: "/apps/other/logs.jsonl",
        });
        registry.dead.add(runId);
      }
      expect((await registry.discover()).map((r) => r.runId)).toEqual([
        "newer000",
        run.runId,
      ]);

      // And this run, newer than any of them, replaces a dead one of its own
      // cwd.
      await writeRun(fs, own, {
        runId: "mine0000",
        startedAt: "2026-01-01T00:00:00.000Z",
        socket: "mine0000.sock",
      });
      await fs.writeFile(own.logFile, "");
      registry.dead.add("mine0000");
      expect((await registry.discover()).map((r) => r.runId)).not.toContain(
        "mine0000",
      );

      await alepha.stop();
    });

    it("prune() deletes what discover() no longer shows, and nothing it does", async ({
      expect,
    }) => {
      const { alepha, fs, run, registry } = await boot();
      const own = JSON.parse(fs.getFileContent(run.file!)!);
      await fs.mkdir("/apps/other", { recursive: true });
      await fs.writeFile("/apps/other/logs.jsonl", "");

      await writeRun(fs, own, {
        runId: "kept0000",
        cwd: "/apps/other",
        socket: "kept0000.sock",
        logFile: "/apps/other/logs.jsonl",
      });
      await writeRun(fs, own, {
        runId: "gone0000",
        cwd: "/apps/third",
        socket: "gone0000.sock",
        logFile: "/apps/third/none.jsonl",
      });
      registry.dead.add("kept0000");
      registry.dead.add("gone0000");

      await registry.prune();

      expect(await fs.exists(`${RUN_DIR}/gone0000.json`)).toBe(false);
      expect(await fs.exists(`${RUN_DIR}/kept0000.json`)).toBe(true);
      expect(await fs.exists(run.file!)).toBe(true);

      await alepha.stop();
    });

    it("reads a dead run's log file without a socket, newest first, past a torn line", async ({
      expect,
    }) => {
      const { alepha, fs, registry } = await boot();
      const line = (message: string, timestamp: number) =>
        JSON.stringify({
          level: "INFO",
          message,
          service: "spec",
          module: "spec",
          timestamp,
        });
      await fs.mkdir("/apps/other", { recursive: true });
      await fs.writeFile(
        "/apps/other/logs.jsonl",
        `${line("first", 1)}\n${line("second", 2)}\n{"level":"ERR`,
      );

      const logs = await registry.readLogFile(
        { logFile: "/apps/other/logs.jsonl" },
        { limit: 10 },
      );
      expect(logs.map((e) => [e.message, e.seq])).toEqual([
        ["second", 1],
        ["first", 0],
      ]);
      expect(await registry.readLogFile({ logFile: undefined })).toEqual([]);

      await alepha.stop();
    });
  });
});
