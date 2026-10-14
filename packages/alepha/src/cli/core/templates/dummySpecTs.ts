/**
 * Starter spec written by `alepha init`. It doubles as a worked example:
 * it shows the test location (`test/`), the `*.spec.ts` naming, and the
 * canonical Alepha entry point, `Alepha.create()` + `.inject(...)`, and the
 * `describe` + `it` shape. `vite.config.ts` turns on Vitest's globals, but
 * the scaffold's tsconfig carries no `vitest/globals` types, so the spec
 * imports them and typechecks as it stands.
 *
 * Tests run with `alepha test` (Vitest, embedded in alepha). Replace this
 * with real specs as the project grows.
 */
export const dummySpecTs = () =>
  `
import { Alepha } from "alepha";
import { describe, expect, it } from "vitest";

describe("alepha app", () => {
  it("can be created", () => {
    const alepha = Alepha.create();

    expect(alepha).toBeDefined();
    expect(alepha.inject).toBeTypeOf("function");
  });
});
`.trim() + "\n";
