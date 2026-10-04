import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type IncomingHttpHeaders } from "node:http";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import { Alepha } from "alepha";
import { AlephaInspector, InspectorRunProvider } from "alepha/inspector";
import { $route, AlephaServer, ServerProvider } from "alepha/server";
import { FileSystemProvider, NodeFileSystemProvider } from "alepha/system";
import { afterEach, describe, it } from "vitest";

import { AlephaDevtoolsServer } from "../server/index.ts";
import { GitStateProvider } from "../server/providers/GitStateProvider.ts";
import { EditorLauncher } from "../server/services/EditorLauncher.ts";

/**
 * Records what would be opened instead of opening it.
 */
class TestEditorLauncher extends EditorLauncher {
  public opened: Array<[string, number, number]> = [];

  public override async open(
    file: string,
    line: number,
    column = 1,
  ): Promise<string> {
    this.opened.push([file, line, column]);
    return "test-editor";
  }
}

/**
 * A route of the inspected app itself, for Try It.
 */
class Hello {
  public readonly hello = $route({
    method: "GET",
    path: "/hello",
    handler: () => "hi",
  });
}

describe("the devtools server", () => {
  const cleanups: Array<() => Promise<void> | void> = [];

  afterEach(async () => {
    for (const cleanup of cleanups.splice(0).toReversed()) await cleanup();
  });

  /**
   * A real inspected app and the devtools server, sharing a run directory.
   */
  const setup = async () => {
    const root = mkdtempSync(join(tmpdir(), "ad-"));
    cleanups.push(() => rmSync(root, { recursive: true, force: true }));
    const runDir = join(root, "run");

    const app = Alepha.create({
      env: { ALEPHA_INSPECT: "1", ALEPHA_RUN_DIR: runDir, SERVER_PORT: 0 },
    })
      .with({ provide: FileSystemProvider, use: NodeFileSystemProvider })
      .with(AlephaServer)
      .with(AlephaInspector)
      .with(Hello);
    await app.start();
    cleanups.push(() => app.stop());

    const devtools = Alepha.create({
      env: { ALEPHA_RUN_DIR: runDir, SERVER_PORT: 0 },
    })
      .with({ provide: FileSystemProvider, use: NodeFileSystemProvider })
      .with({ provide: EditorLauncher, use: TestEditorLauncher })
      .with(AlephaDevtoolsServer);
    await devtools.start();
    cleanups.push(() => devtools.stop());

    const base = devtools.inject(ServerProvider).hostname;
    const runId = app.inject(InspectorRunProvider).runId;
    return { app, devtools, base, runId, runDir, root };
  };

  it("lists the running apps", async ({ expect }) => {
    const { base, runId } = await setup();

    const res = await fetch(`${base}/runs`);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.runs.map((r: any) => [r.runId, r.status])).toEqual([
      [runId, "live"],
    ]);
  });

  it("proxies /apps/:runId/api/* to the run's socket, both ways", async ({
    expect,
  }) => {
    const { base, runId } = await setup();

    const logs = await fetch(`${base}/apps/${runId}/api/logs?limit=1`);
    expect(logs.status).toBe(200);
    expect(await logs.json()).toMatchObject({ hasMore: expect.any(Boolean) });

    const write = await fetch(`${base}/apps/${runId}/api/atoms`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "nope", value: 1 }),
    });
    expect(write.status).toBe(200);
    expect(await write.json()).toEqual({
      success: false,
      message: 'Unknown atom "nope"',
    });

    // The run's own status codes come back as they are.
    const invalid = await fetch(`${base}/apps/${runId}/api/atoms`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ value: 1 }),
    });
    expect(invalid.status).toBe(400);
  });

  it("refuses an unknown run, and a run id that is not one", async ({
    expect,
  }) => {
    const { base } = await setup();

    expect((await fetch(`${base}/apps/zzzzzzzz/api/metadata`)).status).toBe(
      404,
    );
    // Encoded traversal never reaches a path.
    expect(
      (await fetch(`${base}/apps/..%2f..%2fetc/api/metadata`)).status,
    ).toBe(404);
  });

  it("forwards no header to the run, cookies least of all", async ({
    expect,
  }) => {
    const { base, runDir, app } = await setup();

    // A run that echoes what reaches it.
    let received: IncomingHttpHeaders | undefined;
    const socketPath = join(runDir, "echo0000.sock");
    const echo = createServer((req, res) => {
      received = req.headers;
      res.writeHead(200, { "content-type": "application/json" });
      res.end("{}");
    });
    await new Promise<void>((resolve) => echo.listen(socketPath, resolve));
    cleanups.push(() => new Promise<void>((r) => echo.close(() => r())));
    const entry = await app.inject(InspectorRunProvider).entry();
    writeFileSync(
      join(runDir, "echo0000.json"),
      JSON.stringify({ ...entry, runId: "echo0000", socket: "echo0000.sock" }),
    );

    await fetch(`${base}/apps/echo0000/api/metadata`, {
      headers: {
        cookie: "tokens=secret-session",
        authorization: "Bearer secret",
        "x-custom": "1",
      },
    });

    expect(received).toBeDefined();
    expect(received?.cookie).toBeUndefined();
    expect(received?.authorization).toBeUndefined();
    expect(received?.["x-custom"]).toBeUndefined();
  });

  it("serves a dead run's logs from its file, and nothing else", async ({
    expect,
  }) => {
    const { base, runDir, root, app } = await setup();

    const logFile = join(root, "dead.jsonl");
    writeFileSync(
      logFile,
      `${JSON.stringify({ level: "ERROR", message: "crashed", service: "s", module: "m", timestamp: 1 })}\n`,
    );
    const entry = await app.inject(InspectorRunProvider).entry();
    mkdirSync(runDir, { recursive: true });
    writeFileSync(
      join(runDir, "dead0000.json"),
      JSON.stringify({
        ...entry,
        runId: "dead0000",
        cwd: "/apps/dead",
        socket: "dead0000.sock",
        logFile,
      }),
    );

    const logs = await fetch(`${base}/apps/dead0000/api/logs`);
    expect(logs.status).toBe(200);
    expect((await logs.json()).logs.map((l: any) => l.message)).toEqual([
      "crashed",
    ]);

    expect((await fetch(`${base}/apps/dead0000/api/metadata`)).status).toBe(
      410,
    );
  });

  it("forwards Try It to the run's own HTTP port, without cookies", async ({
    expect,
  }) => {
    const { base, runId } = await setup();

    const res = await fetch(`${base}/apps/${runId}/http/hello`, {
      headers: { cookie: "tokens=secret-session" },
    });

    expect(res.status).toBe(200);
    expect(await res.text()).toBe("hi");
  });

  it("reports the worktree's git state with the runs, once refreshed", async ({
    expect,
  }) => {
    const { app, devtools, base } = await setup();
    const gitRoot = (await app.inject(InspectorRunProvider).entry()).gitRoot;

    await fetch(`${base}/runs`);
    await devtools.inject(GitStateProvider).refresh();
    const body = await (await fetch(`${base}/runs`)).json();

    // The spec runs inside this repository's checkout.
    expect(gitRoot).toBeDefined();
    expect(body.worktrees[gitRoot!]).toMatchObject({
      worktree: gitRoot,
      branch: expect.any(String),
      dirty: expect.any(Number),
    });
  });

  it("opens the app's own files in the editor, and nothing else", async ({
    expect,
  }) => {
    const { devtools, base, runId } = await setup();
    const editor = devtools.inject(TestEditorLauncher);
    const open = (file: string) =>
      fetch(`${base}/apps/${runId}/editor`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ file, line: 3, column: 1 }),
      });

    // The app's cwd is the test process's: a file under it opens.
    const own = fileURLToPath(new URL("../bin.ts", import.meta.url));
    expect((await open(own)).status).toBe(200);
    expect(editor.opened).toEqual([[own, 3, 1]]);

    // A relative path resolves against the app's directory.
    expect((await open(relative(process.cwd(), own))).status).toBe(200);

    // Outside the app, or a dependency inside it: refused, nothing opened.
    expect((await open("/etc/hosts")).status).toBe(400);
    expect((await open("../../../package.json")).status).toBe(400);
    expect(
      (await open(`${process.cwd()}/node_modules/alepha/package.json`)).status,
    ).toBe(400);
    expect((await open("src/missing.ts")).status).toBe(404);
    expect(editor.opened).toHaveLength(2);
  });
});
