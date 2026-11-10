import { describe, expect, it } from "vitest";

import { ConventionRunner } from "../../services/ConventionRunner.ts";
import { checkFiles, lines } from "../fixtures/conventionHarness.ts";

const RULE = "no-bare-error";

describe("no-bare-error", () => {
  it("reports throw new Error, throw Error and Promise.reject(new Error)", async () => {
    const report = await checkFiles(
      {
        "src/a.ts": [
          'export const a = () => { throw new Error("a"); };',
          'export const b = () => { throw Error("b"); };',
          'export const c = () => Promise.reject(new Error("c"));',
          "",
        ].join("\n"),
      },
      RULE,
    );
    expect(lines(report)).toEqual([
      [1, RULE],
      [2, RULE],
      [3, RULE],
    ]);
  });

  it("does not report the other built-in errors, or an Error that is not thrown", async () => {
    const report = await checkFiles(
      {
        "src/a.ts": [
          'export const a = () => { throw new TypeError("a"); };',
          'export const b = () => { throw new RangeError("b"); };',
          'export const c = new Error("kept, not thrown");',
          'export const d = () => Promise.reject(new AlephaError("d"));',
          "",
        ].join("\n"),
      },
      RULE,
    );
    expect(report.findings).toEqual([]);
  });

  it("does not read generated code in a string, or a comment", async () => {
    // The shape `BuildServerTask` emits into a bundle: code as a string.
    const report = await checkFiles(
      {
        "src/a.ts": [
          'export const code = `throw new Error("in the bundle")`;',
          "// throw new Error(...) is what this avoids",
          "",
        ].join("\n"),
      },
      RULE,
    );
    expect(report.findings).toEqual([]);
  });

  it("honours an exemption with a reason, and reports one without", async () => {
    const report = await checkFiles(
      {
        "src/a.ts": [
          "export const a = () => {",
          "  // alepha-allow no-bare-error: runs before the container exists",
          '  throw new Error("a");',
          "};",
          "export const b = () => {",
          "  // alepha-allow no-bare-error:",
          '  throw new Error("b");',
          "};",
          "",
        ].join("\n"),
      },
      RULE,
    );
    expect(lines(report)).toEqual([
      [6, ConventionRunner.ENGINE_IDS.noReason],
      [7, RULE],
    ]);
  });

  it("leaves tests alone", async () => {
    const report = await checkFiles(
      {
        "src/a.spec.ts": 'throw new Error("a");\n',
        "test/b.ts": 'throw new Error("b");\n',
      },
      RULE,
    );
    expect(report.findings).toEqual([]);
  });
});
