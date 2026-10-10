import { describe, it } from "vitest";

import {
  type DesktopWorkerLike,
  DesktopSupervisor,
} from "../DesktopSupervisor.ts";

/**
 * A Worker the spec answers for, by hand.
 */
class MemoryWorker implements DesktopWorkerLike {
  public sent: unknown[] = [];
  public terminated = 0;
  protected listeners: Record<string, Array<(event: any) => void>> = {};

  public postMessage(message: unknown): void {
    this.sent.push(message);
  }

  public addEventListener(type: string, listener: (event: any) => void): void {
    (this.listeners[type] ??= []).push(listener);
  }

  public terminate(): void {
    this.terminated += 1;
  }

  public emit(type: string, event: any): void {
    for (const listener of this.listeners[type] ?? []) listener(event);
  }
}

const init = {
  name: "Fixture",
  identifier: "dev.alepha.fixture",
  env: {},
  capability: "ab".repeat(32),
};

describe("DesktopSupervisor", () => {
  it("sends init and resolves on ready", async ({ expect }) => {
    const worker = new MemoryWorker();
    const supervisor = new DesktopSupervisor(worker);

    const started = supervisor.start(init);
    expect(worker.sent).toEqual([{ type: "init", version: 1, ...init }]);
    worker.emit("message", {
      data: { type: "ready", version: 1, origin: "http://127.0.0.1:4000" },
    });

    expect(await started).toEqual({
      ok: true,
      origin: "http://127.0.0.1:4000",
    });
  });

  it("treats an early exit, a failed message and a malformed message as a failed start", async ({
    expect,
  }) => {
    for (const event of [
      ["close", { code: 1 }],
      [
        "message",
        { data: { type: "failed", phase: "start", message: "boom" } },
      ],
      [
        "message",
        { data: { type: "ready", version: 1, origin: "http://0.0.0.0:1" } },
      ],
    ] as const) {
      const worker = new MemoryWorker();
      const started = new DesktopSupervisor(worker).start(init);
      worker.emit(event[0], event[1]);
      const result = await started;
      expect(result.ok).toBe(false);
      expect(worker.terminated).toBe(1);
    }
  });

  it("terminates a Worker that misses the readiness deadline", async ({
    expect,
  }) => {
    const worker = new MemoryWorker();
    const started = new DesktopSupervisor(worker, { readyTimeoutMs: 20 }).start(
      init,
    );

    expect(await started).toEqual({
      ok: false,
      message: "The app did not become ready within 0 seconds.",
    });
    expect(worker.terminated).toBe(1);
  });

  it("calls a stop graceful only on stopped, never on a close", async ({
    expect,
  }) => {
    const graceful = new MemoryWorker();
    const a = new DesktopSupervisor(graceful);
    const aStart = a.start(init);
    graceful.emit("message", {
      data: { type: "ready", version: 1, origin: "http://127.0.0.1:1" },
    });
    await aStart;
    const aStop = a.stop();
    graceful.emit("message", { data: { type: "stopped" } });
    expect(await aStop).toEqual({ graceful: true });

    const closed = new MemoryWorker();
    const b = new DesktopSupervisor(closed);
    const bStart = b.start(init);
    closed.emit("message", {
      data: { type: "ready", version: 1, origin: "http://127.0.0.1:1" },
    });
    await bStart;
    const bStop = b.stop();
    closed.emit("close", { code: 0 });
    expect((await bStop).graceful).toBe(false);
  });

  it("terminates after the stop deadline and reports it as not graceful", async ({
    expect,
  }) => {
    const worker = new MemoryWorker();
    const supervisor = new DesktopSupervisor(worker, { stopTimeoutMs: 20 });
    const started = supervisor.start(init);
    worker.emit("message", {
      data: { type: "ready", version: 1, origin: "http://127.0.0.1:1" },
    });
    await started;

    const stopped = await supervisor.stop();
    expect(stopped.graceful).toBe(false);
    expect(worker.terminated).toBe(1);
  });

  it("reports a crash after readiness exactly once, and not a requested stop", async ({
    expect,
  }) => {
    const worker = new MemoryWorker();
    const supervisor = new DesktopSupervisor(worker);
    const crashes: string[] = [];
    supervisor.onCrash((message) => crashes.push(message));
    const started = supervisor.start(init);
    worker.emit("message", {
      data: { type: "ready", version: 1, origin: "http://127.0.0.1:1" },
    });
    await started;

    worker.emit("error", { message: "AlephaError: gone\n at x" });
    worker.emit("close", { code: 1 });

    expect(crashes).toEqual(["uncaught error: gone"]);
  });
});
