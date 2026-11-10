import { Alepha, AlephaError } from "alepha";
import { FileSystemProvider, MemoryFileSystemProvider } from "alepha/system";
import { describe, expect, it } from "vitest";

import { checkOptions } from "../atoms/checkOptions.ts";
import {
  type ConventionFile,
  ConventionRule,
  type ConventionRuleFinding,
} from "../conventions/ConventionRule.ts";
import { NoDateNowRule } from "../conventions/NoDateNowRule.ts";
import { AlephaCliServices } from "../index.ts";
import { ConventionRegistry } from "../services/ConventionRegistry.ts";
import { ConventionRunner } from "../services/ConventionRunner.ts";

/**
 * A second rule, so that narrowing a run has something to leave out: it
 * reports every `debugger` statement.
 */
class NoDebuggerRule extends ConventionRule {
  public readonly id = "no-debugger";
  public readonly description = "A debugger statement.";
  public readonly fix = "Delete it.";

  public appliesTo(): boolean {
    return true;
  }

  public check(file: ConventionFile, program: any): ConventionRuleFinding[] {
    const found: ConventionRuleFinding[] = [];
    this.walk(program, (node) => {
      if (node.type === "DebuggerStatement") {
        found.push(this.at(file, node));
      }
    });
    return found;
  }
}

class TestRegistry extends ConventionRegistry {
  protected override readonly rules: ConventionRule[] = [
    new NoDateNowRule(),
    new NoDebuggerRule(),
  ];
}

