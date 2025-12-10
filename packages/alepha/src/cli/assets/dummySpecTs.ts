export const dummySpecTs = () => `
import { test, expect } from "vitest";

test("dummy test", () => {
  expect(1 + 1).toBe(2);
});
`.trim();
