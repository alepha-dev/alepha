import type { ReportsSummaryLine } from "../../../api/schemas/reportsSummarySchema.ts";

/**
 * The Summary tab as a status update (#Q2999): the same figures, in Markdown,
 * for a stand-up thread or a folio.
 */
export class ReportsSummaryMarkdown {
  render(
    title: string,
    lines: readonly ReportsSummaryLine[],
    labels: {
      line: (key: string) => string;
      format: (line: ReportsSummaryLine, value: number) => string;
    },
  ): string {
    return [
      `## ${title}`,
      "",
      ...lines.map((line) => {
        const value = labels.format(line, line.value);
        const before =
          line.previous === undefined
            ? ""
            : ` (was ${labels.format(line, line.previous)})`;
        return `- ${labels.line(line.key)}: ${value}${before}`;
      }),
    ].join("\n");
  }
}