describe("ConventionRunner", () => {
  const create = async (files: Record<string, string>) => {
    const alepha = Alepha.create({ env: { LOG_LEVEL: "error" } })
      .with({ provide: FileSystemProvider, use: MemoryFileSystemProvider })
      .with({ provide: ConventionRegistry, use: TestRegistry });
    const fs = alepha.inject(MemoryFileSystemProvider);
    for (const [path, content] of Object.entries(files)) {
      const absolute = `/app/${path}`;
      await fs.mkdir(absolute.slice(0, absolute.lastIndexOf("/")), {
        recursive: true,
      });
      await fs.writeFile(absolute, content);
    }
    return { alepha, runner: alepha.inject(ConventionRunner) };
  };

  describe("the walk", () => {
    it("starts at the root, so test/ beside src/ is read", async () => {
      const { runner } = await create({
        "src/a.ts": "debugger;\n",
        "test/b.ts": "debugger;\n",
      });

      const report = await runner.run({ root: "/app" });

      expect(report.files).toBe(2);
      expect(report.findings.map((f) => f.file)).toEqual([
        "src/a.ts",
        "test/b.ts",
      ]);
    });

    it("prunes node_modules, dist, .gen and dot-directories, and skips .d.ts", async () => {
      const { runner } = await create({
        "src/a.ts": "export {};\n",
        "node_modules/x/index.ts": "debugger;\n",
        "dist/index.ts": "debugger;\n",
        "src/.gen/x.ts": "debugger;\n",
        ".cache/x.ts": "debugger;\n",
        "src/types.d.ts": "debugger;\n",
        "src/readme.md": "debugger;\n",
      });

      const report = await runner.run({ root: "/app" });

      expect(report.files).toBe(1);
      expect(report.findings).toEqual([]);
    });

    it("honours the root .gitignore and the config's ignore", async () => {
      const { alepha, runner } = await create({
        ".gitignore": "# build output\ncoverage/\n*.gen.ts\n!keep.gen.ts\n",
        "coverage/x.ts": "debugger;\n",
        "src/routes.gen.ts": "debugger;\n",
        "src/keep.gen.ts": "debugger;\n",
        "src/legacy/old.ts": "debugger;\n",
        "src/legacy/deep/older.tsx": "debugger;\n",
        "src/ok.ts": "debugger;\n",
      });
      alepha.store.set(checkOptions, { ignore: ["src/legacy/**"] });

      const report = await runner.run({ root: "/app" });

      expect(report.findings.map((f) => f.file)).toEqual([
        "src/keep.gen.ts",
        "src/ok.ts",
      ]);
    });

    it("narrows to the given paths", async () => {
      const { runner } = await create({
        "src/a/x.ts": "debugger;\n",
        "src/b/y.ts": "debugger;\n",
      });

      const report = await runner.run({ root: "/app", paths: ["src/b"] });
      expect(report.findings.map((f) => f.file)).toEqual(["src/b/y.ts"]);

      const single = await runner.run({
        root: "/app",
        paths: ["/app/src/a/x.ts"],
      });
      expect(single.findings.map((f) => f.file)).toEqual(["src/a/x.ts"]);
    });
  });

  describe("findings", () => {
    it("reports the file, line, column, rule, message and fix", async () => {
      const { runner } = await create({
        "src/a.ts": "const a = 1;\nexport const b = Date.now();\n",
      });

      const report = await runner.run({ root: "/app" });

      expect(report.findings).toEqual([
        {
          file: "src/a.ts",
          line: 2,
          column: 18,
          rule: "no-date-now",
          message: "Date.now() cannot be travelled in a test.",
          fix: expect.stringContaining("DateTimeProvider"),
        },
      ]);
    });

    it("reports a file that does not parse, and runs no rule on it", async () => {
      const { runner } = await create({
        "src/a.ts": "debugger;\nconst x = (;\n",
      });

      const report = await runner.run({ root: "/app" });

      expect(report.findings).toHaveLength(1);
      expect(report.findings[0]).toMatchObject({
        file: "src/a.ts",
        line: 2,
        rule: ConventionRunner.ENGINE_IDS.parse,
      });
    });

    it("parses tsx", async () => {
      const { runner } = await create({
        "src/A.tsx": "export const A = () => <div>{Date.now()}</div>;\n",
      });

      const report = await runner.run({ root: "/app" });
      expect(report.findings.map((f) => f.rule)).toEqual(["no-date-now"]);
    });
  });

  describe("rule selection", () => {
    it("runs only the named rules, even one the config turns off", async () => {
      const { alepha, runner } = await create({
        "src/a.ts": "debugger;\nDate.now();\n",
      });
      alepha.store.set(checkOptions, { rules: { "no-debugger": "off" } });

      const all = await runner.run({ root: "/app" });
      expect(all.findings.map((f) => f.rule)).toEqual(["no-date-now"]);

      const one = await runner.run({ root: "/app", rules: ["no-debugger"] });
      expect(one.findings.map((f) => f.rule)).toEqual(["no-debugger"]);
    });

    it("refuses an unknown id, from the config or the caller, naming the valid ones", async () => {
      const { alepha, runner } = await create({ "src/a.ts": "" });

      await expect(
        runner.run({ root: "/app", rules: ["no-such-rule"] }),
      ).rejects.toThrow("Valid ids: no-date-now, no-debugger");

      alepha.store.set(checkOptions, { rules: { "no-dat-now": "off" } });
      await expect(runner.run({ root: "/app" })).rejects.toThrow(AlephaError);
      await expect(runner.run({ root: "/app" })).rejects.toThrow(
        "check.rules: no-dat-now",
      );
    });
  });

  describe("exemptions", () => {
    it("suppresses the finding on the line below, and stacked ones apply together", async () => {
      const { runner } = await create({
        "src/a.ts": [
          "// alepha-allow no-date-now: a DOM id, never persisted",
          "Date.now();",
          "// alepha-allow no-date-now: both rules on one line",
          "// alepha-allow no-debugger: kept while the bug is open",
          "if (Date.now()) { debugger; }",
          "",
        ].join("\n"),
      });

      const report = await runner.run({ root: "/app" });
      expect(report.findings).toEqual([]);
    });

    it("works as a block comment inside JSX", async () => {
      const { runner } = await create({
        "src/A.tsx": [
          "export const A = () => (",
          "  <div>",
          "    {/* alepha-allow no-date-now: the render stamp of a demo */}",
          "    {Date.now()}",
          "  </div>",
          ");",
          "",
        ].join("\n"),
      });

      const report = await runner.run({ root: "/app" });
      expect(report.findings).toEqual([]);
    });

    it("reports an exemption without a reason, and does not apply it", async () => {
      const { runner } = await create({
        "src/a.ts": "// alepha-allow no-date-now\nDate.now();\n",
      });

      const report = await runner.run({ root: "/app" });
      expect(report.findings.map((f) => [f.line, f.rule])).toEqual([
        [1, ConventionRunner.ENGINE_IDS.noReason],
        [2, "no-date-now"],
      ]);
    });

    it("reports an unknown rule id, and an engine id as not exemptable", async () => {
      const { runner } = await create({
        "src/a.ts": [
          "// alepha-allow no-dat-now: typo",
          "// alepha-allow check/parse-error: nope",
          "export {};",
          "",
        ].join("\n"),
      });

      const report = await runner.run({ root: "/app" });
      expect(report.findings.map((f) => f.rule)).toEqual([
        ConventionRunner.ENGINE_IDS.unknownRule,
        ConventionRunner.ENGINE_IDS.unknownRule,
      ]);
      expect(report.findings[1].message).toContain("cannot be exempted");
    });

    it("reports an exemption that suppresses nothing, only for a rule that ran", async () => {
      const { alepha, runner } = await create({
        "src/a.ts": [
          "// alepha-allow no-date-now: stale",
          "export const a = 1;",
          "// alepha-allow no-debugger: stale too",
          "export const b = 2;",
          "",
        ].join("\n"),
        "src/a.spec.ts":
          "// alepha-allow no-date-now: no-date-now skips specs\nexport {};\n",
      });

      const all = await runner.run({ root: "/app" });
      expect(all.findings.map((f) => [f.file, f.line, f.rule])).toEqual([
        ["src/a.ts", 1, ConventionRunner.ENGINE_IDS.unused],
        ["src/a.ts", 3, ConventionRunner.ENGINE_IDS.unused],
      ]);

      const narrowed = await runner.run({
        root: "/app",
        rules: ["no-debugger"],
      });
      expect(narrowed.findings.map((f) => f.line)).toEqual([3]);

      alepha.store.set(checkOptions, { rules: { "no-debugger": "off" } });
      const off = await runner.run({ root: "/app" });
      expect(off.findings.map((f) => f.line)).toEqual([1]);
    });

    it("ignores the grammar inside a string", async () => {
      const { runner } = await create({
        "src/a.ts":
          'export const doc = "// alepha-allow no-date-now: in a string";\n',
      });

      const report = await runner.run({ root: "/app" });
      expect(report.findings).toEqual([]);
    });
  });

  describe("registration", () => {
    it("is declared in AlephaCliServices with the registry and the rules", () => {
      const alepha = Alepha.create({ env: { LOG_LEVEL: "error" } }).with(
        AlephaCliServices,
      );
      const registry = alepha.inject(ConventionRegistry);
      expect(registry.ids()).toContain("no-date-now");
      expect(alepha.inject(ConventionRunner)).toBeInstanceOf(ConventionRunner);
    });
  });
});
