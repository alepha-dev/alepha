import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Alepha } from "alepha";
import {
  AlephaInspector,
  INSPECTOR_PROTOCOL,
  InspectorClient,
  type InspectorRun,
} from "alepha/inspector";
import { McpServerProvider } from "alepha/mcp";
import { FileSystemProvider, NodeFileSystemProvider } from "alepha/system";
import { afterEach, describe, it } from "vitest";

import { DevMcpServer } from "../mcp/DevMcpServer.ts";
import { DevMcpSession } from "../mcp/DevMcpSession.ts";

/**
 * A registry that lists what the spec says, for the selection rule. The
 * real one probes sockets, so its runs all share this process's `cwd`.
 */
class ListedInspectorClient extends InspectorClient {
  public listed: InspectorRun[] = [];

  public override discover(): Promise<InspectorRun[]> {
    return Promise.resolve(this.listed);
  }
}

const run = (overrides: Partial<InspectorRun>): InspectorRun => ({
  runId: "r1",
  name: "app",
  cwd: "/work/app",
  pid: 1,
  mode: "development",
  alephaVersion: "0.0.0",
  protocol: INSPECTOR_PROTOCOL,
  startedAt: "2026-11-08T10:00:00.000Z",
  socket: "r1.sock",
  file: "/run/r1.json",
  socketPath: "/run/r1.sock",
  status: "live",
  ...overrides,
});

