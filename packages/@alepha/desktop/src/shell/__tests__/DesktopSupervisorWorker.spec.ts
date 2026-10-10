import { describe, it } from "vitest";

import type { DesktopWorkerLike } from "../../core/DesktopSupervisor.ts";
import {
  type DesktopSupervisorEvent,
  DesktopSupervisorWorker,
} from "../services/DesktopSupervisorWorker.ts";

class MemoryWorker implements DesktopWorkerLike {
  public sent: any[] = [];
  protected listeners: Record<string, Array<(event: any) => void>> = {};
  public postMessage(message: any): void {
    this.sent.push(message);
    if (message.type === "init") {
      queueMicrotask(() =>
        this.emit("message", {
          data: { type: "ready", version: 1, origin: "http://127.0.0.1:1" },
        }),
      );
    }
    if (message.type === "stop") {
      queueMicrotask(() => this.emit("message", { data: { type: "stopped" } }));
    }
  }
  public addEventListener(type: string, listener: (event: any) => void): void {
    (this.listeners[type] ??= []).push(listener);
  }
  public terminate(): void {}
  public emit(type: string, event: any): void {
    for (const listener of this.listeners[type] ?? []) listener(event);
  }
}

const setup = () => {
  const app = new MemoryWorker();
  const events: DesktopSupervisorEvent[] = [];
  const terminated: number[] = [];
  let send: (data: any) => void = () => {};
  new DesktopSupervisorWorker(
    {
      postMessage: (event) => events.push(event),
      addEventListener: (_type, listener) => {
        send = (data) => listener({ data });
      },
    },
    (handle) => terminated.push(handle),
    () => app,
  ).listen();
  const settle = () => new Promise((resolve) => setTimeout(resolve, 5));
  const init = {
    name: "F",
    identifier: "a.b",
    env: {},
    capability: "ab".repeat(32),
  };
  return { app, events, terminated, send, settle, init };
};

describe("DesktopSupervisorWorker", () => {
  it("rotates the log file periodically while the app runs", async ({
    expect,
  }) => {
    const rotated: string[] = [];
    let send: (data: any) => void = () => {};
    const worker = new DesktopSupervisorWorker(
      {
        postMessage: () => {},
        addEventListener: (_type, listener) =>
          (send = (data) => listener({ data })),
      },
      () => {},
      () => new MemoryWorker(),
      async (file) => void rotated.push(file),
    );
    worker.rotateEveryMs = 5;
    worker.listen();

    send({
      type: "start",
      workerUrl: "w",
      logFile: "/logs/app.log",
      init: {
        name: "F",
        identifier: "a.b",
        env: {},
        defaults: {},
        paths: { data: "/d", logs: "/l", resources: "/r" },
        capability: "ab".repeat(32),
      },
    });
    await new Promise((resolve) => setTimeout(resolve, 30));

    expect(rotated.length).toBeGreaterThan(1);
    expect(new Set(rotated)).toEqual(new Set(["/logs/app.log"]));
  });

  it("relays a start and a graceful stop", async ({ expect }) => {
    const { events, terminated, send, settle, init } = setup();

    send({ type: "start", init, workerUrl: "w" });
    await settle();
    send({ type: "window", handle: 7 });
    send({ type: "stop" });
    await settle();

    expect(events).toEqual([
      { type: "started", result: { ok: true, origin: "http://127.0.0.1:1" } },
      { type: "stopped", result: { graceful: true } },
    ]);
    expect(terminated).toEqual([]);
  });

  it("terminates the window loop when the server dies while the window is open", async ({
    expect,
  }) => {
    const { app, events, terminated, send, settle, init } = setup();

    send({ type: "start", init, workerUrl: "w" });
    await settle();
    send({ type: "window", handle: 7 });
    app.emit("close", { code: 9 });
    send({ type: "stop" });
    await settle();

    expect(terminated).toEqual([7]);
    expect(events.slice(1)).toEqual([
      { type: "crashed", message: "the server Worker exited (code 9)" },
      {
        type: "stopped",
        result: {
          graceful: false,
          message: "the server Worker exited (code 9)",
        },
      },
    ]);
  });

  it("terminates the loop as soon as the handle arrives when the crash came first", async ({
    expect,
  }) => {
    const { app, terminated, send, settle, init } = setup();

    send({ type: "start", init, workerUrl: "w" });
    await settle();
    app.emit("error", { message: "AlephaError: boom" });
    expect(terminated).toEqual([]);
    send({ type: "window", handle: 9 });

    expect(terminated).toEqual([9]);
  });
});
