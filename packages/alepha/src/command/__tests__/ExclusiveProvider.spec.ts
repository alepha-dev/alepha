import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Alepha, AlephaError } from "alepha";
import { describe, expect, it } from "vitest";

import type { ExclusiveTicket } from "../index.ts";
import { ExclusiveProvider, exclusiveOptions } from "../index.ts";

describe("ExclusiveProvider", () => {
  const scratch = (): string =>
    mkdtempSync(join(tmpdir(), "alepha-exclusive-test-"));

  /**
   * A pid that provably names nothing.
   *
   * Spawned and reaped rather than hard-coded: the sweep asks the operating
   * system whether a pid is alive, so a test that picks a large number is
   * asserting that the number happens to be free on this machine today.
   * `spawnSync` returns only after it has waited on the child, so the pid is
   * gone by the time it hands it back; the fallbacks cover a platform that
   * recycles it inside that window.
   */
  const deadPid = (): number => {
    const spawned = spawnSync(process.execPath, ["-e", ""]);

    for (const pid of [spawned.pid ?? 0, 999_999, 4_194_303]) {
      if (pid <= 0) {
        continue;
      }
      try {
        process.kill(pid, 0);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ESRCH") {
          return pid;
        }
      }
    }

    throw new Error("could not find a pid that is provably dead");
  };

  const provider = (): ExclusiveProvider => {
    const alepha = Alepha.create();
    return alepha.inject(ExclusiveProvider);
  };

  describe("resolveKey", () => {
    it("returns undefined when the command does not opt in", () => {
      expect(
        provider().resolveKey(undefined, process.cwd(), "verify"),
      ).toBeUndefined();
      expect(
        provider().resolveKey(false, process.cwd(), "verify"),
      ).toBeUndefined();
    });

    it("derives the key from the package name so worktrees share one slot", () => {
      const rootA = scratch();
      const rootB = scratch();
      writeFileSync(
        join(rootA, "package.json"),
        JSON.stringify({ name: "my-app" }),
      );
      writeFileSync(
        join(rootB, "package.json"),
        JSON.stringify({ name: "my-app" }),
      );

      // Two different directories, same package: the whole point of the design.
      expect(provider().resolveKey(true, rootA, "verify")).toBe(
        "my-app:verify",
      );
      expect(provider().resolveKey(true, rootB, "verify")).toBe(
        "my-app:verify",
      );
    });

    it("keeps different projects apart", () => {
      const root = scratch();
      writeFileSync(
        join(root, "package.json"),
        JSON.stringify({ name: "other-app" }),
      );

      expect(provider().resolveKey(true, root, "build")).toBe(
        "other-app:build",
      );
    });

    it("lets an explicit string override the derived key", () => {
      const root = scratch();
      writeFileSync(
        join(root, "package.json"),
        JSON.stringify({ name: "my-app" }),
      );

      expect(provider().resolveKey("alepha:verify", root, "verify")).toBe(
        "alepha:verify",
      );
    });

    it("throws rather than falling back when no package name resolves", () => {
      const root = scratch();

      // A basename fallback would differ per worktree and silently defeat the
      // feature, so an unresolvable key has to be loud.
      expect(() => provider().resolveKey(true, root, "verify")).toThrow(
        AlephaError,
      );
      expect(() => provider().resolveKey(true, root, "verify")).toThrow(
        /exclusive: "/,
      );
    });

    it("names the root command instead of producing a trailing colon", () => {
      const root = scratch();
      writeFileSync(
        join(root, "package.json"),
        JSON.stringify({ name: "my-app" }),
      );

      expect(provider().resolveKey(true, root, "")).toBe("my-app:(root)");
    });
  });

  describe("queueDir", () => {
    it("gives different keys different directories", () => {
      const p = provider();
      expect(p.queueDir("a:verify")).not.toBe(p.queueDir("b:verify"));
    });

    it("produces a filesystem-safe, readable directory name", () => {
      const dir = provider().queueDir("alepha:verify");
      const base = dir.split(/[\\/]/).pop() ?? "";

      expect(base).toMatch(/^alepha-verify-[0-9a-f]{16}$/);
    });

    it("honours ALEPHA_EXCLUSIVE_DIR so spawned children can share a scratch queue", () => {
      const dir = scratch();
      process.env.ALEPHA_EXCLUSIVE_DIR = dir;
      try {
        expect(provider().queueDir("alepha:verify").startsWith(dir)).toBe(true);
      } finally {
        delete process.env.ALEPHA_EXCLUSIVE_DIR;
      }
    });
  });

  describe("acquire", () => {
    const fastProvider = (dir: string): ExclusiveProvider => {
      const alepha = Alepha.create();
      // Shrink the windows so the test does not spend seconds sleeping.
      // `store.mut` MUST run before the injection: `$store` is a class field,
      // so the provider reads the atom when it is constructed.
      alepha.store.mut(exclusiveOptions, (old) => ({
        ...old,
        dir,
        pollIntervalMs: 10,
        heartbeatIntervalMs: 20,
        hintAfterMs: 60_000,
      }));
      return alepha.inject(ExclusiveProvider);
    };

    it("gives two same-millisecond tickets distinct names", () => {
      const p = fastProvider(scratch());

      // The pid is identical for every acquire inside one process, so a name
      // built from time and pid alone collides here and one ticket silently
      // overwrites the other.
      const a = p.ticketName(1_756_213_041_123);
      const b = p.ticketName(1_756_213_041_123);

      expect(a).not.toBe(b);
      // Still sorts by arrival: same instant, so the shared prefix is equal.
      expect(a.slice(0, 27)).toBe(b.slice(0, 27));
      expect(p.ticketName(1).localeCompare(p.ticketName(2))).toBeLessThan(0);
    });

    it("hands the slot to the first arrival and makes the second wait", async () => {
      const dir = scratch();
      const first = fastProvider(dir);
      const second = fastProvider(dir);

      const firstHandle = await first.acquire("k", { command: "a", cwd: "/a" });

      let secondAcquired = false;
      const secondPending = second
        .acquire("k", { command: "b", cwd: "/b" })
        .then((h) => {
          secondAcquired = true;
          return h;
        });

      await new Promise((r) => setTimeout(r, 60));
      expect(secondAcquired).toBe(false);

      await firstHandle.release();
      const secondHandle = await secondPending;
      expect(secondAcquired).toBe(true);

      await secondHandle.release();
    });

    it("serves waiters in arrival order, not in wake-up order", async () => {
      const dir = scratch();
      const held = await fastProvider(dir).acquire("k", {
        command: "held",
        cwd: "/h",
      });

      const order: string[] = [];
      const queue: Promise<void>[] = [];

      for (const name of ["first", "second", "third"]) {
        queue.push(
          (async () => {
            const handle = await fastProvider(dir).acquire("k", {
              command: name,
              cwd: `/${name}`,
            });
            order.push(name);
            await handle.release();
          })(),
        );
        // Stagger arrivals so the expected order is unambiguous.
        await new Promise((r) => setTimeout(r, 30));
      }

      await held.release();
      await Promise.all(queue);

      expect(order).toEqual(["first", "second", "third"]);
    });

    it("yields to a claimed slot even when it sorts ahead of the holder", async () => {
      const dir = scratch();
      const p = fastProvider(dir);
      const queue = p.queueDir("k");
      mkdirSync(queue, { recursive: true });

      // A holder whose ticket sorts LAST. Sort order alone would make the next
      // arrival the head and let it walk straight in beside the holder, which
      // is the same-millisecond tie-break race in its reproducible form.
      const now = Date.now();
      const holderFile = join(
        queue,
        "9999999999999999-0000000001-aaaaaaaa.json",
      );
      // Our own pid, so the holder is unambiguously alive: the sweep reads the
      // pid, and a synthetic holder with a dead one would be removed before it
      // could make the point.
      writeFileSync(
        holderFile,
        JSON.stringify({
          pid: process.pid,
          key: "k",
          command: "holder",
          cwd: "/h",
          startedAt: now,
          heartbeatAt: now,
          holding: true,
        }),
      );

      let entered = false;
      const pending = p
        .acquire("k", { command: "late", cwd: "/l" })
        .then((h) => {
          entered = true;
          return h;
        });

      await new Promise((r) => setTimeout(r, 60));
      expect(entered).toBe(false);

      unlinkSync(holderFile);
      const handle = await pending;
      expect(entered).toBe(true);

      await handle.release();
    });

    it("sweeps a ticket whose owner is gone", async () => {
      const dir = scratch();
      const p = fastProvider(dir);
      const queue = p.queueDir("k");

      mkdirSync(queue, { recursive: true });
      writeFileSync(
        join(queue, "0000000000000001-0000000001.json"),
        JSON.stringify({
          pid: deadPid(),
          key: "k",
          command: "dead",
          cwd: "/dead",
          startedAt: 1,
          heartbeatAt: 1,
          holding: true,
        }),
      );

      // The dead ticket sorts first AND claims the slot, so acquiring at all
      // proves it was swept rather than merely outsorted.
      const handle = await p.acquire("k", { command: "live", cwd: "/live" });
      expect(
        readdirSync(queue).filter((f) => f.endsWith(".json")),
      ).toHaveLength(1);

      await handle.release();
      expect(
        readdirSync(queue).filter((f) => f.endsWith(".json")),
      ).toHaveLength(0);
    });

    /**
     * The bug that made the heartbeat the wrong criterion.
     *
     * `beat()` rewrites its ticket unconditionally and `writeTicket` ends in a
     * `rename`, so a holder swept for a stale heartbeat recreated its own
     * ticket on the next beat with `holding: true` still set. The waiter that
     * swept it was inside by then: two processes in the critical section, on
     * exactly the saturated machine the queue exists to protect.
     */
    it("never sweeps a live pid, however old its heartbeat", async () => {
      const dir = scratch();
      const p = fastProvider(dir);
      const queue = p.queueDir("k");

      mkdirSync(queue, { recursive: true });
      const stalled = join(queue, "0000000000000001-0000000001.json");
      writeFileSync(
        stalled,
        JSON.stringify({
          pid: process.pid,
          key: "k",
          command: "stalled",
          cwd: "/stalled",
          // Epoch. Older than any window anyone would configure.
          startedAt: 1,
          heartbeatAt: 1,
          holding: true,
        }),
      );

      let entered = false;
      const pending = p
        .acquire("k", { command: "late", cwd: "/l" })
        .then((h) => {
          entered = true;
          return h;
        });

      // Many poll intervals: the old criterion swept on the first one.
      await new Promise((r) => setTimeout(r, 120));
      expect(entered).toBe(false);
      expect(existsSync(stalled)).toBe(true);

      unlinkSync(stalled);
      const handle = await pending;
      expect(entered).toBe(true);

      await handle.release();
    });

    describe("reentrancy", () => {
      it("lets a process re-enter a key it already holds", async () => {
        const dir = scratch();
        const p = fastProvider(dir);
        const queue = p.queueDir("k");

        const outer = await p.acquire("k", { command: "outer", cwd: "/o" });

        // Under the old design this queued behind a ticket the same process
        // owned and would never be released, which is a deadlock.
        const inner = await p.acquire("k", { command: "inner", cwd: "/i" });

        // Re-entering takes no second ticket: there is nothing to queue.
        expect(
          readdirSync(queue).filter((f) => f.endsWith(".json")),
        ).toHaveLength(1);

        await inner.release();

        // The inner release must NOT free the slot.
        expect(
          readdirSync(queue).filter((f) => f.endsWith(".json")),
        ).toHaveLength(1);

        await outer.release();
        expect(
          readdirSync(queue).filter((f) => f.endsWith(".json")),
        ).toHaveLength(0);
      });

      it("counts depth, so only the outermost release frees the slot", async () => {
        const dir = scratch();
        const p = fastProvider(dir);
        const queue = p.queueDir("k");

        const handles = [
          await p.acquire("k", { command: "a", cwd: "/a" }),
          await p.acquire("k", { command: "b", cwd: "/b" }),
          await p.acquire("k", { command: "c", cwd: "/c" }),
        ];

        for (const handle of handles.slice(1).toReversed()) {
          await handle.release();
          expect(
            readdirSync(queue).filter((f) => f.endsWith(".json")),
          ).toHaveLength(1);
        }

        await handles[0].release();
        expect(
          readdirSync(queue).filter((f) => f.endsWith(".json")),
        ).toHaveLength(0);
      });

      it("does not double-count a handle released twice", async () => {
        const dir = scratch();
        const p = fastProvider(dir);
        const queue = p.queueDir("k");

        const outer = await p.acquire("k", { command: "outer", cwd: "/o" });
        const inner = await p.acquire("k", { command: "inner", cwd: "/i" });

        await inner.release();
        await inner.release();

        // A second release of the inner handle must not free the outer one.
        expect(
          readdirSync(queue).filter((f) => f.endsWith(".json")),
        ).toHaveLength(1);

        await outer.release();
        expect(
          readdirSync(queue).filter((f) => f.endsWith(".json")),
        ).toHaveLength(0);
      });

      it("keeps a different key in its own queue", async () => {
        const dir = scratch();
        const p = fastProvider(dir);

        const first = await p.acquire("k", { command: "a", cwd: "/a" });
        const second = await p.acquire("other", { command: "b", cwd: "/b" });

        expect(
          readdirSync(p.queueDir("k")).filter((f) => f.endsWith(".json")),
        ).toHaveLength(1);
        expect(
          readdirSync(p.queueDir("other")).filter((f) => f.endsWith(".json")),
        ).toHaveLength(1);

        await second.release();
        await first.release();
      });
    });

    it("does nothing when ALEPHA_NO_EXCLUSIVE is set", async () => {
      const dir = scratch();
      process.env.ALEPHA_NO_EXCLUSIVE = "1";
      try {
        const p = fastProvider(dir);
        const a = await p.acquire("k", { command: "a", cwd: "/a" });
        const b = await p.acquire("k", { command: "b", cwd: "/b" });

        // Both got through, and no queue directory was ever created.
        expect(existsSync(p.queueDir("k"))).toBe(false);

        await a.release();
        await b.release();
      } finally {
        delete process.env.ALEPHA_NO_EXCLUSIVE;
      }
    });
  });

  /**
   * A release must not race the heartbeat it is cancelling.
   *
   * `clearInterval` stops the NEXT tick, but says nothing about a beat that
   * already fired: its write is enqueued synchronously on the write chain and
   * lands two async hops later, so an unlink issued in between deletes the
   * ticket first and the beat's rename puts it straight back.
   */
  describe("release racing its own heartbeat", () => {
    /**
     * Records the live ticket, so a heartbeat tick can be replayed by hand.
     *
     * Driven explicitly rather than by waiting for the real interval: the
     * window is two microtasks wide, and a test that waited for a timer to
     * land inside it would be exactly the flake it is meant to prevent.
     */
    class BeatingExclusiveProvider extends ExclusiveProvider {
      public file = "";
      public ticket?: ExclusiveTicket;
      public testBeat = this.beat.bind(this);

      protected override async writeTicket(
        file: string,
        ticket: ExclusiveTicket,
      ): Promise<void> {
        this.file = file;
        this.ticket = ticket;
        return super.writeTicket(file, ticket);
      }
    }

    it("leaves no ticket behind when a beat is still in flight", async () => {
      const dir = scratch();
      const alepha = Alepha.create();
      alepha.store.mut(exclusiveOptions, (old) => ({ ...old, dir }));
      const p = alepha.inject(BeatingExclusiveProvider);
      const queue = p.queueDir("k");

      const handle = await p.acquire("k", { command: "live", cwd: "/live" });
      expect(p.ticket).toBeDefined();

      // Exactly what the interval callback does: start a beat and do not
      // await it. Releasing in the same turn is what a starved event loop
      // produces on its own.
      const beating = p.testBeat(p.file, p.ticket as ExclusiveTicket);
      await handle.release();
      await beating;

      expect(
        readdirSync(queue).filter((f) => f.endsWith(".json")),
      ).toHaveLength(0);
    });
  });

  /**
   * Two processes must not both end up inside the critical section.
   *
   * The claim is a read-then-write, and the read can miss a ticket that has
   * not landed yet: A reads before B's file exists, sees itself alone at
   * position 0, and starts its `holding: true` write; B lands, reads, sees A
   * still `holding: false`, and claims too. Both return.
   *
   * `holding` was added for a different case — a later arrival meeting an
   * ALREADY claimed slot — and says nothing about the window before the claim
   * lands.
   *
   * Driven deterministically rather than by racing real processes.
   * `exclusive-cross-process.spec.ts` spawns children and cannot hit this
   * window on purpose: it is microseconds wide and depends on which of two
   * writes reaches the filesystem first.
   */
  describe("two arrivals claiming the same unclaimed slot", () => {
    /**
     * Holds the FIRST claim write open, and reports when it has been reached,
     * so the other instance can be driven through the window by hand.
     */
    class GatedExclusiveProvider extends ExclusiveProvider {
      public gate?: Promise<void>;
      public reached!: Promise<void>;
      protected announceReached!: () => void;
      protected claims = 0;

      public arm(gate: Promise<void>): void {
        this.gate = gate;
        this.reached = new Promise((resolve) => {
          this.announceReached = resolve;
        });
      }

      public testWaitForTurn = this.waitForTurn.bind(this);

      protected override async writeTicket(
        file: string,
        ticket: ExclusiveTicket,
      ): Promise<void> {
        if (ticket.holding && this.gate && this.claims++ === 0) {
          this.announceReached();
          await this.gate;
        }
        return super.writeTicket(file, ticket);
      }
    }

    const gated = (dir: string): GatedExclusiveProvider => {
      const alepha = Alepha.create();
      // A base of its own, never the default one under the system temp
      // directory: that is where real runs queue, so a test must not leave
      // anything there. `store.mut` runs before the injection, as above.
      alepha.store.mut(exclusiveOptions, (old) => ({
        ...old,
        dir,
        pollIntervalMs: 10,
      }));
      return alepha.inject(GatedExclusiveProvider);
    };

    it("lets exactly one in", async () => {
      const base = scratch();
      const key = "k";
      const a = gated(base);
      const b = gated(base);
      const dir = a.queueDir(key);
      await mkdir(dir, { recursive: true });

      // B's ticket sorts EARLIER, which is what makes it the rightful winner
      // and this the interesting direction: A claims first in wall-clock time
      // and still has to yield.
      const at = 2_000;
      const bt = 1_000;
      const aName = a.ticketName(at);
      const bName = b.ticketName(bt);
      const aFile = join(dir, aName);
      const bFile = join(dir, bName);

      const ticket = (startedAt: number): ExclusiveTicket => ({
        pid: process.pid,
        key,
        command: "verify",
        cwd: process.cwd(),
        startedAt,
        heartbeatAt: startedAt,
        holding: false,
      });
      const aTicket = ticket(at);
      const bTicket = ticket(bt);

      let release!: () => void;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      a.arm(gate);

      try {
        // A arrives alone and starts claiming.
        writeFileSync(aFile, JSON.stringify(aTicket), "utf8");
        let aEntered = false;
        const aTurn = a.testWaitForTurn(dir, aFile, aName, aTicket).then(() => {
          aEntered = true;
          return undefined;
        });
        await a.reached;

        // B lands and reads INSIDE A's window, so it sees A not yet holding.
        writeFileSync(bFile, JSON.stringify(bTicket), "utf8");
        let bEntered = false;
        const bTurn = b.testWaitForTurn(dir, bFile, bName, bTicket).then(() => {
          bEntered = true;
          return undefined;
        });
        await bTurn;

        release();
        // A either returns (having verified) or goes back to waiting. Give it
        // room to do whichever, then read the outcome.
        await Promise.race([
          aTurn,
          new Promise((resolve) => setTimeout(resolve, 500)),
        ]);

        // Both assertions matter. "not two" alone would also be satisfied by a
        // deadlock in which neither side ever enters.
        expect([aEntered, bEntered].filter(Boolean)).toHaveLength(1);
        expect(bEntered).toBe(true);

        // B never releases, so A would poll for the rest of the run and meet
        // the queue removed underneath it. Hand it the slot so it stops first.
        unlinkSync(bFile);
        await aTurn;
      } finally {
        rmSync(base, { recursive: true, force: true });
      }
    });
  });
});
