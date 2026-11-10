import { describe, expect, it } from "vitest";

import { ConventionRunner } from "../../services/ConventionRunner.ts";
import { checkFiles, lines } from "../fixtures/conventionHarness.ts";

const RULE = "no-zod-import";

describe("no-zod-import", () => {
  it("reports zod and zod/* in import, export-from, import() and require", async () => {
    const report = await checkFiles(
      {
        "src/a.ts": [
          'import { z } from "zod";',
          'import type { ZodType } from "zod/v4";',
          'export * from "zod";',
          'export const lazy = () => import("zod/mini");',
          'export const required = require("zod");',
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
  });

  it("does not report alepha's z, a package merely named like zod, or a string", async () => {
    const report = await checkFiles(
      {
        "src/a.ts": [
          'import { z } from "alepha";',
          'import { x } from "zod-to-json-schema";',
          'import { y } from "@acme/zod";',
          'export const doc = "import { z } from \\"zod\\"";',
          '// import { z } from "zod";',
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
          "// alepha-allow no-zod-import: the adapter that wraps zod for alepha",
          'import { z as zod } from "zod";',
          "// alepha-allow no-zod-import",
          'import { ZodType } from "zod";',
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

  it("leaves tests alone", async () => {
    const report = await checkFiles(
      { "test/a.ts": 'import { z } from "zod";\n' },
      RULE,
    );
    expect(report.findings).toEqual([]);
  });
});
