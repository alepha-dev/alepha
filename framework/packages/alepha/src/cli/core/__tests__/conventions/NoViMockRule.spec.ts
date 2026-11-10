import { describe, expect, it } from "vitest";

import { ConventionRunner } from "../../services/ConventionRunner.ts";
import { checkFiles, lines } from "../fixtures/conventionHarness.ts";

const RULE = "no-vi-mock";

describe("no-vi-mock", () => {
  it("refuses mock, doMock, spyOn, useFakeTimers and setSystemTime", async () => {
    const report = await checkFiles(
      {
        "src/a.spec.ts": [
          'vi.mock("./db.ts");',
          'vi.doMock("./db.ts");',
          'vi.spyOn(service, "send");',
          "vi.useFakeTimers();",
          "vi.setSystemTime(new Date(0));",
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
    ]);
    expect(report.findings[2].message).toContain("vi.spyOn()");
  });

  it("allows fn, stubGlobal, stubEnv and useRealTimers", async () => {
    const report = await checkFiles(
      {
        "src/a.spec.ts": [
          "const onClick = vi.fn();",
          'vi.stubGlobal("open", vi.fn());',
          'vi.stubEnv("NODE_ENV", "test");',
          "vi.useRealTimers();",
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
        "src/a.spec.ts": [
          'const doc = "vi.mock(x)";',
          "// never vi.spyOn(service)",
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
        "src/a.spec.ts": [
          "// alepha-allow no-vi-mock: records the real driver's statements, mocks nothing",
          'const prepare = vi.spyOn(sqlite, "prepare");',
          "// alepha-allow no-vi-mock",
          "vi.useFakeTimers();",
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

  it("reads test code only", async () => {
    const report = await checkFiles(
      {
        "src/a.ts": "vi.mock('./x');\n",
        "src/__tests__/helper.ts": "vi.useFakeTimers();\n",
        "test/b.spec.tsx": "vi.useFakeTimers();\n",
      },
      RULE,
    );
    expect(report.findings.map((f) => f.file)).toEqual([
      "src/__tests__/helper.ts",
      "test/b.spec.tsx",
    ]);
  });
});
