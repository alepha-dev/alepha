import type { AdminMcpController } from "@lore/core/api";

export type McpToolRow = Awaited<
  ReturnType<AdminMcpController["readMcpCalls"]>
>["leaderboard"][number];

/**
 * The Admin › MCP leaderboard, sorted in the page (#Q3665): the read
 * answers every tool at once, so the table pages and sorts what it holds.
 */
export class AdminMcpRows {
  /**
   * The rows by the table's sort (`field` or `-field`), the busiest first
   * when it names none.
   */
  public static sorted(rows: McpToolRow[], sort?: string): McpToolRow[] {
    const descending = !sort || sort.startsWith("-");
    const field = (sort?.replace(/^-/, "") || "total") as keyof McpToolRow;
    return [...rows].sort((a, b) => {
      const left = a[field];
      const right = b[field];
      const order =
        typeof left === "number" && typeof right === "number"
          ? left - right
          : String(left).localeCompare(String(right));
      return descending ? -order : order;
    });
  }
}
