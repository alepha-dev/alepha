import { createHash, randomUUID } from "node:crypto";
import { readFileSync, unlinkSync } from "node:fs";
import {
  mkdir,
  readdir,
  readFile,
  rename,
  unlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir, userInfo } from "node:os";
import { join } from "node:path";

import { $inject, $store, AlephaError } from "alepha";
import { DateTimeProvider } from "alepha/datetime";
import { $logger } from "alepha/logger";

import { exclusiveOptions } from "../atoms/exclusiveOptions.ts";

/**
 * One process's claim on a queue, stored as a single JSON file.
 */
export interface ExclusiveTicket {
  pid: number;
  key: string;
  command: string;
  cwd: string;
  startedAt: number;
  heartbeatAt: number;

  /**
   * Whether this ticket's owner is inside the critical section.
   *
   * Load-bearing, and not derivable from sort order. Sort order alone decides
   * the head, so a process arriving in the same millisecond as the current
   * holder can tie-break ahead of it and promote itself while the holder is
   * still running. A holder therefore claims the slot explicitly, and every
   * waiter yields to a claimed slot no matter where it sorts.
   */
  holding: boolean;
}

/**
 * The result of a successful acquire. Always release it in a finally block.
 */
export interface ExclusiveHandle {
  release: () => Promise<void>;
}

/**
 * A machine-wide FIFO queue for CLI commands that must not run concurrently.
 *
 * Deliberately not built on `alepha/lock`: the default `MemoryLockProvider` is
 * in-process, so two CLI processes would each hold their own and the feature
 * would silently protect nothing. `$lock`'s `wait` is also a race rather than a
 * queue, and its `maxDuration` doubles as both the lock TTL and the wait
 * timeout, which breaks on any command that runs longer than it.
 */
export class ExclusiveProvider {
  protected readonly log = $logger();
  protected readonly dateTime = $inject(DateTimeProvider);
  protected readonly settings = $store(exclusiveOptions);

  /**
   * Resolve the queue key for a command, or undefined when it does not opt in.
   *
   * The key must be stable across checkouts of the same project and distinct
   * between projects, which is why it is derived from the package name and
   * never from the working directory.
   */
  public resolveKey(
    exclusive: boolean | string | undefined,
    root: string,
    commandName: string,
  ): string | undefined {
    if (!exclusive) {
      return undefined;
    }

    if (typeof exclusive === "string") {
      return exclusive;
    }

    const name = this.packageName(root);
    if (!name) {
      throw new AlephaError(
        `Command '${commandName}' sets exclusive: true, but no package name could be read from '${join(root, "package.json")}'. ` +
          `Pass an explicit key instead, for example exclusive: "my-app:${commandName || "root"}".`,
      );
    }

    return `${name}:${commandName === "" ? "(root)" : commandName}`;
  }

  /**
   * Join the queue for `key` and resolve once this process owns the slot.
   *
   * The heartbeat starts before the wait loop, not after it: a waiter whose own
   * ticket went stale would be swept by the others and lose its place.
   */
  public async acquire(
    key: string,
    meta: { command: string; cwd: string },
  ): Promise<ExclusiveHandle> {
    if (process.env.ALEPHA_NO_EXCLUSIVE) {
      return { release: async () => {} };
    }

    const dir = this.queueDir(key);
    await mkdir(dir, { recursive: true });

    const startedAt = this.dateTime.nowMillis();
    const name = this.ticketName(startedAt);
    const file = join(dir, name);
    const ticket: ExclusiveTicket = {
      pid: process.pid,
      key,
      command: meta.command,
      cwd: meta.cwd,
      startedAt,
      heartbeatAt: startedAt,
      holding: false,
    };

    await this.writeTicket(file, ticket);

    const heartbeat = setInterval(() => {
      void this.beat(file, ticket);
    }, this.settings.heartbeatIntervalMs);
    heartbeat.unref();

    // An `exit` handler must be synchronous to have any effect, and a default
    // SIGINT terminates the process without firing `exit` at all, so both are
    // needed to hand the turn over instead of waiting out the stale window.
    const cleanup = () => {
      try {
        unlinkSync(file);
      } catch {
        // Already gone, or never written. Nothing to do.
      }
    };
    const onSignal = (signal: string) => {
      cleanup();
      process.exit(signal === "SIGINT" ? 130 : 143);
    };
    process.once("exit", cleanup);
    process.once("SIGINT", onSignal);
    process.once("SIGTERM", onSignal);

    await this.waitForTurn(dir, file, name, ticket);

    return {
      release: async () => {
        clearInterval(heartbeat);
        process.off("exit", cleanup);
        process.off("SIGINT", onSignal);
        process.off("SIGTERM", onSignal);

        // `clearInterval` only stops the NEXT tick. A beat that already fired
        // is enqueued on the write chain synchronously but lands two async
        // hops later, so unlinking now would delete the ticket and let that
        // beat's `rename` put it straight back: holding the slot, with a fresh
        // heartbeat, and with the `exit` handler already detached. Nothing
        // would then remove it before the stale sweep, so a released queue
        // would keep blocking for `staleAfterMs`.
        //
        // Draining the chain first is enough precisely because the enqueue is
        // synchronous: a beat either got on the chain before the
        // `clearInterval` above, or it never fires.
        await this.writeChain.catch(() => {});

        await unlink(file).catch(() => {});
      },
    };
  }

