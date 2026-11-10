import { describe, expect, it } from "vitest";

import { ConventionRunner } from "../../services/ConventionRunner.ts";
import { checkFiles, lines } from "../fixtures/conventionHarness.ts";

const RULE = "describe-it";

describe("describe-it", () => {
  it("refuses a bare top-level test or it, modifiers included", async () => {
    const report = await checkFiles(
      {
        "test/a.spec.ts": [
          'test("a", () => {});',
          'it("b", () => {});',
          'it.skip("c", () => {});',
          'test.each([1, 2])("d %s", () => {});',
          'it.only.each([1])("e", () => {});',
          "for (const name of names) {",
          "  it(name, () => {});",
          "}",
          "",
        ].join("\n"),
      },
      RULE,
    );
    expect(lines(report)).toEqual([
      [1, RULE],
      [2, RULE],
      [3, RULE],
      [4, RULE],
      [5, RULE],
      [7, RULE],
    ]);
  });

  it("accepts cases inside a describe, at any depth, and in a shared-cases helper", async () => {
    const report = await checkFiles(
      {
        "test/a.spec.ts": [
          'describe("unit", () => {',
          '  it("a", () => {});',
          '  describe.each([1])("nested %s", () => {',
          '    test("b", () => {});',
          "  });",
          "});",
          "const sharedCases = () => {",
          '  it("c", () => {});',
          "};",
          'describe("other", () => sharedCases());',
          "",
        ].join("\n"),
      },
      RULE,
    );
    expect(report.findings).toEqual([]);
  });

  it("does not read a case inside a string or a comment", async () => {
    const report = await checkFiles(
      {
        "test/a.spec.ts": [
          'describe("x", () => {});',
          'const doc = `it("a", () => {})`;',
          '// it("b", () => {});',
          "",
        ].join("\n"),
      },
      RULE,
    );
    expect(report.findings).toEqual([]);
  });

  it("exempts Playwright files by path and by import", async () => {
    const report = await checkFiles(
      {
        "e2e/home.spec.ts": 'test("home", async () => {});\n',
        "apps/web/home.e2e.ts": 'test("home", async () => {});\n',
        "test/visual.spec.ts":
          'import { test } from "@playwright/test";\ntest("visual", async () => {});\n',
      },
      RULE,
    );
    expect(report.findings).toEqual([]);
  });

  it("honours an exemption with a reason, and reports one without", async () => {
    const report = await checkFiles(
      {
        "test/a.spec.ts": [
          "// alepha-allow describe-it: a one-case smoke file run on its own",
          'it("a", () => {});',
          "// alepha-allow describe-it",
          'it("b", () => {});',
          "",
        ].join("\n"),
      },
      RULE,
    );
    expect(lines(report)).toEqual([
      [3, ConventionRunner.ENGINE_IDS.noReason],
      [4, RULE],
    ]);
  });

  it("reads spec files only", async () => {
    const report = await checkFiles(
      {
        "src/a.ts": 'it("a", () => {});\n',
        "test/helpers.ts": 'it("b", () => {});\n',
      },
      RULE,
    );
    expect(report.findings).toEqual([]);
  });
});
