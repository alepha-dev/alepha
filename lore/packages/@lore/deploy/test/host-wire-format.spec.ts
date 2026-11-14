import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  hostClientFrameSchema,
  hostServerFrameSchema,
} from "../src/schemas/index.ts";

/**
 * Wire format v1, pinned from the Lore side.
 *
 * Bay's `internal/connector/testdata/wire-v1` (github.com/alepha-dev/bay)
 * holds one frame of each kind, copied in `fixtures/bay/wire-v1`. The Go suite proves its structs read and write exactly those bytes;
 * this spec proves the same files validate against the `$channel` schemas
 * that are the format's source of truth. Both suites read the same frames,
 * copied in step since Bay left the monorepo (#E72), so neither side can move
 * the vocabulary without the copy, and then the other suite, going red. Folio #1198 is the readable copy.
 */
const FIXTURES = join(import.meta.dirname, "fixtures/bay/wire-v1");

const SERVER_FRAMES = [
  "welcome.json",
  "config.json",
  "command-restart.json",
  "command-deploy.json",
  "command-stop.json",
  "command-start.json",
  "command-backup.json",
  "command-logs.json",
  "command-restore.json",
  "command-backup-policy.json",
  "command-remove.json",
  "query.json",
];

const CLIENT_FRAMES = [
  "hello.json",
  "ack-running.json",
  "ack-done.json",
  "ack-deploy-done.json",
  "ack-failed.json",
  "stats.json",
  "inventory.json",
  "event.json",
];

const load = (name: string): unknown =>
  JSON.parse(readFileSync(join(FIXTURES, name), "utf8"));

describe("Host wire format v1, shared with Bay", () => {
  it("holds exactly the frames both suites pin, and nothing unnamed", () => {
    const names = readdirSync(FIXTURES).sort();
    expect(names).toEqual([...SERVER_FRAMES, ...CLIENT_FRAMES].sort());
  });

  for (const name of SERVER_FRAMES) {
    it(`emits ${name} as a frame Lore sends`, () => {
      const parsed = hostServerFrameSchema.parse(load(name));
      // Parsing strips nothing: the fixture is the whole frame.
      expect(parsed).toEqual(load(name));
    });
  }

  for (const name of CLIENT_FRAMES) {
    it(`accepts ${name} as a frame Bay sends`, () => {
      const parsed = hostClientFrameSchema.parse(load(name));
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
    expect(hostClientFrameSchema.parse({ ...frame, host: {} })).toBeDefined();
    expect(
      hostClientFrameSchema.parse({ ...frame, host: { cores: 2 } }),
    ).toBeDefined();
  });

  it("bounds what a machine may push into the row", () => {
    const frame = load("inventory.json") as Record<string, unknown>;
    const app = (frame.apps as Record<string, unknown>[])[0];
    // A host with 500 instances is a bug or an attack, not a page.
    expect(() =>
      hostClientFrameSchema.parse({
        ...frame,
        apps: Array.from({ length: 201 }, () => app),
      }),
    ).toThrow();
    expect(() =>
      hostClientFrameSchema.parse({
        ...frame,
        apps: [{ ...app, problems: Array.from({ length: 11 }, () => "x") }],
      }),
    ).toThrow();
    expect(() =>
      hostClientFrameSchema.parse({
        ...frame,
        apps: [{ ...app, domains: Array.from({ length: 21 }, () => "a.dev") }],
      }),
    ).toThrow();
    expect(() =>
      hostClientFrameSchema.parse({
        ...frame,
        apps: [{ ...app, lastBackupError: "x".repeat(2001) }],
      }),
    ).toThrow();
    // Refused rather than clamped: a negative byte count is a broken reading,
    // and storing a zero for it would be inventing a measurement.
    expect(() =>
      hostClientFrameSchema.parse({ ...frame, host: { memTotalBytes: -1 } }),
    ).toThrow();
    expect(() =>
      hostClientFrameSchema.parse({ ...frame, host: { load1: -0.1 } }),
    ).toThrow();
  });

  it("refuses an ack past the limits Bay cuts to", () => {
    const ack = load("ack-failed.json") as Record<string, unknown>;
    expect(() =>
      hostClientFrameSchema.parse({ ...ack, reason: "x".repeat(2001) }),
    ).toThrow();
    expect(() =>
      hostClientFrameSchema.parse({ ...ack, step: "x".repeat(33) }),
    ).toThrow();
    // At the limit, which is where Bay's NewAck stops.
    expect(
      hostClientFrameSchema.parse({
        ...ack,
        reason: "x".repeat(2000),
        step: "x".repeat(32),
      }),
    ).toBeDefined();
  });
});