  /**
   * The filename for one ticket, which is also its position in the queue.
   *
   * Zero-padded so a plain lexicographic sort is arrival order. The random
   * suffix is not decoration: the pid is identical for every acquire inside
   * one process, so without it two acquires landing in the same millisecond
   * would write the same filename and one would silently overwrite the other.
   * Order stays deterministic because every observer sorts the same names, and
   * ties inside a single millisecond have no meaning to begin with.
   */
  public ticketName(startedAt: number): string {
    const time = String(startedAt).padStart(16, "0");
    const pid = String(process.pid).padStart(10, "0");

    return `${time}-${pid}-${randomUUID().slice(0, 8)}.json`;
  }

  /**
   * Block until this process owns the slot, then claim it.
   *
   * Two rules, in this order. An explicitly claimed slot is always respected,
   * whoever holds it and wherever it sorts. Only when no slot is claimed does
   * arrival order decide, and the winner claims before it returns.
   */
  protected async waitForTurn(
    dir: string,
    file: string,
    name: string,
    ticket: ExclusiveTicket,
  ): Promise<void> {
    let announced = "";

    for (;;) {
      const tickets = await this.readTickets(dir);
      const holder = tickets.find((it) => it.ticket.holding);

      if (holder?.file === name) {
        return;
      }

      const position = tickets.findIndex((it) => it.file === name);
      if (position === -1) {
        // Our own ticket was swept while we were stalled. Rewrite it under the
        // same name so we keep our place instead of going to the back.
        await this.writeTicket(file, {
          ...ticket,
          heartbeatAt: this.dateTime.nowMillis(),
        });
        continue;
      }

      if (!holder && position === 0) {
        // Claim it before returning, so a later arrival that tie-breaks ahead
        // of us in sort order still yields instead of joining us inside.
        ticket.holding = true;
        ticket.heartbeatAt = this.dateTime.nowMillis();
        await this.writeTicket(file, ticket);

        // Then verify, because the claim above is a read-then-write and the
        // read can miss a ticket that had not landed yet. Two arrivals can
        // therefore both see an unclaimed queue and both claim it — the
        // `holding` flag fixes a later arrival meeting an ALREADY claimed
        // slot, and says nothing about the window before the claim lands.
        //
        // Re-reading AFTER our own write closes it rather than narrowing it.
        // For both sides to still miss each other you would need
        // `A.write < A.read < B.write` and `B.write < B.read < A.write` at
        // once, which chains into a cycle. That holds because `rename` on a
        // local filesystem is atomic and immediately visible, which is what
        // `tmpdir()` gives on every platform the CLI runs on.
        //
        // Sort order settles the winner, and both sides compute the same
        // answer from the same data, so exactly one survives.
        const claimed = await this.readTickets(dir);
        const rival = claimed.find(
          (it) => it.ticket.holding && it.file !== name && it.file < name,
        );
        if (!rival) {
          return;
        }

        // Lost it. Clear our own claim and go back to waiting rather than
        // returning, so we land in the normal wait path and are picked up on
        // the next poll.
        ticket.holding = false;
        ticket.heartbeatAt = this.dateTime.nowMillis();
        await this.writeTicket(file, ticket);
        continue;
      }

      const ahead = holder ?? tickets[0];
      if (ahead.file !== announced) {
        announced = ahead.file;
        this.log.info(this.waitingMessage(ahead.ticket, position, ticket));
      }

      await this.dateTime.wait(this.settings.pollIntervalMs);
    }
  }

  /**
   * Every live ticket in the queue, oldest first. Stale tickets are swept.
   */
  protected async readTickets(
    dir: string,
  ): Promise<Array<{ file: string; ticket: ExclusiveTicket }>> {
    const now = this.dateTime.nowMillis();
    // The names are zero-padded so a plain sort is arrival order, and every
    // waiter therefore computes the same order without a coordinator.
    const files = (await readdir(dir))
      .filter((it) => it.endsWith(".json"))
      .sort();
    const live: Array<{ file: string; ticket: ExclusiveTicket }> = [];

    for (const file of files) {
      const ticket = await this.readTicket(join(dir, file));
      if (!ticket) {
        continue;
      }

      if (now - ticket.heartbeatAt > this.settings.staleAfterMs) {
        await unlink(join(dir, file)).catch(() => {});
        continue;
      }

      live.push({ file, ticket });
    }

    return live;
  }

