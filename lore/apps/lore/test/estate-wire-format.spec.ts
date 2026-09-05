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
];

const CLIENT_FRAMES = [
  "hello.json",
  "ack-running.json",
  "ack-done.json",
  "ack-failed.json",
  "stats.json",
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
