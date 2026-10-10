import { DesktopProtocol } from "./DesktopProtocol.ts";
import type { DesktopShellMessage } from "./schemas/desktopShellMessageSchema.ts";
import type { DesktopWorkerMessage } from "./schemas/desktopWorkerMessageSchema.ts";

/**
 * The part of a Bun `Worker` the supervisor uses.
 */
export interface DesktopWorkerLike {
  postMessage(message: DesktopShellMessage): void;
  addEventListener(type: "message", listener: (event: any) => void): void;
  addEventListener(type: "error", listener: (event: any) => void): void;
  addEventListener(type: "close", listener: (event: any) => void): void;
  terminate(): void;
}

/**
 * How a supervised start ended.
 */
export type DesktopStartResult =
  | { ok: true; origin: string }
  | { ok: false; message: string };

/**
 * How a supervised stop ended. `graceful` is true only when the Worker
 * answered `stopped`: a terminated Worker never counts as a graceful stop.
 */
export interface DesktopStopResult {
  graceful: boolean;
  message?: string;
}

/**
 * Drives the Worker hosting the app, with the protocol's deadlines.
 *
 * - {@link start} sends `init` and resolves on `ready`, or on `failed`, an
 *   early exit, an uncaught error, or {@link DesktopProtocol.readyTimeoutMs}
 *   elapsing (the Worker is then terminated);
 * - after `ready`, an uncaught error or an exit nobody asked for is a crash,
 *   reported once to {@link onCrash};
 * - {@link stop} sends `stop` and resolves on `stopped`, or terminates the
 *   Worker after {@link DesktopProtocol.stopTimeoutMs} and says so.
 *
 * ⚠️ **Run it where an event loop turns.** While the window's native loop
 * blocks the main thread, Worker events queued there are not delivered. The
 * shell runs this inside a supervisor Worker of its own, which owns the app
 * Worker and can unblock the window from its thread.
 */
export class DesktopSupervisor {
  protected readonly protocol = new DesktopProtocol();
  protected phase: "idle" | "starting" | "ready" | "stopping" | "done" = "idle";
  protected crashListeners: Array<(message: string) => void> = [];
  protected settleStart?: (result: DesktopStartResult) => void;
  protected settleStop?: (result: DesktopStopResult) => void;

  protected readonly worker: DesktopWorkerLike;
  protected readonly deadlines: {
    readyTimeoutMs?: number;
    stopTimeoutMs?: number;
  };

  constructor(
    worker: DesktopWorkerLike,
    deadlines: { readyTimeoutMs?: number; stopTimeoutMs?: number } = {},
  ) {
    this.worker = worker;
    this.deadlines = deadlines;
    worker.addEventListener("message", (event) => this.onMessage(event.data));
    worker.addEventListener("error", (event) => {
      event?.preventDefault?.();
      this.onExit(
        `uncaught error: ${this.protocol.sanitize(event?.message ?? event?.error ?? event)}`,
      );
    });
    worker.addEventListener("close", (event) =>
      this.onExit(
        `the server Worker exited (code ${event?.code ?? "unknown"})`,
      ),
    );
  }

  /**
   * Called once if the app dies after it was ready, while nobody asked it to
   * stop.
   */
  public onCrash(listener: (message: string) => void): void {
    this.crashListeners.push(listener);
  }

  /**
   * Send `init` and wait for the app to be ready.
   */
  public start(
    init: Omit<
      Extract<DesktopShellMessage, { type: "init" }>,
      "type" | "version"
    >,
  ): Promise<DesktopStartResult> {
    if (this.phase !== "idle") {
      return Promise.resolve({
        ok: false,
        message: "start() was called twice.",
      });
    }
    this.phase = "starting";
    const timeout =
      this.deadlines.readyTimeoutMs ?? this.protocol.readyTimeoutMs;
    return new Promise<DesktopStartResult>((resolve) => {
      const timer = setTimeout(() => {
        this.phase = "done";
        this.worker.terminate();
        settle({
          ok: false,
          message: `The app did not become ready within ${Math.round(timeout / 1000)} seconds.`,
        });
      }, timeout);
      const settle = (result: DesktopStartResult) => {
        clearTimeout(timer);
        this.settleStart = undefined;
        resolve(result);
      };
      this.settleStart = settle;
      this.worker.postMessage({ type: "init", version: 1, ...init });
    });
  }

  /**
   * Ask the app to stop, and wait for its stop hooks.
   */
  public stop(): Promise<DesktopStopResult> {
    if (this.phase === "done") {
      return Promise.resolve({
        graceful: false,
        message: "The server Worker was already gone.",
      });
    }
    if (this.phase === "stopping") {
      return Promise.resolve({
        graceful: false,
        message: "stop() was called twice.",
      });
    }
    this.phase = "stopping";
    const timeout = this.deadlines.stopTimeoutMs ?? this.protocol.stopTimeoutMs;
    return new Promise<DesktopStopResult>((resolve) => {
      const timer = setTimeout(() => {
        this.phase = "done";
        this.worker.terminate();
        settle({
          graceful: false,
          message: `The app did not stop within ${Math.round(timeout / 1000)} seconds and was terminated.`,
        });
      }, timeout);
      const settle = (result: DesktopStopResult) => {
        clearTimeout(timer);
        this.settleStop = undefined;
        resolve(result);
      };
      this.settleStop = settle;
      this.worker.postMessage({ type: "stop" });
    });
  }

  protected onMessage(data: unknown): void {
    const message = this.protocol.parseWorkerMessage(data);
    if (!message) {
      this.fail(
        "The server Worker sent a message the shell does not understand.",
      );
      return;
    }
    this.handle(message);
  }

  protected handle(message: DesktopWorkerMessage): void {
    if (message.type === "ready") {
      if (this.phase === "starting") {
        this.phase = "ready";
        this.settleStart?.({ ok: true, origin: message.origin });
      }
      return;
    }
    if (message.type === "stopped") {
      if (this.phase === "stopping") {
        this.phase = "done";
        this.worker.terminate();
        this.settleStop?.({ graceful: true });
      }
      return;
    }
    this.fail(message.message);
  }

  protected fail(message: string): void {
    if (this.phase === "starting") {
      this.phase = "done";
      this.worker.terminate();
      this.settleStart?.({ ok: false, message });
      return;
    }
    if (this.phase === "stopping") {
      this.phase = "done";
      this.worker.terminate();
      this.settleStop?.({ graceful: false, message });
      return;
    }
    if (this.phase === "ready") {
      this.phase = "done";
      this.worker.terminate();
      for (const listener of this.crashListeners) {
        listener(message);
      }
    }
  }

  protected onExit(message: string): void {
    if (this.phase === "done") {
      return;
    }
    this.fail(message);
  }
}
