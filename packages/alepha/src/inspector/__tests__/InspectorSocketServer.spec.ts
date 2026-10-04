import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { request as httpRequest } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { $atom, Alepha, z } from "alepha";
import { FileSystemProvider } from "alepha/system";
import { afterEach, describe, it } from "vitest";

import { AlephaInspector } from "../index.ts";
import { InspectorRunProvider } from "../providers/InspectorRunProvider.ts";
import { InspectorSocketServer } from "../providers/InspectorSocketServer.ts";
import { InspectorRegistry } from "../services/InspectorRegistry.ts";

/**
 * One HTTP request over a Unix socket, the way any tool talks to the
 * inspector.
 */
const call = (
  socketPath: string,
  method: string,
  path: string,
  body?: unknown,
): Promise<{ status: number; body: any }> =>
  new Promise((resolve, reject) => {
    const req = httpRequest({ socketPath, method, path }, (res) => {
      let data = "";
      res.setEncoding("utf8");
      res.on("data", (chunk) => {
        data += chunk;
      });
      res.on("end", () =>
        resolve({
          status: res.statusCode ?? 0,
          body: data ? JSON.parse(data) : undefined,
        }),
      );
    });
    req.on("error", reject);
    if (body !== undefined) {
      req.write(typeof body === "string" ? body : JSON.stringify(body));
    }
    req.end();
  });

const settingsAtom = $atom({
  name: "test.inspector.socket.settings",
  schema: z.object({ theme: z.string() }),
  default: { theme: "light" },
});

class Win32SocketServer extends InspectorSocketServer {
  protected override readonly platform = "win32" as const;
}

describe("InspectorSocketServer", () => {
  const dirs: string[] = [];

  afterEach(() => {
    for (const dir of dirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  const runDir = () => {
    // Short on purpose: a socket path has a ~104-byte ceiling.
    const dir = mkdtempSync(join(tmpdir(), "ai-"));
    dirs.push(dir);
    return join(dir, "run");
  };

  const create = (dir: string) =>
    Alepha.create({
      env: { ALEPHA_INSPECT: "1", ALEPHA_RUN_DIR: dir },
    }).with(AlephaInspector);

  it("serves the route table over <runId>.sock, mode 0600 in a 0700 directory", async ({
    expect,
  }) => {
    const dir = runDir();
    const alepha = create(dir);
    await alepha.start();

    const run = alepha.inject(InspectorRunProvider);
    const socket = alepha.inject(InspectorSocketServer);
    expect(socket.path).toBe(join(dir, `${run.runId}.sock`));

    expect(statSync(socket.path!).isSocket()).toBe(true);
    expect(statSync(socket.path!).mode & 0o777).toBe(0o600);
    expect(statSync(dir).mode & 0o777).toBe(0o700);

    const logs = await call(socket.path!, "GET", "/logs?limit=1");
    expect(logs.status).toBe(200);
    expect(logs.body).toMatchObject({ hasMore: expect.any(Boolean) });

    await alepha.stop();
  });

  it("validates the request and answers with the dispatcher's status", async ({
    expect,
  }) => {
    const alepha = create(runDir());
    await alepha.start();
    alepha.store.get(settingsAtom);
    const path = alepha.inject(InspectorSocketServer).path!;

    expect((await call(path, "GET", "/nope")).status).toBe(404);
    expect((await call(path, "POST", "/atoms", { value: 1 })).status).toBe(400);
    expect((await call(path, "POST", "/atoms", "{not json")).status).toBe(400);

    const saved = await call(path, "POST", "/atoms", {
      name: settingsAtom.key,
      value: { theme: "dark" },
    });
    expect(saved).toEqual({ status: 200, body: { success: true } });
    expect(alepha.store.get(settingsAtom)).toEqual({ theme: "dark" });

    await alepha.stop();
  });

  it("is what discover() counts as alive, and is gone with its entry on stop", async ({
    expect,
  }) => {
    const dir = runDir();
    const alepha = create(dir);
    await alepha.start();

    const run = alepha.inject(InspectorRunProvider);
    const socketPath = alepha.inject(InspectorSocketServer).path!;
    const registry = alepha.inject(InspectorRegistry);

    const live = await registry.discover();
    expect(live.map((r) => r.runId)).toEqual([run.runId]);
    expect(live[0].socketPath).toBe(socketPath);

    await alepha.stop();

    expect(() => statSync(socketPath)).toThrow();
    expect(await registry.list()).toEqual([]);
  });

  it("counts a run dead when nothing listens on its socket, whatever its pid", async ({
    expect,
  }) => {
    const dir = runDir();
    const alepha = create(dir);
    await alepha.start();
    const run = alepha.inject(InspectorRunProvider);
    const entry = await run.entry();

    // Our own pid, which is alive, and a socket file nobody listens on: a
    // reused pid. And a socket-less entry with a foreign pid: a container's
    // pid 1 that the host cannot see either way.
    // The entries go through the container's file system (the memory one
    // under test); a socket is always a real file.
    const fs = alepha.inject(FileSystemProvider);
    writeFileSync(join(dir, "stale.sock"), "");
    await fs.writeFile(
      join(dir, "reused00.json"),
      JSON.stringify({ ...entry, runId: "reused00", socket: "stale.sock" }),
    );
    await fs.writeFile(
      join(dir, "contain0.json"),
      JSON.stringify({
        ...entry,
        runId: "contain0",
        pid: 1,
        socket: "none.sock",
      }),
    );

    const live = await alepha.inject(InspectorRegistry).discover();
    expect(live.map((r) => r.runId)).toEqual([run.runId]);

    await alepha.stop();
  });

  it("replaces a stale socket file left at its path", async ({ expect }) => {
    const dir = runDir();
    const alepha = create(dir);
    const run = alepha.inject(InspectorRunProvider);

    mkdirSync(dir, { recursive: true, mode: 0o700 });
    writeFileSync(join(dir, `${run.runId}.sock`), "left behind");

    await alepha.start();

    const path = alepha.inject(InspectorSocketServer).path!;
    expect(statSync(path).isSocket()).toBe(true);
    expect((await call(path, "GET", "/logs?limit=1")).status).toBe(200);

    await alepha.stop();
  });

  it("refuses a socket path over the platform limit, and announces nothing", async ({
    expect,
  }) => {
    const dir = join(runDir(), "x".repeat(120));
    const alepha = create(dir);
    await alepha.start();

    expect(alepha.inject(InspectorSocketServer).listening).toBe(false);
    expect(alepha.inject(InspectorRunProvider).file).toBeUndefined();

    await alepha.stop();
  });

  it("skips itself on Windows, and announces nothing", async ({ expect }) => {
    const alepha = Alepha.create({
      env: { ALEPHA_INSPECT: "1", ALEPHA_RUN_DIR: runDir() },
    })
      .with({ provide: InspectorSocketServer, use: Win32SocketServer })
      .with(AlephaInspector);
    await alepha.start();

    expect(alepha.inject(InspectorSocketServer).listening).toBe(false);
    expect(alepha.inject(InspectorRunProvider).file).toBeUndefined();

    await alepha.stop();
  });

  it("never opens a socket under test without an explicit ALEPHA_RUN_DIR", async ({
    expect,
  }) => {
    const alepha = Alepha.create({ env: { ALEPHA_INSPECT: "1" } }).with(
      AlephaInspector,
    );
    await alepha.start();

    expect(alepha.inject(InspectorSocketServer).listening).toBe(false);
    expect(alepha.inject(InspectorRunProvider).file).toBeUndefined();

    await alepha.stop();
  });
});
