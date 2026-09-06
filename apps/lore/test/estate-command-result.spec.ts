import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { estateCommandResultSchema } from "../src/api/schemas/estateCommandResultSchema.ts";

/**
 * The `logs` answer, pinned from the Lore side.
 *
 * `apps/bay/cmd/bay/testdata/logs-result.json` is what Bay's `logsResult`
 * marshals to; its own test asserts that. This one asserts the same bytes are
 * what Lore accepts, so neither half can move a field alone.
 *
 * The pair already drifted once, in the epic that introduced it: Lore's first
 * schema took `lines: string[]` while Bay sent objects plus three flags, so
 * every real upload would have been refused with a 400 and the flags would
 * have been stripped in silence. Nothing on either side was red - the Go test
 * used a fake sink that accepts anything, and the wire fixtures cover frames
 * rather than this payload. Hence this file.
 */
const FIXTURE = join(
  import.meta.dirname,
  "../../bay/cmd/bay/testdata/logs-result.json",
);

describe("The result a logs command uploads, shared with Bay", () => {
  const load = (): unknown => JSON.parse(readFileSync(FIXTURE, "utf8"));

  it("accepts exactly what Bay marshals, field for field", () => {
    const parsed = estateCommandResultSchema.parse(load());
    // Parsing strips nothing: the fixture is the whole payload.
    expect(parsed).toEqual(load());
  });

  it("keeps the three flags that tell an empty tail apart", () => {
    const parsed = estateCommandResultSchema.parse(load());
    // "No lines" sends an operator to three different places, and this is
    // where that distinction survives the wire.
    expect(parsed.supervised).toBe(true);
    expect(parsed.undated).toBe(1);
    expect(parsed.truncated).toBe(12);
  });

  it("keeps a line with no envelope, which is what a plain stdout writes", () => {
    const parsed = estateCommandResultSchema.parse(load());
    const plain = parsed.lines[1];
    expect(plain?.raw).toContain("no envelope");
    expect(plain?.at).toBeUndefined();
    expect(plain?.level).toBeUndefined();
  });

  it("refuses a tail past the caps the route stores", () => {
    expect(() =>
      estateCommandResultSchema.parse({
        supervised: true,
        lines: Array.from({ length: 2001 }, () => ({ raw: "x" })),
      }),
    ).toThrow();
    expect(() =>
      estateCommandResultSchema.parse({
        supervised: true,
        lines: [{ raw: "x".repeat(2001) }],
      }),
    ).toThrow();
    // `raw` is the one field always present: a line is what was written.
    expect(() =>
      estateCommandResultSchema.parse({
        supervised: true,
        lines: [{ text: "no raw" }],
      }),
    ).toThrow();
  });
});
