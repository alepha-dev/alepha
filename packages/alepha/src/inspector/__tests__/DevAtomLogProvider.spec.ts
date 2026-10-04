import { $atom, Alepha, z } from "alepha";
import { describe, expect, it } from "vitest";

import { DevAtomLogProvider } from "../providers/DevAtomLogProvider.ts";

describe("DevAtomLogProvider", () => {
  it("does not buffer mutations of a serverOnly atom", async () => {
    const secretAtom = $atom({
      name: "test.devlog.secret",
      schema: z.string(),
      default: "s3cret",
      serverOnly: true,
    });
    const normalAtom = $atom({
      name: "test.devlog.normal",
      schema: z.string(),
      default: "initial",
    });

    const alepha = Alepha.create();
    const log = alepha.inject(DevAtomLogProvider);
    await alepha.start();

    // `set()` also registers the atom on first use (firing its own
    // registration `state:mutate`), so don't assert an exact count for the
    // normal atom — just that the serverOnly atom logs nothing at all, and
    // the normal atom's newest entry reflects the explicit mutation.
    alepha.store.set(secretAtom, "leaked?");
    alepha.store.set(normalAtom, "changed");
    await new Promise((r) => setTimeout(r, 0));

    expect(log.entries(secretAtom.key)).toHaveLength(0);
    const normalEntries = log.entries(normalAtom.key);
    expect(normalEntries.length).toBeGreaterThan(0);
    expect(normalEntries[0].value).toBe("changed");

    // A raw string state key with no registered atom must still be logged —
    // only *known* serverOnly atoms are skipped.
    alepha.store.set("test.devlog.raw" as any, "unregistered" as any);
    await new Promise((r) => setTimeout(r, 0));

    expect(log.entries("test.devlog.raw")).toHaveLength(1);
  });

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
