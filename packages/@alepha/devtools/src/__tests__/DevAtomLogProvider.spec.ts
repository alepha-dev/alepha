import { Alepha } from "alepha";
import { describe, expect, it } from "vitest";
import { DevAtomLogProvider } from "../providers/DevAtomLogProvider.ts";

describe("DevAtomLogProvider", () => {
  it("records state mutations, newest first", async () => {
    const alepha = Alepha.create();
    const log = alepha.inject(DevAtomLogProvider);
    await alepha.start();

    alepha.store.set("test.devlog.a" as any, 1 as any);
    alepha.store.set("test.devlog.a" as any, 2 as any);
    await new Promise((r) => setTimeout(r, 0));

    const entries = log.entries("test.devlog.a");
    expect(entries).toHaveLength(2);
    expect(entries[0].value).toBe(2);
    expect(entries[0].prevValue).toBe(1);
    expect(entries[1].value).toBe(1);
  });

  it("filters by key", async () => {
    const alepha = Alepha.create();
    const log = alepha.inject(DevAtomLogProvider);
    await alepha.start();

    alepha.store.set("test.devlog.x" as any, 1 as any);
    alepha.store.set("test.devlog.y" as any, 1 as any);
    await new Promise((r) => setTimeout(r, 0));

    expect(log.entries("test.devlog.x")).toHaveLength(1);
    expect(log.entries().length).toBeGreaterThanOrEqual(2);
  });

  it("caps the buffer at 200 entries", async () => {
    const alepha = Alepha.create();
    const log = alepha.inject(DevAtomLogProvider);
    await alepha.start();

    for (let i = 0; i < 250; i++) {
      alepha.store.set("test.devlog.cap" as any, i as any);
    }
    await new Promise((r) => setTimeout(r, 0));

    expect(log.entries().length).toBeLessThanOrEqual(200);
  });
});
