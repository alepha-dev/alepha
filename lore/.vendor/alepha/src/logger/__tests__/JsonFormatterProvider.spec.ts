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
});
