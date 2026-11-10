import { describe, expect, it } from "vitest";

import { ConventionRunner } from "../../services/ConventionRunner.ts";
import { checkFiles, lines } from "../fixtures/conventionHarness.ts";

const RULE = "no-error-class";

describe("no-error-class", () => {
  it("reports a superclass whose name ends in Error, whatever the class is called", async () => {
    const report = await checkFiles(
      {
        "src/errors.ts": [
          "export class NotFound extends Error {}",
          "export class Rollback extends HttpError {}",
          "export class Gone extends errors.NotFoundError {}",
          "export const Anonymous = class extends AlephaError {};",
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
    ]);
    expect(report.findings[0].fix).toContain("$error");
    expect(report.findings[0].fix).toContain(".extend");
  });

  it("does not report a class named ...Error whose superclass is not", async () => {
    const report = await checkFiles(
      {
        "src/a.ts": [
          "export class ParseError extends Base {}",
          "export class ErrorBoundary extends Component {}",
          "export class Plain {}",
          "",
        ].join("\n"),
      },
      RULE,
    );
    expect(report.findings).toEqual([]);
  });

  it("does not read a class in a string or a comment", async () => {
    const report = await checkFiles(
      {
        "src/a.ts": [
          'export const code = "class A extends Error {}";',
          "// class B extends HttpError {}",
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
          "// alepha-allow no-error-class: the root every $error extends",
          "export class DeclaredError extends Error {}",
          "// alepha-allow no-error-class:   ",
          "export class Other extends Error {}",
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

  it("leaves a spec's control-flow error class alone", async () => {
    const report = await checkFiles(
      { "src/a.spec.ts": "class Rollback extends Error {}\n" },
      RULE,
    );
    expect(report.findings).toEqual([]);
  });
});
