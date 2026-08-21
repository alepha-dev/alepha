import { $hook, $inject, Alepha } from "alepha";
import { DateTimeProvider } from "alepha/datetime";
import {
  $logger,
  type LogEntry,
  MemoryDestinationProvider,
} from "alepha/logger";
import { FileSystemProvider } from "alepha/system";

import { DEV_LOG_RESTART_TYPE } from "../schemas/DevLogMarker.ts";

/**
 * The devtools log buffer, and the part of it that outlives the process.
 *
 * Logs used to live only in `MemoryDestinationProvider`, which made every dev
 * restart throw them away. That is backwards: the restart is usually caused by
 * the very thing you were trying to read, so the crash that triggered it was
 * the first casualty. This provider keeps the same in-memory buffer as the live
 * store and mirrors it to an append-only JSONL file, then loads the tail back
 * on the next boot with a synthetic marker separating the two runs.
 *
 * Restored entries are held in `history`, apart from the live buffer, for two
 * reasons. Ordering needs no hook choreography, since history is always
 * prepended regardless of what the current run has already logged. And the
 * ring eviction in `MemoryDestinationProvider` keeps applying to the live run
 * alone, so a busy session cannot silently evict the crash you restarted to
 * read.
 *
 * Dev only. `AlephaDevtools` refuses to register in production, so nothing here
 * can turn into a production log sink.
 */
export class DevLogStoreProvider {
  protected readonly log = $logger();
  protected readonly alepha = $inject(Alepha);
  protected readonly memory = $inject(MemoryDestinationProvider);
  protected readonly fs = $inject(FileSystemProvider);
  protected readonly dateTime = $inject(DateTimeProvider);

  /**
   * How much of the previous run survives, and the ceiling on the file itself.
   *
   * Both bounds are needed. The count is what a person reasons about, but a
   * handful of entries carrying a large `data` payload can weigh megabytes, so
   * a count alone leaves the file unbounded in the only case that hurts.
   */
  public readonly options = {
    maxEntries: 2_000,
    maxBytes: 8 * 1024 * 1024,
  };

  /**
   * Entries restored from the previous run, ending with the restart marker.
   */
  protected history: LogEntry[] = [];

  /**
   * Lines written but not yet flushed. Appends are coalesced because a dev boot
   * emits hundreds of lines in a few milliseconds and one syscall each would be
   * felt.
   */
  protected pending: string[] = [];
  protected timer: ReturnType<typeof setTimeout> | undefined;
  protected bytesOnDisk = 0;
  protected flushing: Promise<void> = Promise.resolve();

  /**
   * Disabled under test. Otherwise every suite that boots the module would
   * accumulate a file on disk and replay one run's logs into the next, which
   * turns an ordinary spec into a stateful one.
   */
  protected get persists(): boolean {
    return !this.disabled && !this.alepha.isTest();
  }

  /**
   * Set once the filesystem refuses a write.
   *
   * Without it the failure is a loop: the debug line reporting it is itself a
   * log, which queues another append, which fails, which logs again. Giving up
   * on the first refusal is also the right answer on its own terms, since a
   * path that cannot be written now will not start working on the next line.
   */
  protected disabled = false;

  protected get dir(): string {
    const dataDir = String(this.alepha.env.DATA_DIR || "node_modules/.alepha");
    return this.fs.join(dataDir, "devtools");
  }

  protected get file(): string {
    return this.fs.join(this.dir, "logs.jsonl");
  }

  /**
   * Restore before the server can answer anything, which `configure`
   * guarantees and `start` does not.
   */
  protected readonly onConfigure = $hook({
    on: "configure",
    handler: async () => {
      if (!this.persists) {
        return;
      }
      await this.restore();
    },
  });

  /**
   * Capture all logs into memory so the devtools UI can display them.
   *
   * In dev mode `LogDestinationProvider` is bound to
   * `ConsoleDestinationProvider`, so `MemoryDestinationProvider` would
   * otherwise never receive writes.
   */
  protected readonly onLog = $hook({
    on: "log",
    handler: ({ entry }) => {
      this.memory.write("", entry);
      this.queue(entry);
    },
  });

  protected readonly onStop = $hook({
    on: "stop",
    handler: async () => {
      if (this.timer) {
        clearTimeout(this.timer);
        this.timer = undefined;
      }
      await this.flush();
    },
  });

  /**
   * The previous run's entries, the restart marker, then this run's.
   */
  public entries(): Array<LogEntry & { formatted?: string }> {
    return [...this.history, ...this.memory.logs];
  }

  // -------------------------------------------------------------------------------------------------------------------

