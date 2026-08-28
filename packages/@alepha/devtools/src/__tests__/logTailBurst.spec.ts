import { mkdirSync } from "node:fs";

import { Alepha } from "alepha";
import { type LogEntry, MemoryDestinationProvider } from "alepha/logger";
import { AlephaServer, ServerProvider } from "alepha/server";
import { beforeAll, describe, expect, it } from "vitest";

import { AlephaDevtools } from "../index.ts";

// Outside production the module serves its built UI from `assets/ui`, a
// gitignored build artifact that is absent in CI, and ServerStaticProvider
// would fail to boot on the missing directory. Same shim as
// DevToolsProvider.spec.ts.
beforeAll(() => {
  mkdirSync(new URL("../../assets/ui", import.meta.url), { recursive: true });
});

/**
 * One page of the tail, as the browser hook asks for it.
 */
interface LogPage {
  logs: Array<LogEntry & { seq: number }>;
  total: number;
  hasMore: boolean;
  dropped: number;
}

describe("the devtools log tail", () => {
  const boot = async () => {
    const alepha = Alepha.create({ env: { SERVER_PORT: 0 } })
      .with(AlephaServer)
      .with(AlephaDevtools);
    await alepha.start();

    const host = alepha.inject(ServerProvider).hostname;
    const page = async (after?: number, limit = 200): Promise<LogPage> => {
      const q = new URLSearchParams({ limit: String(limit) });
      if (after !== undefined) q.set("after", String(after));
      const res = await fetch(`${host}/__devtools/api/logs?${q}`);
      expect(res.status).toBe(200);
      return (await res.json()) as LogPage;
    };

    return { alepha, page, memory: alepha.inject(MemoryDestinationProvider) };
  };

  /**
   * A burst: every entry stamped with the same millisecond, which is what a
   * real one looks like. A dev boot logs dozens per millisecond, and the tail
   * used to cursor on the timestamp.
   */
  const burst = (memory: MemoryDestinationProvider, count: number) => {
    for (let i = 0; i < count; i++) {
      memory.write("", {
        level: "INFO",
        message: `burst ${i}`,
        service: "spec",
        module: "spec",
        timestamp: 1_700_000_000_000,
      });
    }
  };

  it("delivers a burst of 1000 same-millisecond entries in full", async ({
    expect,
  }) => {
    const { alepha, page, memory } = await boot();

    // The tail opens first, as it does in the browser: the burst has to be
    // caught while following, not read back out of history.
    const opened = await page();
    let cursor = opened.logs[0]?.seq;

    burst(memory, 1000);

    // Then drain exactly the way the hook does: ask from the cursor, take
    // whatever comes back, ask again while the server says there is more.
    const received: LogPage["logs"] = [];
    let rounds = 0;
    let hasMore = true;
    while (hasMore && rounds < 50) {
      const next = await page(cursor);
      received.push(...next.logs);
      for (const entry of next.logs) {
        if (cursor === undefined || entry.seq > cursor) cursor = entry.seq;
      }
      hasMore = next.hasMore;
      rounds++;
    }

    // Caught up, rather than stopped by the loop's own bound.
    expect(hasMore).toBe(false);

    const messages = received
      .map((e) => e.message)
      .filter((m) => m.startsWith("burst "));
    expect(messages).toHaveLength(1000);
    // Every one exactly once. A cursor that went backwards would pass the
    // length check by re-delivering.
    expect(new Set(messages).size).toBe(1000);

    // More than one page, so the assertion above really did exercise the
    // catch-up path rather than a single oversized response.
    expect(rounds).toBeGreaterThan(1);

    await alepha.stop();
  });

  it("keeps entries that share the newest millisecond", async ({ expect }) => {
    const { alepha, page, memory } = await boot();

    // Two entries, one millisecond, arriving in separate polls. This is the
    // half of the bug that had nothing to do with volume: the cursor was the
    // newest timestamp, so the second entry could never be above it.
    memory.write("", {
      level: "INFO",
      message: "twin a",
      service: "spec",
      module: "spec",
      timestamp: 1_700_000_000_000,
    });

    const first = await page(undefined, 500);
    const cursor = first.logs[0]?.seq;
    expect(first.logs.some((e) => e.message === "twin a")).toBe(true);

    memory.write("", {
      level: "INFO",
      message: "twin b",
      service: "spec",
      module: "spec",
      timestamp: 1_700_000_000_000,
    });

    const second = await page(cursor, 500);
    expect(second.logs.map((e) => e.message)).toContain("twin b");
    // And not a re-delivery of what the first page already showed.
    expect(second.logs.map((e) => e.message)).not.toContain("twin a");

    await alepha.stop();
  });

  it("reports what the buffer evicted, and only that", async ({ expect }) => {
    const { alepha, page, memory } = await boot();

    const quiet = await page();
    expect(quiet.dropped).toBe(0);

    // Past `maxEntries`, the ring drops the oldest 20%. That is real loss and
    // no amount of polling recovers it, so the tail says so.
    burst(memory, memory.options.maxEntries + 1);
    const overflowed = await page();
    expect(overflowed.dropped).toBeGreaterThan(0);

    await alepha.stop();
  });
});
