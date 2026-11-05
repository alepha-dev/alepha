import { $hook, $inject, Alepha } from "alepha";

import { LogDestinationProvider } from "./LogDestinationProvider.ts";

/**
 * Writes log lines to the console: stdout by default, stderr when the
 * container's store says `alepha.logger.stream` is `"stderr"`.
 *
 * ## Why the stream is read from the store, at write time
 *
 * A CLI's log lines are diagnostics, and its stdout is data: `alepha --version`,
 * help, a rendered result that a script pipes into `jq`. Sharing one stream
 * meant `cmd | jq` broke on the first warning, and a failure wrote its reason
 * where the data goes. So `CliProvider` moves its own container's logs to
 * stderr.
 *
 * It cannot do that by substituting this provider. The destination is chosen
 * once, in `AlephaLogger`'s `register`, bound `optional: true`, and the logger
 * is injected right there, so a substitution from a command module arrives
 * after the resolution it would have to change. The store is read live
 * instead, the way `alepha.logger.level` and `alepha.logger.format` already
 * are for `--verbose`.
 *
 * The store belongs to ONE container. An application container a command
 * boots in the same process (`alepha dev` does) keeps writing to stdout,
 * because an application's logs are its output wherever it runs.
 */
export class ConsoleDestinationProvider extends LogDestinationProvider {
  protected readonly alepha = $inject(Alepha);

  /**
   * Lines waiting for the end of the current event-loop turn.
   *
   * ## Why a production server batches its stdout lines
   *
   * Each `console.log` is a synchronous write syscall, and a request logs a
   * line or more: on a hello-world `$action` the write was the largest single
   * cost, ahead of routing, validation and serialization. Joining the lines of
   * one turn into one write answered 27% more requests a second.
   *
   * The lines keep their order and their content; only the number of writes
   * changes. The cost is the window: a line logged in the turn a process is
   * killed with SIGKILL is lost. `process.exit()`, an uncaught exception and
   * Alepha's own stop all flush first.
   *
   * Only in production, on a runtime with a process (Node, Bun). In
   * development a `console.log` of the user's own must stay in order with the
   * logger's lines, and a test reads the console right after logging. On
   * workerd, Vercel and in the browser each `console.log` is one log record
   * (Cloudflare's observability parses one JSON object per call), so joining
   * them would merge records.
   *
   * Static: two containers in one process (`alepha dev` runs a command's and
   * the application's) write to the same stdout, and one buffer keeps their
   * lines in the order they were logged.
   */
  protected static pending: string[] = [];
  protected static pendingBytes = 0;
  protected static flushScheduled = false;
  protected static exitHookInstalled = false;

  /**
   * The destination whose `writeStdout` writes the batch: the last one to
   * queue a line. Every destination of a process writes the same stdout.
   */
  protected static writer?: ConsoleDestinationProvider;

  /**
   * Past this many bytes in one turn the lines are written at once, so a
   * burst of logging neither holds memory nor delays its output.
   */
  protected static readonly MAX_PENDING_BYTES = 64 * 1024;

  /**
   * Writes the lines held for the current turn. An arrow, since it is handed
   * to `setImmediate` and `process.once` as it is.
   */
  protected static readonly flushPending = (): void => {
    const self = ConsoleDestinationProvider;
    self.flushScheduled = false;
    if (self.pending.length === 0) {
      return;
    }
    const lines = self.pending;
    self.pending = [];
    self.pendingBytes = 0;
    const text = lines.length === 1 ? lines[0] : lines.join("\n");
    if (self.writer) {
      self.writer.writeStdout(text);
    } else {
      console.log(text);
    }
  };

  protected batching?: boolean;

  public write(message: string): void {
    if (this.alepha.store.get("alepha.logger.stream") === "stderr") {
      // Unbatched, and after what stdout holds, so the two streams stay in
      // the order the lines were logged.
      this.flush();
      this.writeStderr(message);
      return;
    }
    if (!this.shouldBatch()) {
      this.writeStdout(message);
      return;
    }
    const self = ConsoleDestinationProvider;
    self.writer = this;
    self.pending.push(message);
    self.pendingBytes += message.length;
    if (self.pendingBytes >= self.MAX_PENDING_BYTES) {
      self.flushPending();
      return;
    }
    if (!self.flushScheduled) {
      self.flushScheduled = true;
      setImmediate(self.flushPending);
    }
  }

  /**
   * Writes the lines held for the current turn, now.
   */
  public flush(): void {
    ConsoleDestinationProvider.flushPending();
  }

  protected shouldBatch(): boolean {
    if (this.batching === undefined) {
      const proc = (globalThis as { process?: { on?: unknown } }).process;
      this.batching =
        this.alepha.isProduction() &&
        !this.alepha.isServerless() &&
        !this.alepha.isBrowser() &&
        typeof setImmediate === "function" &&
        typeof proc?.on === "function";
      if (this.batching) {
        this.installExitHook();
      }
    }
    return this.batching;
  }

  protected installExitHook(): void {
    const self = ConsoleDestinationProvider;
    if (self.exitHookInstalled) {
      return;
    }
    self.exitHookInstalled = true;
    // `exit` runs on `process.exit()` and after an uncaught exception, and
    // allows only synchronous work: a `console.log` to a file or a pipe is.
    process.once("exit", self.flushPending);
  }

  protected readonly onStop = $hook({
    on: "stop",
    priority: "last",
    handler: () => this.flush(),
  });

  protected writeStdout(message: string): void {
    console.log(message);
  }

  protected writeStderr(message: string): void {
    console.error(message);
  }
}
