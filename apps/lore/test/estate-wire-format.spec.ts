import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { estateClientFrameSchema } from "../src/api/schemas/estateClientFrameSchema.ts";
import { estateServerFrameSchema } from "../src/api/schemas/estateServerFrameSchema.ts";

/**
 * Wire format v1, pinned from the Lore side.
 *
 * `apps/bay/internal/connector/testdata/wire-v1` holds one frame of each
 * kind. The Go suite proves its structs read and write exactly those bytes;
 * this spec proves the same files validate against the `$channel` schemas
 * that are the format's source of truth. Both suites read one set of
 * fixtures, so neither side can move the vocabulary without the other going
 * red. Folio #1198 is the readable copy.
 */
const FIXTURES = join(
  import.meta.dirname,
  "../../bay/internal/connector/testdata/wire-v1",
);

const SERVER_FRAMES = [
  "welcome.json",
  "config.json",
  "command-restart.json",
  "command-deploy.json",
  "command-stop.json",
  "command-start.json",
  "command-backup.json",
  "query.json",
];

const CLIENT_FRAMES = [
  "hello.json",
  "ack-running.json",
  "ack-done.json",
  "ack-failed.json",
  "stats.json",
  "inventory.json",
];

const load = (name: string): unknown =>
  JSON.parse(readFileSync(join(FIXTURES, name), "utf8"));

describe("Estate wire format v1, shared with Bay", () => {
  it("holds exactly the frames both suites pin, and nothing unnamed", () => {
    const names = readdirSync(FIXTURES).sort();
    expect(names).toEqual([...SERVER_FRAMES, ...CLIENT_FRAMES].sort());
  });

  for (const name of SERVER_FRAMES) {
    it(`emits ${name} as a frame Lore sends`, () => {
      const parsed = estateServerFrameSchema.parse(load(name));
      // Parsing strips nothing: the fixture is the whole frame.
      expect(parsed).toEqual(load(name));
    });
  }

  for (const name of CLIENT_FRAMES) {
    it(`accepts ${name} as a frame Bay sends`, () => {
      const parsed = estateClientFrameSchema.parse(load(name));
      expect(parsed).toEqual(load(name));
    });
  }

  /**
   * The inventory's optionality is the point, not an oversight: Bay reads
   * each host fact independently and degrades one unreadable `/proc` file to
   * an absent field. A required field here would turn a container without
   * `/proc/loadavg` into a machine that reports nothing at all.
   */
  it("accepts an inventory whose host reported almost nothing", () => {
    const frame = load("inventory.json") as Record<string, unknown>;
    expect(estateClientFrameSchema.parse({ ...frame, host: {} })).toBeDefined();
    expect(
      estateClientFrameSchema.parse({ ...frame, host: { cores: 2 } }),
    ).toBeDefined();
  });

  it("bounds what a machine may push into the row", () => {
    const frame = load("inventory.json") as Record<string, unknown>;
    const app = (frame.apps as Record<string, unknown>[])[0];
    // A host with 500 instances is a bug or an attack, not a page.
    expect(() =>
      estateClientFrameSchema.parse({
        ...frame,
        apps: Array.from({ length: 201 }, () => app),
      }),
    ).toThrow();
    expect(() =>
      estateClientFrameSchema.parse({
        ...frame,
        apps: [{ ...app, problems: Array.from({ length: 11 }, () => "x") }],
      }),
    ).toThrow();
    expect(() =>
      estateClientFrameSchema.parse({
        ...frame,
        apps: [{ ...app, domains: Array.from({ length: 21 }, () => "a.dev") }],
      }),
    ).toThrow();
    expect(() =>
      estateClientFrameSchema.parse({
        ...frame,
        apps: [{ ...app, lastBackupError: "x".repeat(2001) }],
      }),
    ).toThrow();
    // Refused rather than clamped: a negative byte count is a broken reading,
    // and storing a zero for it would be inventing a measurement.
    expect(() =>
      estateClientFrameSchema.parse({ ...frame, host: { memTotalBytes: -1 } }),
    ).toThrow();
    expect(() =>
      estateClientFrameSchema.parse({ ...frame, host: { load1: -0.1 } }),
    ).toThrow();
  });

  it("refuses an ack past the limits Bay cuts to", () => {
    const ack = load("ack-failed.json") as Record<string, unknown>;
    expect(() =>
      estateClientFrameSchema.parse({ ...ack, reason: "x".repeat(2001) }),
    ).toThrow();
    expect(() =>
      estateClientFrameSchema.parse({ ...ack, step: "x".repeat(33) }),
    ).toThrow();
    // At the limit, which is where Bay's NewAck stops.
    expect(
      estateClientFrameSchema.parse({
        ...ack,
        reason: "x".repeat(2000),
        step: "x".repeat(32),
      }),
    ).toBeDefined();
  });
});
