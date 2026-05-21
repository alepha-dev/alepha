/**
 * Starter spec written by `alepha init`. It doubles as a worked example:
 * it shows the test location (`test/`), the `*.spec.ts` naming, and the
 * canonical Alepha entry point — `Alepha.create()` + `.inject(...)`.
 *
 * Tests run with `alepha test` (Vitest, embedded in alepha). Replace this
 * with real specs as the project grows.
 */
export const dummySpecTs = () =>
  `
import { Alepha } from "alepha";
import { expect, test } from "vitest";

test("alepha app can be created", () => {
  const alepha = Alepha.create();

  expect(alepha).toBeDefined();
  expect(alepha.inject).toBeTypeOf("function");
});
`.trim();
