import { Alepha } from "alepha";
import { describe, expect, it } from "vitest";

/**
 * `alepha.meta` under vitest, where no build ever ran.
 *
 * This is the fallback path, and it is the one most likely to be wrong in a
 * way nothing notices: the build token is replaced by a transform, so any
 * runtime that never went through `alepha build` or `alepha dev` reads the
 * constant below instead. An unreplaced bare identifier throws `ReferenceError`
 * rather than evaluating to `undefined`, which is why the read is guarded by
 * `typeof` and why this test exists at all.
 */
describe("Alepha.meta", () => {
  it("should fall back to a known record when no build produced this code", () => {
    const alepha = Alepha.create();

    expect(alepha.meta).toEqual({
      name: "unknown",
      version: "latest",
      framework: "unknown",
      build: {
        runtime: "node",
        dev: true,
      },
    });
  });

  it("should omit build.date rather than invent one, because nothing built this", () => {
    const alepha = Alepha.create();

    // Absence is the signal: no `date` means no build produced this code.
    // A placeholder string here would be indistinguishable from a real build.
    expect(alepha.meta.build.date).toBeUndefined();
  });

  it('should omit commit rather than report "unknown"', () => {
    const alepha = Alepha.create();

    expect(alepha.meta.commit).toBeUndefined();
  });
});
