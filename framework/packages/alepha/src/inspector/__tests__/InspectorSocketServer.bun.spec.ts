import { afterEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Alepha } from "alepha";

import { AlephaInspector } from "../index.ts";
import { InspectorSocketServer } from "../providers/InspectorSocketServer.ts";
import { InspectorRegistry } from "../services/InspectorRegistry.ts";

// -------------------------------------------------------------------------------------------------------------------

describe("InspectorSocketServer on Bun", () => {
  const dirs: string[] = [];

  afterEach(() => {
    for (const dir of dirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("serves the route table over the socket, and discover() sees it", async () => {
    const dir = mkdtempSync(join(tmpdir(), "ai-"));
    dirs.push(dir);

    const alepha = Alepha.create({
      env: {
        NODE_ENV: "test",
        ALEPHA_INSPECT: "1",
        ALEPHA_RUN_DIR: join(dir, "run"),
      },
    }).with(AlephaInspector);
    await alepha.start();

    const path = alepha.inject(InspectorSocketServer).path;
    expect(path).toBeDefined();
    expect(statSync(path!).mode & 0o777).toBe(0o600);

    const res = await fetch("http://inspector/logs?limit=1", {
      unix: path,
    } as RequestInit);
    expect(res.status).toBe(200);
    expect(((await res.json()) as { hasMore: unknown }).hasMore).toBeBoolean();

    const live = await alepha.inject(InspectorRegistry).discover();
    expect(live.map((run) => run.socketPath)).toEqual([path!]);

    await alepha.stop();
    expect(() => statSync(path!)).toThrow();
  });
});
