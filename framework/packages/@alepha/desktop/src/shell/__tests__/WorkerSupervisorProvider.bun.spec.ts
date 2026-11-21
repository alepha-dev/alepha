import { describe, expect, it } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { login } from "../../worker/__tests__/fixtures/admission.ts";
import { WorkerSupervisorProvider } from "../providers/WorkerSupervisorProvider.ts";

const supervisorUrl = new URL("./fixtures/supervisor.ts", import.meta.url).href;
const workerUrl = new URL(
  "../../worker/__tests__/fixtures/bootstrap.ts",
  import.meta.url,
).href;

/**
 * Exposes the supervisor Worker, to watch the terminate requests.
 */
class TestSupervisorProvider extends WorkerSupervisorProvider {
  public terminated: number[] = [];
  public override start(
    ...args: Parameters<WorkerSupervisorProvider["start"]>
  ) {
    const started = super.start(...args);
    this.worker?.addEventListener("message", (event: MessageEvent) => {
      if (event.data?.type === "terminated")
        this.terminated.push(event.data.handle);
    });
    return started;
  }
}

const init = {
  name: "Fixture",
  identifier: "dev.alepha.fixture",
  capability: "ab".repeat(32),
  defaults: {
    APP_SECRET_FILE: join(
      mkdtempSync(join(tmpdir(), "alepha-desktop-")),
      "secret",
    ),
  },
  paths: {
    data: "/tmp/alepha-desktop-data",
    logs: "/tmp/alepha-desktop-logs",
    resources: "/tmp",
  },
  env: {
    NODE_ENV: "production",
    LOG_LEVEL: "silent",
    SERVER_HOST: "127.0.0.1",
    SERVER_PORT: "0",
    FIXTURE_MODE: "normal",
  },
};

describe("WorkerSupervisorProvider with real supervisor and server Workers", () => {
  it("starts the nested server Worker and stops it gracefully", async () => {
    const provider = new TestSupervisorProvider();
    provider.supervisorUrl = supervisorUrl;

    const started = await provider.start(init, workerUrl);
    expect(started.ok).toBe(true);
    if (!started.ok) return;
    const app = await login(started.origin, init.capability);
    expect(await (await app("/hello")).text()).toBe("hello from the worker");
    provider.attachWindow(11);

    expect(await provider.stop()).toEqual({
      kind: "stopped",
      graceful: true,
      message: undefined,
    });
    expect(provider.terminated).toEqual([]);
  });

  it("terminates the window loop from the supervisor thread when the server crashes, and reports the crash", async () => {
    const provider = new TestSupervisorProvider();
    provider.supervisorUrl = supervisorUrl;

    const started = await provider.start(init, workerUrl);
    if (!started.ok) throw new Error(started.message);
    provider.attachWindow(11);
    await (
      await login(started.origin, init.capability)
    )("/crash");
    await Bun.sleep(300);

    expect(provider.terminated).toEqual([11]);
    const shutdown = await provider.stop();
    expect(shutdown.kind).toBe("crashed");
    if (shutdown.kind === "crashed")
      expect(shutdown.message).toContain("injected runtime crash");
  });

  it("fails the start when the supervisor Worker throws at load", async () => {
    const provider = new WorkerSupervisorProvider();
    provider.supervisorUrl = new URL(
      "./fixtures/supervisor-throws.ts",
      import.meta.url,
    ).href;

    const started = await Promise.race([
      provider.start(init, workerUrl),
      Bun.sleep(3_000).then(() => "pending" as const),
    ]);

    expect(started).not.toBe("pending");
    if (started === "pending") return;
    expect(started.ok).toBe(false);
    if (!started.ok)
      expect(started.message).toContain("injected supervisor load failure");
  });

  it("reports a crash when the supervisor Worker dies with the window open", async () => {
    const provider = new WorkerSupervisorProvider();
    provider.supervisorUrl = new URL(
      "./fixtures/supervisor-dies.ts",
      import.meta.url,
    ).href;

    const started = await provider.start(init, workerUrl);
    expect(started.ok).toBe(true);
    provider.attachWindow(11);
    await Bun.sleep(300);

    const shutdown = await Promise.race([
      provider.stop(),
      Bun.sleep(3_000).then(() => "pending" as const),
    ]);
    expect(shutdown).not.toBe("pending");
    if (shutdown === "pending") return;
    expect(shutdown.kind).toBe("crashed");
    if (shutdown.kind === "crashed")
      expect(shutdown.message).toContain("injected supervisor crash");
  });
});