describe("DevMcpServer", () => {
  const dirs: string[] = [];
  const containers: Alepha[] = [];

  afterEach(async () => {
    for (const container of containers.splice(0)) await container.stop();
    for (const dir of dirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  const call = async (
    server: Alepha,
    name: string,
    params: Record<string, unknown> = {},
  ): Promise<string> => {
    const tool = server.inject(McpServerProvider).getTool(name);
    if (!tool) throw new Error(`no tool ${name}`);
    return (await tool.execute(params)) as string;
  };

  const listed = async (root: string, runs: InspectorRun[]) => {
    const server = new DevMcpServer().create(root, { LOG_LEVEL: "error" }, [
      { provide: InspectorClient, use: ListedInspectorClient },
    ]);
    containers.push(server);
    await server.start();
    server.inject(ListedInspectorClient).listed = runs;
    return server;
  };

  describe("the server", () => {
    it("lists its tools and says how to use them", async ({ expect }) => {
      const server = await listed("/work/app", []);
      const mcp = server.inject(McpServerProvider);
      const names = mcp.getTools().map((tool) => tool.name);
      expect(names).toEqual(
        expect.arrayContaining(["apps_list", "app_select"]),
      );
      expect(mcp.instructions).toContain("apps_list");
      expect(mcp.serverInfo.name).toBe("alepha");
    });
  });

  describe("selection", () => {
    it("answers with alepha dev when no app runs, from every tool", async ({
      expect,
    }) => {
      const server = await listed("/work/app", []);
      expect(await call(server, "apps_list")).toMatch(/alepha dev/);
      expect(await call(server, "app_select", { app: "app" })).toMatch(
        /alepha dev/,
      );
      expect((await server.inject(DevMcpSession).target()).answer).toMatch(
        /No Alepha app is running/,
      );
    });

    it("selects the live run whose cwd contains the working directory", async ({
      expect,
    }) => {
      const server = await listed("/work/shop/src", [
        run({ runId: "a", name: "lore", cwd: "/work/lore" }),
        run({ runId: "b", name: "shop", cwd: "/work/shop" }),
      ]);
      expect((await server.inject(DevMcpSession).selected())?.runId).toBe("b");
      expect(await call(server, "apps_list")).toMatch(
        /\* shop - live[\s\S]*Selected: shop \(\/work\/shop\)/,
      );
    });

    it("prefers a cwd to a gitRoot, and the deepest cwd", async ({
      expect,
    }) => {
      const server = await listed("/repo/apps/web", [
        run({ runId: "root", cwd: "/repo", gitRoot: "/repo" }),
        run({ runId: "web", cwd: "/repo/apps/web", gitRoot: "/repo" }),
        run({ runId: "api", cwd: "/repo/apps/api", gitRoot: "/repo" }),
      ]);
      expect((await server.inject(DevMcpSession).selected())?.runId).toBe(
        "web",
      );
    });

    it("falls back to a run whose gitRoot contains the working directory", async ({
      expect,
    }) => {
      const server = await listed("/repo/packages/lib", [
        run({ runId: "api", cwd: "/repo/apps/api", gitRoot: "/repo" }),
        run({ runId: "other", cwd: "/elsewhere" }),
      ]);
      expect((await server.inject(DevMcpSession).selected())?.runId).toBe(
        "api",
      );
    });

    it("selects the only live run, else asks for app_select", async ({
      expect,
    }) => {
      const one = await listed("/home/me", [run({ runId: "only" })]);
      expect((await one.inject(DevMcpSession).selected())?.runId).toBe("only");

      const two = await listed("/home/me", [
        run({ runId: "a", cwd: "/a" }),
        run({ runId: "b", cwd: "/b" }),
      ]);
      expect(await two.inject(DevMcpSession).selected()).toBeUndefined();
      expect((await two.inject(DevMcpSession).target()).answer).toMatch(
        /app_select/,
      );
    });

    it("keeps a choice by cwd across a reload's new run id", async ({
      expect,
    }) => {
      const server = await listed("/home/me", [
        run({ runId: "a1", name: "api", cwd: "/a" }),
        run({ runId: "b1", name: "web", cwd: "/b" }),
      ]);
      expect(await call(server, "app_select", { app: "web" })).toMatch(
        /Selected web \(\/b\), run b1/,
      );

      // `alepha dev` reloaded: the entry is rewritten under a new run id.
      server.inject(ListedInspectorClient).listed = [
        run({ runId: "a1", name: "api", cwd: "/a" }),
        run({
          runId: "b2",
          name: "web",
          cwd: "/b",
          startedAt: "2026-11-08T10:00:05.000Z",
        }),
      ];
      expect((await server.inject(DevMcpSession).selected())?.runId).toBe("b2");
    });

    it("refuses an ambiguous or unknown name, naming what runs", async ({
      expect,
    }) => {
      const server = await listed("/home/me", [
        run({ runId: "a", name: "app", cwd: "/a" }),
        run({ runId: "b", name: "app", cwd: "/b" }),
      ]);
      expect(await call(server, "app_select", { app: "app" })).toMatch(
        /names 2 apps/,
      );
      expect(await call(server, "app_select", { app: "nope" })).toMatch(
        /No app matches "nope". Running: app \(\/a\), app \(\/b\)/,
      );
      expect(await call(server, "app_select", { app: "b" })).toMatch(
        /Selected app \(\/b\)/,
      );
    });

    it("keeps a dead run selectable for its logs, and says so elsewhere", async ({
      expect,
    }) => {
      const server = await listed("/a", [
        run({ runId: "gone", cwd: "/a", status: "dead" }),
      ]);
      expect(await call(server, "app_select", { app: "gone" })).toMatch(
        /is dead: only its logs are readable/,
      );
      const session = server.inject(DevMcpSession);
      expect((await session.target()).answer).toMatch(/is not running/);
      expect((await session.logTarget()).connection?.run.runId).toBe("gone");
    });

    it("answers with the client's message for another protocol version", async ({
      expect,
    }) => {
      const server = await listed("/a", [
        run({ cwd: "/a", protocol: INSPECTOR_PROTOCOL + 1 }),
      ]);
      expect((await server.inject(DevMcpSession).target()).answer).toMatch(
        /speaks inspector protocol/,
      );
    });
  });

  describe("over a real app", () => {
    it("lists a running app found through the run registry", async ({
      expect,
    }) => {
      const dir = mkdtempSync(join(tmpdir(), "mcp-"));
      dirs.push(dir);
      const env = { ALEPHA_RUN_DIR: join(dir, "run"), LOG_LEVEL: "error" };

      const app = Alepha.create({ env: { ...env, ALEPHA_INSPECT: "1" } })
        .with({ provide: FileSystemProvider, use: NodeFileSystemProvider })
        .with(AlephaInspector);
      containers.push(app);
      await app.start();

      const server = new DevMcpServer().create(process.cwd(), env, [
        { provide: FileSystemProvider, use: NodeFileSystemProvider },
      ]);
      containers.push(server);
      await server.start();

      const listing = await call(server, "apps_list");
      expect(listing).toContain(`* `);
      expect(listing).toContain(`- live - cwd ${process.cwd()}`);
      const target = await server.inject(DevMcpSession).target();
      expect((await target.connection?.call("metadata"))?.system.mode).toBe(
        "development",
      );
    });
  });
});
