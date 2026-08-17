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
