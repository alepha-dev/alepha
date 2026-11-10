import { describe, expect, it } from "vitest";

import { ConventionRunner } from "../../services/ConventionRunner.ts";
import { checkFiles, lines } from "../fixtures/conventionHarness.ts";

const RULE = "no-date-now";

describe("no-date-now", () => {
  it("reports Date.now() and globalThis.Date.now()", async () => {
    const report = await checkFiles(
      {
        "src/a.ts": [
          "export const a = Date.now();",
          "export const b = globalThis.Date.now();",
          "",
        ].join("\n"),
      },
      RULE,
    );
    expect(lines(report)).toEqual([
      [1, RULE],
      [2, RULE],
    ]);
  });

  it("never reports new Date(), a destructured now or Date['now']", async () => {
    const report = await checkFiles(
      {
        "src/a.ts": [
          "export const a = new Date();",
          "const { now } = Date;",
          "export const b = now();",
          'export const c = Date["now"]();',
          "",
        ].join("\n"),
      },
      RULE,
    );
    expect(report.findings).toEqual([]);
  });

  it("does not read the call inside a string or a comment", async () => {
    const report = await checkFiles(
      {
        "src/a.ts": [
          'export const doc = "never Date.now()";',
          "export const tpl = `Date.now()`;",
          "// Date.now() would not travel",
          "/* Date.now() */",
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
          "// alepha-allow no-date-now: a DOM id, never persisted",
          "export const a = Date.now();",
          "// alepha-allow no-date-now",
          "export const b = Date.now();",
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

  it("leaves spec files, test trees and fixtures alone", async () => {
    const report = await checkFiles(
      {
        "src/a.spec.ts": "Date.now();\n",
        "src/__tests__/b.ts": "Date.now();\n",
        "test/c.ts": "Date.now();\n",
        "e2e/d.ts": "Date.now();\n",
        "src/fixtures/e.ts": "Date.now();\n",
      },
      RULE,
    );
    expect(report.findings).toEqual([]);
  });
});