  /**
   * Read one ticket, or undefined when it is gone or unreadable.
   */
  protected async readTicket(
    file: string,
  ): Promise<ExclusiveTicket | undefined> {
    try {
      return JSON.parse(await readFile(file, "utf8")) as ExclusiveTicket;
    } catch {
      return undefined;
    }
  }

  /**
   * Serialises writes to this process's own ticket.
   *
   * The heartbeat fires on a timer while `waitForTurn` may be claiming the
   * slot, so two writes to the same path can overlap. Left concurrent they
   * raced twice over: both would stage the same temp path and the loser's
   * rename failed with ENOENT, and a beat that started before the claim could
   * land after it and write `holding: false` back over a held slot.
   */
  protected writeChain: Promise<unknown> = Promise.resolve();

  /**
   * Write a ticket atomically, so a reader never parses a half-written file.
   *
   * The temp name carries a random suffix as well as being serialised: the
   * chain only orders writes from this instance, and nothing stops another
   * process from staging a temp file beside it.
   */
  protected async writeTicket(
    file: string,
    ticket: ExclusiveTicket,
  ): Promise<void> {
    const previous = this.writeChain;
    const write = (async () => {
      await previous.catch(() => {});
      const tmp = `${file}.${randomUUID().slice(0, 8)}.tmp`;
      await writeFile(tmp, JSON.stringify(ticket), "utf8");
      await rename(tmp, file);
    })();

    // Swallowed on the stored chain only: the caller still sees the rejection
    // through the returned promise, but one failed write must not poison every
    // write that follows it.
    this.writeChain = write.catch(() => {});

    return write;
  }

  /**
   * Prove this process is still alive. Failures are ignored: the next beat
   * retries, and a genuinely dead process is meant to be swept.
   */
  protected async beat(file: string, ticket: ExclusiveTicket): Promise<void> {
    await this.writeTicket(file, {
      ...ticket,
      heartbeatAt: this.dateTime.nowMillis(),
    }).catch(() => {});
  }

  /**
   * The one line a waiting process prints when the holder changes.
   */
  protected waitingMessage(
    holder: ExclusiveTicket,
    position: number,
    own: ExclusiveTicket,
  ): string {
    const now = this.dateTime.nowMillis();
    const held = this.humanize(now - holder.startedAt);
    const ahead =
      position === 1 ? "you are next" : `${position} runs ahead of you`;
    const hint =
      now - own.startedAt >= this.settings.hintAfterMs
        ? " Set ALEPHA_NO_EXCLUSIVE=1 to bypass the queue."
        : "";

    return `Waiting for '${holder.key}': held by '${holder.command}' (pid ${holder.pid}, ${held}) in ${holder.cwd}, ${ahead}.${hint}`;
  }

  /**
   * Render a millisecond span as something like "4m12s".
   */
  protected humanize(ms: number): string {
    const total = Math.max(0, Math.round(ms / 1000));
    const minutes = Math.floor(total / 60);
    const seconds = total % 60;

    return minutes > 0 ? `${minutes}m${seconds}s` : `${seconds}s`;
  }

  /**
   * The directory holding one key's tickets.
   *
   * The slug keeps `ls` readable while debugging a stuck queue; the hash is
   * what guarantees uniqueness and filesystem safety, since keys legitimately
   * contain ':' and '/'.
   */
  public queueDir(key: string): string {
    const slug =
      key
        .replace(/[^a-zA-Z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 40) || "key";
    const hash = createHash("sha256").update(key).digest("hex").slice(0, 16);

    return join(this.baseDir(), `${slug}-${hash}`);
  }

  /**
   * The root of every queue directory.
   *
   * The uid is load-bearing on Linux: /tmp is shared between users and sticky,
   * so without it one user cannot sweep another user's stale ticket and the
   * queue deadlocks.
   */
  protected baseDir(): string {
    const override = process.env.ALEPHA_EXCLUSIVE_DIR;
    if (override) {
      return override;
    }

    if (this.settings.dir) {
      return this.settings.dir;
    }

    return join(tmpdir(), `alepha-exclusive-${userInfo().uid}`);
  }

  /**
   * Read the package name at `root`, or undefined when there is none.
   */
  protected packageName(root: string): string | undefined {
    try {
      const parsed = JSON.parse(
        readFileSync(join(root, "package.json"), "utf8"),
      );
      const name = parsed?.name;
      return typeof name === "string" && name.length > 0 ? name : undefined;
    } catch {
      return undefined;
    }
  }
}
