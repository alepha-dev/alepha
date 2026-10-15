import { Alepha } from "alepha";
import { describe, expect, it } from "vitest";

import { JsonFormatterProvider } from "../providers/JsonFormatterProvider.ts";
import type { LogEntry } from "../schemas/logEntrySchema.ts";

describe("JsonFormatterProvider", () => {
  const entry = (data: unknown): LogEntry => ({
    level: "ERROR",
    message: "boom",
    service: "Svc",
    module: "app",
    timestamp: 0,
    data,
  });

  it("expands a nested error instead of rendering it as {}", () => {
    const formatter = Alepha.create().inject(JsonFormatterProvider);

    const json = JSON.parse(
      formatter.format(entry({ error: new Error("nested"), jobId: 7 })),
    );

    expect(json.data.jobId).toBe(7);
    expect(json.data.error.message).toBe("nested");
    expect(json.data.error.stack).toContain("nested");
  });

  it("expands errors inside arrays and keeps other values intact", () => {
    const formatter = Alepha.create().inject(JsonFormatterProvider);

    const json = JSON.parse(
      formatter.format(entry({ errors: [new Error("a")], when: "now" })),
    );

    expect(json.data.errors[0].message).toBe("a");
    expect(json.data.when).toBe("now");
  });

  it("expands a shared object, Error included, in both places it appears", () => {
    const formatter = Alepha.create().inject(JsonFormatterProvider);
    const shared = { x: 1, e: new Error("boom") };

    const json = JSON.parse(formatter.format(entry({ a: shared, b: shared })));

    expect(json.data.a.e.message).toBe("boom");
    expect(json.data.b.x).toBe(1);
    expect(json.data.b.e.message).toBe("boom");
  });

  it("writes [Circular] at the cycle only, and keeps the rest of the data", () => {
    const formatter = Alepha.create().inject(JsonFormatterProvider);
    const cyclic: Record<string, unknown> = { name: "node" };
    cyclic.self = cyclic;

    const json = JSON.parse(formatter.format(entry({ ok: 1, c: cyclic })));

    expect(json.data.ok).toBe(1);
    expect(json.data.c.name).toBe("node");
    expect(json.data.c.self).toBe("[Circular]");
  });

  it("writes a cycle through an array as [Circular] too", () => {
    const formatter = Alepha.create().inject(JsonFormatterProvider);
    const list: unknown[] = [1];
    list.push(list);

    const json = JSON.parse(formatter.format(entry({ list })));

    expect(json.data.list).toEqual([1, "[Circular]"]);
  });

  it("serializes a BigInt as its decimal string instead of collapsing the entry", () => {
    const formatter = Alepha.create().inject(JsonFormatterProvider);

    const json = JSON.parse(
      formatter.format(entry({ ok: 1, big: 12345678901234567890n })),
    );

    expect(json.data.ok).toBe(1);
    expect(json.data.big).toBe("12345678901234567890");
  });
});
