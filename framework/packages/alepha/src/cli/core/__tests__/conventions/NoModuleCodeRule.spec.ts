import { describe, expect, it } from "vitest";

import { NoModuleCodeRule } from "../../conventions/NoModuleCodeRule.ts";
import { ConventionRunner } from "../../services/ConventionRunner.ts";
import { checkFiles, lines } from "../fixtures/conventionHarness.ts";

const RULE = "no-module-code";

/**
 * The shape a repository with more service-shaped directories registers.
 */
class WiderNoModuleCodeRule extends NoModuleCodeRule {
  protected override readonly directories = [
    ...new NoModuleCodeRule()["directories"],
    "commands",
    "tasks",
  ];
}

describe("no-module-code", () => {
  it("refuses a module-level const, let, var or function, exported or not", async () => {
    const report = await checkFiles(
      {
        "src/api/services/OrderService.ts": [
          "const TTL = 60;",
          "export let counter = 0;",
          "var legacy = 1;",
          "function helper() {}",
          "export async function load() {}",
          "export class OrderService {}",
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
    expect(report.findings[0].message).toContain("const TTL");
  });

  it("reads services, providers, controllers and jobs, at any depth", async () => {
    const report = await checkFiles(
      {
        "src/api/services/a.ts": "const a = 1;\n",
        "src/api/providers/b.ts": "const b = 1;\n",
        "src/api/controllers/c.ts": "const c = 1;\n",
        "src/api/jobs/d.ts": "const d = 1;\n",
        "src/api/orders/services/deep/e.ts": "const e = 1;\n",
      },
      RULE,
    );
    expect(report.findings).toHaveLength(5);
  });

  it("never reads schemas, entities, atoms, errors or other directories", async () => {
    const report = await checkFiles(
      {
        "src/api/schemas/orderSchema.ts": "export const orderSchema = 1;\n",
        "src/api/entities/orders.ts": "export const orders = 1;\n",
        "src/api/atoms/options.ts": "export const options = 1;\n",
        "src/api/errors/NotFound.ts": "export const NotFound = 1;\n",
        "src/web/components/Button.tsx": "export const Button = () => null;\n",
        "src/api/commands/build.ts": "const a = 1;\n",
      },
      RULE,
    );
    expect(report.findings).toEqual([]);
  });

  it("allows a second class, an enum, a type, an interface and declare const", async () => {
    const report = await checkFiles(
      {
        "src/api/services/a.ts": [
          "export class A {}",
          "class B {}",
          "export enum Kind { One }",
          "export type Id = string;",
          "export interface Options {}",
          "declare const VERSION: string;",
          "export class C { protected helper = () => 1; }",
          "",
        ].join("\n"),
      },
      RULE,
    );
    expect(report.findings).toEqual([]);
  });

  it("does not read declarations inside a string of generated code", async () => {
    const report = await checkFiles(
      {
        "src/api/services/a.ts":
          "export class A {\n  code = `\nconst x = 1;\nfunction f() {}\n`;\n}\n",
      },
      RULE,
    );
    expect(report.findings).toEqual([]);
  });

  it("honours an exemption with a reason, and reports one without", async () => {
    const report = await checkFiles(
      {
        "src/api/services/a.ts": [
          "// alepha-allow no-module-code: read by the bundler before any container exists",
          "export const marker = 1;",
          "// alepha-allow no-module-code",
          "export const other = 2;",
          "export class A {}",
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

  it("reads more directories through a subclass that extends the list", async () => {
    const report = await checkFiles(
      {
        "src/cli/commands/build.ts": "const a = 1;\n",
        "src/cli/tasks/BuildTask.ts": "const b = 1;\n",
      },
      RULE,
      (alepha) =>
        alepha.with({ provide: NoModuleCodeRule, use: WiderNoModuleCodeRule }),
    );
    expect(report.findings).toHaveLength(2);
  });
});
