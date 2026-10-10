import { describe, expect, it } from "bun:test";

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
    expect(await (await fetch(`${started.origin}/hello`)).text()).toBe(
      "hello from the worker",
    );
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
    await fetch(`${started.origin}/crash`);
    await Bun.sleep(300);

    expect(provider.terminated).toEqual([11]);
    const shutdown = await provider.stop();
    expect(shutdown.kind).toBe("crashed");
    if (shutdown.kind === "crashed")
      expect(shutdown.message).toContain("injected runtime crash");
  });
});