  /**
   * Read the tail of the persisted file, then rewrite it compacted.
   *
   * Compacting here rather than while running means the file shrinks back to
   * its bound once per boot, and the running process only ever appends.
   */
  protected async restore(): Promise<void> {
    let text: string;
    try {
      if (!(await this.fs.exists(this.file))) {
        await this.fs.mkdir(this.dir);
        return;
      }
      text = await this.fs.readTextFile(this.file);
    } catch (error) {
      // A missing directory, a read-only checkout, or an edge runtime with no
      // filesystem at all. None of them are worth failing a boot over: without
      // history devtools simply behaves as it did before.
      this.log.debug("Could not read the persisted devtools log", { error });
      return;
    }

    const kept = this.tail(text.split("\n"));
    if (kept.length === 0) {
      return;
    }

    this.history = kept;
    // Only once there is a previous run to separate. On a first boot the
    // divider would sit at the top of an empty page and separate nothing.
    this.history.push(this.marker());

    await this.rewrite(this.history);
  }

  /**
   * The last entries that fit within BOTH bounds, walking backwards from the
   * newest line.
   *
   * Malformed lines are skipped rather than fatal: the last line of the file is
   * routinely torn, because the process died mid-write, which is exactly the
   * run whose logs matter most.
   */
  protected tail(lines: string[]): LogEntry[] {
    const kept: LogEntry[] = [];
    let bytes = 0;

    for (let i = lines.length - 1; i >= 0; i--) {
      const line = lines[i]?.trim();
      if (!line) continue;

      if (kept.length >= this.options.maxEntries) break;
      const size = line.length + 1;
      if (bytes + size > this.options.maxBytes) break;

      let entry: LogEntry;
      try {
        entry = JSON.parse(line);
      } catch {
        continue;
      }
      if (!entry || typeof entry.timestamp !== "number") {
        continue;
      }

      bytes += size;
      kept.push(entry);
    }

    return kept.reverse();
  }

  protected marker(): LogEntry {
    return {
      level: "INFO",
      message: "App Restarted",
      service: "DevLogStoreProvider",
      module: "alepha.devtools",
      timestamp: this.dateTime.nowMillis(),
      data: { type: DEV_LOG_RESTART_TYPE },
    };
  }

  protected queue(entry: LogEntry): void {
    if (!this.persists) {
      return;
    }

    this.pending.push(this.serialize(entry));

    // An error is often the last thing a dying process says, so it cannot wait
    // for the next tick of the coalescing timer.
    if (entry.level === "ERROR") {
      void this.flush();
      return;
    }

    if (!this.timer) {
      this.timer = setTimeout(() => {
        this.timer = undefined;
        void this.flush();
      }, 250);
      // Never hold the process open for a log file. Guarded because the timer
      // is a number, not an object, wherever the DOM typings win.
      (this.timer as { unref?: () => void }).unref?.();
    }
  }

  protected serialize(entry: LogEntry): string {
    try {
      return JSON.stringify(entry);
    } catch {
      // A circular or otherwise unserialisable `data` payload must not cost the
      // whole line. The message is the part someone came here to read.
      return JSON.stringify({
        ...entry,
        data: { unserializable: true },
      });
    }
  }

  /**
   * Write what is queued. Serialised against itself so two flushes cannot
   * interleave their appends.
   */
  protected async flush(): Promise<void> {
    this.flushing = this.flushing.then(async () => {
      if (this.pending.length === 0) {
        return;
      }

      const chunk = `${this.pending.join("\n")}\n`;
      this.pending = [];

      try {
        await this.fs.appendFile(this.file, chunk);
        this.bytesOnDisk += chunk.length;
      } catch (error) {
        this.disabled = true;
        this.pending = [];
        this.log.debug("Could not persist devtools logs, giving up", { error });
        return;
      }

      // A long-lived dev session appends without ever passing through a boot,
      // so the byte ceiling has to be enforced while running too.
      if (this.bytesOnDisk > this.options.maxBytes) {
        await this.compact();
      }
    });

    return this.flushing;
  }

  protected async compact(): Promise<void> {
    const all = this.entries();
    const lines = all.map((entry) => this.serialize(entry));
    await this.rewrite(this.tail(lines));
  }

  protected async rewrite(entries: LogEntry[]): Promise<void> {
    const text = entries.map((entry) => this.serialize(entry)).join("\n");
    const payload = text ? `${text}\n` : "";
    try {
      await this.fs.mkdir(this.dir);
      await this.fs.writeFile(this.file, payload);
      this.bytesOnDisk = payload.length;
    } catch (error) {
      this.log.debug("Could not compact the persisted devtools log", { error });
    }
  }
}
