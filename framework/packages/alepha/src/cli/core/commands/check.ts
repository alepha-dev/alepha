import { $inject, AlephaError, z } from "alepha";
import { $command, CommandError, ConsoleOutputProvider } from "alepha/command";

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
    }),
    handler: async ({ root, args, flags }) => {
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
    );
    this.output.print(lines.join("\n"));
  }

  protected count(value: number, noun: string): string {
    return `${value} ${noun}${value === 1 ? "" : "s"}`;
  }
}
