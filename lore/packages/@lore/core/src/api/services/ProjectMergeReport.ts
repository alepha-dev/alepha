import type { ProjectMergePlan } from "./ProjectMergeService.ts";

/**
 * Writes a merge's plan as the markdown of its mapping folio (#E94,
 * #Q2783): what every renumbered item was called in the source and is
 * called now, what was joined, dropped or changed, and what the merge
 * refused. Built from the plan the run answered, never by hand, so the
 * folio says what happened rather than what was meant to.
 *
 * The new numbers are written as typed references (`[[#Q2790]]`), which
 * resolve in the target the folio lives in; the old ones as plain text,
 * since they name items of a project that no longer holds them.
 */
export class ProjectMergeReport {
  protected static readonly letters: Record<string, string> = {
    quest: "Q",
    epic: "E",
    folio: "F",
    feedback: "P",
    release: "R",
  };

  public markdown(
    plan: ProjectMergePlan,
    names: { source: string; target: string; at: string },
  ): string {
    const lines: string[] = [
      `# ${names.source} merged into ${names.target} (${names.at.slice(0, 10)})`,
      "",
      `Project ${plan.sourceProjectId} (${names.source}) merged into project ${plan.targetProjectId} (${names.target})${plan.dryRun ? ", **dry run: nothing was written**" : ""}. Written by the merge from what it did.`,
      "",
      "A number in the left column is what the item was called in the source project. A commit or a note written before the merge that names it means the item on the right.",
      "",
    ];

    const renumbered = plan.steps.flatMap((step) => step.renumbered);
    lines.push("## Renumbered", "");
    if (!renumbered.length) {
      lines.push("Nothing: every number was free in the target.", "");
    }
    const kinds = [...new Set(renumbered.map((row) => row.kind))];
    for (const kind of kinds) {
      const letter = ProjectMergeReport.letters[kind];
      const rows = renumbered.filter((row) => row.kind === kind);
      lines.push(
        `### ${kind} (${rows.length})`,
        "",
        "| was | is |",
        "|---|---|",
      );
      for (const row of rows) {
        lines.push(
          letter
            ? `| #${letter}${row.from} | [[#${letter}${row.to}]] |`
            : `| ${row.from} | ${row.to} |`,
        );
      }
      lines.push("");
    }

    const joined = plan.steps.flatMap((step) => step.joined);
    if (joined.length) {
      lines.push(
        "## Joined to the target's own",
        "",
        "| kind | key |",
        "|---|---|",
        ...joined.map((row) => `| ${row.kind} | ${row.key} |`),
        "",
      );
    }

    const changed = plan.steps.flatMap((step) => step.changed);
    if (changed.length) {
      lines.push(
        "## Changed to fit",
        "",
        "| kind | field | was | is |",
        "|---|---|---|---|",
        ...changed.map(
          (row) =>
            `| ${row.kind} | ${row.field} | ${this.cell(row.from)} | ${this.cell(row.to)} |`,
        ),
        "",
      );
    }

    const conflicts = plan.steps.flatMap((step) => step.conflicts ?? []);
    if (conflicts.length) {
      lines.push(
        "## Refused",
        "",
        "| kind | key |",
        "|---|---|",
        ...conflicts.map((row) => `| ${row.kind} | ${row.key} |`),
        "",
      );
    }

    lines.push("## Moved", "", "| table | rows |", "|---|---|");
    for (const step of plan.steps) {
      for (const [table, count] of Object.entries(step.moved)) {
        lines.push(`| ${table} | ${count} |`);
      }
    }
    const rewritten = plan.steps.flatMap((step) =>
      Object.entries(step.rewritten ?? {}),
    );
    if (rewritten.length) {
      lines.push(
        "",
        "## References rewritten",
        "",
        "| table | rows |",
        "|---|---|",
        ...rewritten.map(([table, count]) => `| ${table} | ${count} |`),
      );
    }
    return `${lines.join("\n")}\n`;
  }

  /**
   * A value as a table cell: a pipe would end the cell.
   */
  protected cell(value: string): string {
    return value.replaceAll("|", "\\|") || " ";
  }
}
