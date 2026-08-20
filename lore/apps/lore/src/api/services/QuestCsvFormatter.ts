export interface ExportRow {
  shortId: number;
  title: string;
  status: "new" | "accepted" | "completed";
  priority: "optional" | "low" | "medium" | "high";
  area: string;
  kanbanColumn: string;
  milestone: string;
  createdBy: string;
  acceptedBy: string;
  completedBy: string;
  createdAt: string;
  acceptedAt: string;
  completedAt: string;
  objectives: Array<{ title: string; completed: boolean }>;
  description: string;
}

export const QUEST_CSV_HEADER: ReadonlyArray<keyof ExportRow> = [
  "shortId",
  "title",
  "status",
  "priority",
  "area",
  "kanbanColumn",
  "milestone",
  "createdBy",
  "acceptedBy",
  "completedBy",
  "createdAt",
  "acceptedAt",
  "completedAt",
  "objectives",
  "description",
];

/**
 * Encode quest rows into Alepha Lore CSV.
 *
 * Always wraps every value in double quotes (RFC 4180). Embedded `"` becomes
 * `""`. Newlines inside fields are preserved. `objectives` is serialized as a
 * JSON literal.
 */
export class QuestCsvFormatter {
  public format(rows: ExportRow[]): string {
    const lines: string[] = [
      QUEST_CSV_HEADER.map((c) => this.escape(c)).join(","),
    ];
    for (const row of rows) {
      lines.push(
        QUEST_CSV_HEADER.map((col) => {
          const v = row[col];
          if (col === "objectives") return this.escape(JSON.stringify(v));
          return this.escape(String(v));
        }).join(","),
      );
    }
    return `${lines.join("\n")}\n`;
  }

  protected escape(value: string): string {
    return `"${value.replace(/"/g, '""')}"`;
  }
}
