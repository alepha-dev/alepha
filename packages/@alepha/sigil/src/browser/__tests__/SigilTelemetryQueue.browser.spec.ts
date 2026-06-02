import { describe, expect, it } from "vitest";
import { SigilTelemetryQueue } from "../SigilTelemetryQueue.ts";

describe("SigilTelemetryQueue", () => {
  it("batches all kinds into one flush and drains", async () => {
    const sent: any[] = [];
    const q = new SigilTelemetryQueue(async (env) => { sent.push(env); }, { debounceMs: 5 });
    q.addView("/a");
    q.addError({ name: "E", message: "m", stack: "s", sourceUrl: "u" });
    q.addVital({ path: "/a", metric: "lcp", value: 1234 });
    await q.flush();
    expect(sent).toHaveLength(1);
    expect(sent[0].views[0].path).toBe("/a");
    expect(sent[0].errors[0].name).toBe("E");
    expect(sent[0].vitals[0].metric).toBe("lcp");
    await q.flush();
    expect(sent).toHaveLength(1); // drained, no second send
  });

  it("does not send an empty flush", async () => {
    const sent: any[] = [];
    const q = new SigilTelemetryQueue(async (env) => { sent.push(env); }, { debounceMs: 5 });
    await q.flush();
    expect(sent).toHaveLength(0);
  });

  it("caps each kind to its max", async () => {
    const sent: any[] = [];
    const q = new SigilTelemetryQueue(async (env) => { sent.push(env); }, { debounceMs: 5 });
    for (let i = 0; i < 100; i++) q.addView("/" + i);
    await q.flush();
    expect(sent[0].views.length).toBe(50); // cap
  });
});
