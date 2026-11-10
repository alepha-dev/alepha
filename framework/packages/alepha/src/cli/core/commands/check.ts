import { $inject, Alepha, AlephaError, z } from "alepha";
import { $command, CommandError, ConsoleOutputProvider } from "alepha/command";

import { checkOptions } from "../atoms/checkOptions.ts";
import { ConventionRegistry } from "../services/ConventionRegistry.ts";
import {
  type ConventionFinding,
  type ConventionReport,
  ConventionRunner,
} from "../services/ConventionRunner.ts";

/**
 * `alepha check`: the framework's conventions, run over the app's own source.
 *
 * Reads the source only, through {@link ConventionRunner}: it never boots the
 * app, so it works on one that does not compile. `alepha.config.ts` is still
 * loaded, as for every command, for its `check` key.
 */
export class CheckCommand {
  protected readonly alepha = $inject(Alepha);
  protected readonly registry = $inject(ConventionRegistry);
  protected readonly runner = $inject(ConventionRunner);
  protected readonly output = $inject(ConsoleOutputProvider);

  public readonly check = $command({
    name: "check",
    description:
      "Check the source against Alepha's conventions (no Date.now(), no bare Error, no vi.mock, ...). Exits 1 on any finding",
    args: z
      .text({
        title: "path",
        description: "Only check this file or directory",
      })
      .optional(),
    flags: z.object({
      json: z
        .boolean()
        .describe(
          "Print the findings as one JSON array of { file, line, column, rule, message, fix } on stdout",
        )
        .optional(),
      rule: z
        .string()
        .describe("Run only this rule (comma-separated for several)")
        .optional(),
      list: z
        .boolean()
        .describe(
          "Print the rules this version knows (id, default, description, fix) instead of checking; with --json, as data",
        )
        .optional(),
    }),
    handler: async ({ root, args, flags }) => {
      if (flags.list) {
        this.printList(flags.json);
        return;
      }

      const rules = flags.rule
        ?.split(",")
        .map((it) => it.trim())
        .filter(Boolean);

      let report: ConventionReport;
      try {
        report = await this.runner.run({
          root,
          paths: args ? [args] : undefined,
          rules,
        });
      } catch (error) {
        if (error instanceof AlephaError) {
          throw new CommandError(error.message);
        }
        throw error;
      }

      if (flags.json) {
        this.output.print(JSON.stringify(report.findings, null, 2));
      } else {
        this.printHuman(report.findings, report.files);
      }

      if (report.findings.length) {
        throw new CommandError(
          `alepha check: ${this.count(report.findings.length, "finding")}`,
        );
      }
    },
  });

  /**
   * `file:line  rule-id`, then the message and the fix indented, grouped by
   * file, then a count line.
   */
  protected printHuman(findings: ConventionFinding[], files: number): void {
    if (!findings.length) {
      this.output.print(
        `No convention finding in ${this.count(files, "file")}.`,
      );
      return;
    }

    const lines: string[] = [];
    let current = "";
    for (const finding of findings) {
      if (finding.file !== current) {
        if (current) {
          lines.push("");
        }
        current = finding.file;
      }
      lines.push(`${finding.file}:${finding.line}  ${finding.rule}`);
      lines.push(`  ${finding.message} ${finding.fix}`);
    }

    const touched = new Set(findings.map((it) => it.file)).size;
    lines.push(
      "",
      `${this.count(findings.length, "finding")} in ${this.count(touched, "file")} (${this.count(files, "file")} checked).`,
      "",
      ...this.waysOut(),
    );
    this.output.print(lines.join("\n"));
  }

  /**
   * What to do about a finding. An app that upgraded meets `check` inside
   * `alepha verify` with no warning, so when its config has no `check` key at
   * all, the last line names the one that removes the step.
   */
  protected waysOut(): string[] {
    const lines = [
      "Each finding has three ways out:",
      "  - fix it, as the line under it says;",
      "  - exempt that one line, with the reason, on the line above it: // alepha-allow <rule>: <reason>;",
      '  - turn one rule off in alepha.config.ts: check: { rules: { "<rule>": "off" } }.',
    ];
    if (this.alepha.store.get(checkOptions)?.enabled === undefined) {
      lines.push(
        "`check: false` in alepha.config.ts removes the step from alepha verify altogether.",
      );
    }
    return lines;
  }

  /**
   * `alepha check --list`: every rule this version knows, with its state in
   * this app.
   */
  protected printList(json?: boolean): void {
    const config = this.alepha.store.get(checkOptions);
    const rules = this.registry.list().map((rule) => ({
      id: rule.id,
      default: "on" as const,
      state: config?.rules?.[rule.id] ?? ("on" as const),
      description: rule.description,
      fix: rule.fix,
    }));

    if (json) {
      this.output.print(JSON.stringify(rules, null, 2));
      return;
    }

    const lines: string[] = [];
    for (const rule of rules) {
      const state = rule.state === "off" ? "  (off in alepha.config.ts)" : "";
      lines.push(`${rule.id}${state}`, `  ${rule.description} ${rule.fix}`);
    }
    lines.push(
      "",
      `${this.count(rules.length, "rule")}, every one on by default. Exempt a line with // alepha-allow <rule>: <reason>.`,
    );
    this.output.print(lines.join("\n"));
  }

  protected count(value: number, noun: string): string {
    return `${value} ${noun}${value === 1 ? "" : "s"}`;
  }
}
