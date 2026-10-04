import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { $atom, Alepha, z } from "alepha";
import { $logger } from "alepha/logger";
import { FileSystemProvider, NodeFileSystemProvider } from "alepha/system";
import { afterEach, describe, it } from "vitest";

import { INSPECTOR_PROTOCOL } from "../constants/INSPECTOR_PROTOCOL.ts";
import { AlephaInspector } from "../index.ts";
import { InspectorRunProvider } from "../providers/InspectorRunProvider.ts";
import { InspectorClient } from "../services/InspectorClient.ts";
import type { InspectorLogEntry } from "../services/InspectorConnection.ts";

const themeAtom = $atom({
  name: "test.inspector.client.theme",
  schema: z.object({ theme: z.string() }),
  default: { theme: "light" },
});

/**
 * Something in the app that logs, on demand.
 */
class Talker {
  public readonly log = $logger();
}

/**
 * Log `ping` until the tail has delivered one, which proves it is open and
 * past its starting cursor. A fixed sleep is a race on a loaded machine.
 */
const untilOpen = async (
  log: (message: string) => void,
  opened: () => boolean,
) => {
  for (let i = 0; i < 200 && !opened(); i++) {
    log("ping");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
};

describe("InspectorClient", () => {
  const dirs: string[] = [];
  const apps: Alepha[] = [];

  afterEach(async () => {
    for (const app of apps.splice(0)) await app.stop();
    for (const dir of dirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  /**
   * A real app and a separate tool, sharing nothing but a run directory on
   * disk, as two processes would.
   */
  const setup = async () => {
    const root = mkdtempSync(join(tmpdir(), "ai-"));
    dirs.push(root);
    const runDir = join(root, "run");
    const env = { ALEPHA_RUN_DIR: runDir };

    const app = Alepha.create({ env: { ...env, ALEPHA_INSPECT: "1" } })
      .with({ provide: FileSystemProvider, use: NodeFileSystemProvider })
      .with(AlephaInspector)
      .with(Talker);
    apps.push(app);
    await app.start();
    app.store.get(themeAtom);

    const tool = Alepha.create({ env }).with({
      provide: FileSystemProvider,
      use: NodeFileSystemProvider,
    });
    const client = tool.inject(InspectorClient);

    return { app, tool, client, runDir, root };
  };

  it("discovers the running app and calls its routes by name, typed", async ({
    expect,
  }) => {
    const { app, client } = await setup();
    const runId = app.inject(InspectorRunProvider).runId;

    const runs = await client.discover();
    expect(runs.map((r) => [r.runId, r.status])).toEqual([[runId, "live"]]);

    const conn = client.connect(runs[0]);
    const meta = await conn.call("metadata");
    expect(meta.system.mode).toBe("development");
    expect(meta.atoms.some((a) => a.name === themeAtom.key)).toBe(true);

    const saved = await conn.call("updateAtom", {
      body: { name: themeAtom.key, value: { theme: "dark" } },
    });
    expect(saved).toEqual({ success: true });
    expect(app.store.get(themeAtom)).toEqual({ theme: "dark" });

    // A path parameter, encoded; no ORM here, so an empty page.
    const rows = await conn.call("dbList", { params: { entity: "a b" } });
    expect(rows).toEqual({ content: [], page: { totalElements: 0 } });
  });

  it("throws on a route's error status, with the route's message", async ({
    expect,
  }) => {
    const { client } = await setup();
    const [run] = await client.discover();

    await expect(
      client.connect(run).call("updateAtom", { body: { value: 1 } as any }),
    ).rejects.toThrow(/POST \/atoms answered 400/);
  });

  it("tails new log entries in order, and stops on abort", async ({
    expect,
  }) => {
    const { app, client } = await setup();
    const [run] = await client.discover();
    const talker = app.inject(Talker);
    talker.log.info("before the tail");

    const controller = new AbortController();
    const seen: InspectorLogEntry[] = [];
    let pinged = false;
    const tailing = (async () => {
      for await (const entry of client.connect(run).tail({
        intervalMs: 20,
        signal: controller.signal,
      })) {
        if (entry.message === "ping") pinged = true;
        if (entry.message.startsWith("tail ")) seen.push(entry);
        if (seen.length === 3) controller.abort();
      }
    })();

    await untilOpen(
      (m) => talker.log.info(m),
      () => pinged,
    );
    talker.log.info("tail one");
    talker.log.warn("tail two");
    talker.log.error("tail three");

    await tailing;
    expect(seen.map((e) => e.message)).toEqual([
      "tail one",
      "tail two",
      "tail three",
    ]);
    // Nothing from before it opened.
    expect(seen.some((e) => e.message === "before the tail")).toBe(false);
  });

  it("filters the tail by level", async ({ expect }) => {
    const { app, client } = await setup();
    const [run] = await client.discover();
    const talker = app.inject(Talker);

    const controller = new AbortController();
    const seen: string[] = [];
    let pinged = false;
    const tailing = (async () => {
      for await (const entry of client.connect(run).tail({
        level: "error",
        intervalMs: 20,
        signal: controller.signal,
      })) {
        if (entry.message === "ping") {
          pinged = true;
          continue;
        }
        seen.push(entry.message);
        if (entry.message === "boom") controller.abort();
      }
    })();

    await untilOpen(
      (m) => talker.log.error(m),
      () => pinged,
    );
    talker.log.info("quiet");
    talker.log.error("boom");

    await tailing;
    expect(seen).toEqual(["boom"]);
  });

  it("ends the tail when the app stops", async ({ expect }) => {
    const { app, client } = await setup();
    const [run] = await client.discover();

    const tailing = (async () => {
      const seen: string[] = [];
      for await (const entry of client.connect(run).tail({ intervalMs: 20 })) {
        seen.push(entry.message);
      }
      return seen;
    })();

    await new Promise((resolve) => setTimeout(resolve, 50));
    await app.stop();

    // Returns rather than hangs or throws: the run went away.
    await expect(tailing).resolves.toBeInstanceOf(Array);
  });

  it("refuses a run that speaks another protocol, naming both and the matching tool", async ({
    expect,
  }) => {
    const { app, client, runDir } = await setup();
    const file = app.inject(InspectorRunProvider).file!;
    const entry = JSON.parse(
      await app.inject(FileSystemProvider).readTextFile(file),
    );
    writeFileSync(
      join(runDir, entry.socket.replace(".sock", ".json")),
      JSON.stringify({ ...entry, protocol: INSPECTOR_PROTOCOL + 1 }),
    );

    const [run] = await client.discover();
    expect(() => client.connect(run)).toThrow(
      new RegExp(
        `protocol ${INSPECTOR_PROTOCOL + 1}, this client speaks ${INSPECTOR_PROTOCOL}.*npx @alepha/devtools@`,
      ),
    );
  });

  it("reads a dead run's logs from its file, and refuses any other call", async ({
    expect,
  }) => {
    const { app, client, runDir, root } = await setup();
    const own = await app.inject(InspectorRunProvider).entry();

    const logFile = join(root, "crashed.jsonl");
    const line = (level: string, message: string, timestamp: number) =>
      JSON.stringify({ level, message, service: "s", module: "m", timestamp });
    writeFileSync(
      logFile,
      [
        line("INFO", "\u001b[36mstarting\u001b[0m", 1),
        line("ERROR", "crashed here", 2),
        '{"level":"ERR',
      ].join("\n"),
    );
    writeFileSync(
      join(runDir, "crashed0.json"),
      JSON.stringify({
        ...own,
        runId: "crashed0",
        cwd: "/apps/crashed",
        socket: "crashed0.sock",
        startedAt: "2026-01-01T00:00:00.000Z",
        logFile,
      }),
    );

    const dead = (await client.discover()).find((r) => r.runId === "crashed0")!;
    expect(dead.status).toBe("dead");

    const conn = client.connect(dead);
    await expect(conn.call("metadata")).rejects.toThrow(/is dead/);

    const page = await conn.logs();
    expect(page.logs.map((e) => e.message)).toEqual([
      "crashed here",
      // The colour codes go, as they do on the live route.
      "starting",
    ]);
    expect((await conn.logs({ level: "error" })).logs).toHaveLength(1);

    const tailed: string[] = [];
    for await (const entry of conn.tail()) tailed.push(entry.message);
    expect(tailed).toEqual(["starting", "crashed here"]);
  });
});
