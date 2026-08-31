import { randomUUID } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
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
        staleAfterMs: 120,
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
      writeFileSync(
        holderFile,
        JSON.stringify({
          pid: 999_999,
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

    it("sweeps a ticket whose heartbeat has gone stale", async () => {
      const dir = scratch();
      const p = fastProvider(dir);
      const queue = p.queueDir("k");

      mkdirSync(queue, { recursive: true });
      writeFileSync(
        join(queue, "0000000000000001-0000000001.json"),
        JSON.stringify({
          pid: 999_999,
          key: "k",
          command: "dead",
          cwd: "/dead",
          startedAt: 1,
          heartbeatAt: 1,
        }),
      );

      // The dead ticket sorts first, so acquiring at all proves it was swept.
      const handle = await p.acquire("k", { command: "live", cwd: "/live" });
      expect(
        readdirSync(queue).filter((f) => f.endsWith(".json")),
      ).toHaveLength(1);

      await handle.release();
      expect(
        readdirSync(queue).filter((f) => f.endsWith(".json")),
      ).toHaveLength(0);
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

    const gated = (): GatedExclusiveProvider =>
      Alepha.create().inject(GatedExclusiveProvider);

    it("lets exactly one in", async () => {
      const key = `alepha-exclusive-race-${randomUUID()}`;
      const a = gated();
      const b = gated();
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
    });
  });
});
