import { describe, expect, it } from "vitest";
import { bayAppSchema } from "../src/api/schemas/bayAppSchema.ts";

describe("bayAppSchema", () => {
  it("should carry the supervisor's usage reading through to the browser", () => {
    /*
      The response schema is what gets serialized, so a field it does not name
      is dropped on the way out.

      `usage` was added to the TypeScript interface, to the client type and to
      the component that renders it. Typecheck was green, the API answered 200,
      and the browser received a list with no usage in it — no error, nothing in
      a log, just a column that was silently always empty.
    */
    const parsed = bayAppSchema.parse({
      name: "demo",
      env: "production",
      domain: "demo.example.com",
      release: "2026-07-31-120000",
      port: 4000,
      runtime: "node",
      running: true,
      usage: {
        memoryBytes: 94371840,
        cpuSeconds: 12.5,
        tasks: 17,
        restarts: 2,
        startedAt: "2026-07-31T09:14:22Z",
        pid: 4213,
      },
    });

    expect(parsed.usage?.memoryBytes).toBe(94371840);
    expect(parsed.usage?.restarts).toBe(2);
    expect(parsed.usage?.startedAt).toBe("2026-07-31T09:14:22Z");
  });

  it("should accept an app the supervisor knows nothing about", () => {
    // An unsupervised child process in development, or an older bay-go. The
    // absence must not be an error, and must not become a zero.
    const parsed = bayAppSchema.parse({
      name: "demo",
      env: "production",
      domain: "demo.example.com",
      release: "2026-07-31-120000",
      port: 4000,
      runtime: "node",
    });

    expect(parsed.usage).toBeUndefined();
    expect(parsed.running).toBeUndefined();
  });
});
