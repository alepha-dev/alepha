export type ReportsCsvRow = Record<
  string,
  string | number | boolean | null | undefined
>;

/**
 * A report section's data as a CSV (#Q2997): the same rows the chart draws.
 */
export class ReportsCsv {
  /**
   * The columns are the union of the rows' keys, in first-seen order: a sparse
   * row must not shift the values of the ones after it.
   */
  serialize(rows: readonly ReportsCsvRow[]): string {
    const columns = [...new Set(rows.flatMap((row) => Object.keys(row)))];
    return [
      columns.join(","),
      ...rows.map((row) =>
        columns.map((column) => this.cell(row[column])).join(","),
      ),
    ].join("\n");
  }

  download(filename: string, rows: readonly ReportsCsvRow[]): void {
    const url = URL.createObjectURL(
      new Blob([this.serialize(rows)], { type: "text/csv;charset=utf-8" }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = `${filename}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  /**
   * ⚠️ A quest title is user text, and a spreadsheet runs a cell starting with
   * `=`, `+`, `-` or `@` as a formula, so text is prefixed with a quote. A
   * number stays a number, negative ones included.
   */
  protected cell(value: ReportsCsvRow[string]): string {
    if (value === null || value === undefined) {
      return "";
    }
    if (typeof value !== "string") {
      return String(value);
    }
    const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
    return /[",\n\r]/.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe;
  }
}
