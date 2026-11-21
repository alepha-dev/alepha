import { AlephaError } from "alepha";

import { DesktopProtocol } from "../../core/DesktopProtocol.ts";
import type { DesktopStartResult } from "../../core/DesktopSupervisor.ts";
import type { DesktopSupervisorEvent } from "../services/DesktopSupervisorWorker.ts";
import {
  type DesktopInit,
  type DesktopShutdown,
  SupervisorProvider,
} from "./SupervisorProvider.ts";

/**
 * {@link SupervisorProvider} on a real supervisor Worker running
 * `DesktopSupervisorWorker`, spawned from {@link supervisorUrl}.
 *
 * A crash message can arrive while the main thread is blocked in the window
 * loop: it is queued, and delivered once the loop returns, before the answer
 * to {@link stop}. So {@link stop} always learns about it.
 *
 * The supervisor Worker dying (a module that throws at load, an uncaught
 * error, an exit) fails a pending {@link start}, and makes {@link stop}
 * report a crash, so neither waits for an answer that never comes.
 */
export class WorkerSupervisorProvider extends SupervisorProvider {
  /**
   * The supervisor Worker's module URL. Set by the generated shell entry.
   */
  public supervisorUrl?: string;
  protected worker?: Worker;
  protected crashed?: string;
  protected exited?: string;
  protected readonly protocol = new DesktopProtocol();
  protected waiters: Array<(event: DesktopSupervisorEvent) => boolean> = [];

  public start(
    init: DesktopInit,
    workerUrl: string,
    logFile?: string,
  ): Promise<DesktopStartResult> {
    if (!this.supervisorUrl) {
      throw new AlephaError("WorkerSupervisorProvider needs a supervisorUrl.");
    }
    const worker = new Worker(this.supervisorUrl);
    this.worker = worker;
    worker.addEventListener("message", (event: MessageEvent) => {
      const data = event.data as DesktopSupervisorEvent;
      if (data.type === "crashed") {
        this.crashed = data.message;
      }
      this.waiters = this.waiters.filter((waiter) => !waiter(data));
    });
    worker.addEventListener("error", (event: ErrorEvent) => {
      event.preventDefault();
      this.onExit(
        `the supervisor failed: ${this.protocol.sanitize(event.error ?? event.message)}`,
      );
    });
    worker.addEventListener("close", (event: Event) =>
      this.onExit(
        `the supervisor exited (code ${(event as CloseEvent).code ?? "unknown"})`,
      ),
    );
    const started = this.next((event) =>
      event.type === "started" ? event.result : undefined,
    );
    worker.postMessage({ type: "start", init, workerUrl, logFile });
    return started;
  }

  public attachWindow(handle: number): void {
    this.worker?.postMessage({ type: "window", handle });
  }

  public async stop(): Promise<DesktopShutdown> {
    if (!this.worker) {
      return {
        kind: "stopped",
        graceful: false,
        message: "The server was never started.",
      };
    }
    if (this.exited) {
      return { kind: "crashed", message: this.crashed ?? this.exited };
    }
    const stopped = this.next((event) =>
      event.type === "stopped" ? event : undefined,
    );
    this.worker.postMessage({ type: "stop" });
    const event = await stopped;
    this.worker.terminate();
    if (this.crashed) {
      return { kind: "crashed", message: this.crashed };
    }
    return {
      kind: "stopped",
      graceful: event.result.graceful,
      message: event.result.message,
    };
  }

  /**
   * The supervisor Worker is gone: answer every waiter as a failure.
   */
  protected onExit(message: string): void {
    if (this.exited) {
      return;
    }
    this.exited = message;
    this.crashed ??= message;
    const failures: DesktopSupervisorEvent[] = [
      { type: "started", result: { ok: false, message } },
      { type: "stopped", result: { graceful: false, message } },
    ];
    for (const failure of failures) {
      this.waiters = this.waiters.filter((waiter) => !waiter(failure));
    }
  }

  protected next<T>(
    pick: (event: DesktopSupervisorEvent) => T | undefined,
  ): Promise<T> {
    return new Promise<T>((resolve) => {
      this.waiters.push((event) => {
        const value = pick(event);
        if (value === undefined) {
          return false;
        }
        resolve(value);
        return true;
      });
    });
  }
}
