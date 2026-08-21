import { describe, expect, it } from "vitest";

import { SigilQueue } from "../SigilQueue.ts";

describe("SigilQueue", () => {
  it("batches all kinds into one flush and drains", async () => {
    const sent: any[] = [];
    const q = new SigilQueue(
      async (env) => {
        sent.push(env);
      },
      { debounceMs: 5 },
    );
    q.addView("/a", 1_700_000_000_000);
    q.addError({ name: "E", message: "m", stack: "s", sourceUrl: "u" });
    q.addVital({
      path: "/a",
      metric: "lcp",
      value: 1234,
      ts: 1_700_000_000_000,
    });
    await q.flush();
    expect(sent).toHaveLength(1);
    expect(sent[0].views[0].path).toBe("/a");
    expect(sent[0].views[0].ts).toBe(1_700_000_000_000);
    expect(sent[0].errors[0].name).toBe("E");
    expect(sent[0].vitals[0].metric).toBe("lcp");
    await q.flush();
    expect(sent).toHaveLength(1); // drained, no second send
  });

  it("does not send an empty flush", async () => {
    const sent: any[] = [];
    const q = new SigilQueue(
      async (env) => {
        sent.push(env);
      },
      { debounceMs: 5 },
    );
    await q.flush();
    expect(sent).toHaveLength(0);
  });

  it("caps each kind to its max", async () => {
    const sent: any[] = [];
    const q = new SigilQueue(
      async (env) => {
        sent.push(env);
      },
      { debounceMs: 5 },
    );
    for (let i = 0; i < 100; i++) q.addView("/" + i, 1_700_000_000_000 + i);
    await q.flush();
    expect(sent[0].views.length).toBe(50); // cap
  });
});

describe("SigilQueue — a config that arrives after the queue was filled", () => {
  /**
   * The race this closes: a page served from a file or a cache gates its first
   * events against a config older than the visit, so vitals are queued before
   * the real answer arrives. Without this they still go out — on a flush that
   * happens *after* the sink has said it does not want them.
   */
  it("drops queued items for trackers that were switched off", async () => {
    const sent: any[] = [];
    const queue = new SigilQueue(async (env) => {
      sent.push(env);
    });

    queue.addView("/", 1);
    queue.addVital({ path: "/", metric: "ttfb", value: 78, ts: 1 });

    queue.dropDisabled({ views: true, errors: true, vitals: false });
    await queue.flush();

    expect(sent).toHaveLength(1);
    expect(sent[0].views).toHaveLength(1);
    expect(sent[0].vitals).toBeUndefined();
  });

  it("sends nothing at all when everything queued was switched off", async () => {
    const sent: any[] = [];
    const queue = new SigilQueue(async (env) => {
      sent.push(env);
    });

    queue.addVital({ path: "/", metric: "lcp", value: 900, ts: 1 });
    queue.dropDisabled({ views: true, errors: true, vitals: false });
    await queue.flush();

    expect(sent).toHaveLength(0);
  });

  it("leaves a queue alone when nothing was switched off", async () => {
    const sent: any[] = [];
    const queue = new SigilQueue(async (env) => {
      sent.push(env);
    });

    queue.addVital({ path: "/", metric: "ttfb", value: 78, ts: 1 });
    queue.dropDisabled({ views: true, errors: true, vitals: true });
    await queue.flush();

    expect(sent[0].vitals).toHaveLength(1);
  });
});

/**
 * The hold exists because a page load's producers do not finish together: the
 * view lands at hydration, TTFB and FCP a beat later, and the engagement
 * verdict only after the visitor has had time to give one. A debounce armed by
 * the first of them sends before the last has spoken.
 */
describe("SigilQueue — holding the opening envelope", () => {
  it("suspends the debounce and sends everything on release", async () => {
    const sent: any[] = [];
    const q = new SigilQueue(
      async (env) => {
        sent.push(env);
      },
      { debounceMs: 5 },
    );

    q.hold();
    q.addView("/", 1);
    q.addVital({ path: "/", metric: "fcp", value: 260, ts: 1 });
    await new Promise((r) => setTimeout(r, 25));

    // Well past the debounce, and nothing has left.
    expect(sent).toHaveLength(0);
    expect(q.isHeld()).toBe(true);

    q.addEngagement("/", 2);
    await q.release();

    expect(sent).toHaveLength(1);
    expect(sent[0].views).toHaveLength(1);
    expect(sent[0].vitals).toHaveLength(1);
    expect(sent[0].engagements).toHaveLength(1);
    expect(q.isHeld()).toBe(false);
  });

  /**
   * A caller may hold before or after the first event of the load is queued -
   * the render hook queues the view a line later, but a vital can arrive from
   * a buffered PerformanceObserver entry before the hook runs at all.
   */
  it("cancels a debounce that was already armed", async () => {
    const sent: any[] = [];
    const q = new SigilQueue(
      async (env) => {
        sent.push(env);
      },
      { debounceMs: 5 },
    );

    q.addVital({ path: "/", metric: "ttfb", value: 51, ts: 1 });
    q.hold();
    await new Promise((r) => setTimeout(r, 25));

    expect(sent).toHaveLength(0);
  });

  /**
   * The hold suspends the timer, not the queue. `pagehide` and
   * `visibilitychange` flush directly, and a visitor who leaves mid-hold has
   * still visited.
   */
  it("still sends on an explicit flush while held", async () => {
    const sent: any[] = [];
    const q = new SigilQueue(
      async (env) => {
        sent.push(env);
      },
      { debounceMs: 5 },
    );

    q.hold();
    q.addView("/", 1);
    await q.flush();

    expect(sent).toHaveLength(1);
    expect(sent[0].views).toHaveLength(1);
  });

  /**
   * Released with nothing to say, a page says nothing. Only the wait that had
   * something to ask forces an empty envelope.
   */
  it("sends nothing on an unforced release of an empty queue", async () => {
    const sent: any[] = [];
    const q = new SigilQueue(
      async (env) => {
        sent.push(env);
      },
      { debounceMs: 5 },
    );

    q.hold();
    await q.release();
    expect(sent).toHaveLength(0);

    q.hold();
    await q.release({ force: true });
    expect(sent).toHaveLength(1);
    expect(sent[0]).toEqual({});
  });

  it("returns to the ordinary debounce after a release", async () => {
    const sent: any[] = [];
    const q = new SigilQueue(
      async (env) => {
        sent.push(env);
      },
      { debounceMs: 5 },
    );

    q.hold();
    await q.release();

    q.addEngagement("/", 3);
    await new Promise((r) => setTimeout(r, 25));

    expect(sent).toHaveLength(1);
    expect(sent[0].engagements).toHaveLength(1);
  });
});
