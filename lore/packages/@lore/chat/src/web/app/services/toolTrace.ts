/**
 * The kind of thing a tool works on, as its name says.
 */
export type ToolKind =
  | "quest"
  | "epic"
  | "folio"
  | "release"
  | "feedback"
  | "project"
  | "search"
  | "other";

export interface ToolTraceSummary {
  /**
   * Kinds read, with how many calls, in the order first used.
   */
  read: Array<{ kind: ToolKind; count: number }>;
  /**
   * Kinds written (created, updated, completed, commented), the same way.
   */
  changed: Array<{ kind: ToolKind; count: number }>;
}

/**
 * What an agent's tool calls touched, for the one-line summary over its
 * answer ("Read 6 quests, 1 folio"). A call names its tool only, so the
 * summary counts calls, by the kind of thing the tool's name says, split
 * into reads and writes.
 */
export class ToolTrace {
  protected readonly write =
    /(create|update|complete|delete|remove|accept|_add|_set)/i;

  /**
   * The kind of thing a tool works on, read from its name: `quest_list`,
   * `getEpicRefs`, `folio_search`. The first match wins, so `folio_search`
   * is a folio and not a search.
   */
  public kind(name: string): ToolKind {
    const lower = name.toLowerCase();
    if (lower.includes("quest")) return "quest";
    if (lower.includes("epic")) return "epic";
    if (lower.includes("folio")) return "folio";
    if (lower.includes("release")) return "release";
    if (lower.includes("feedback")) return "feedback";
    if (lower.startsWith("project")) return "project";
    if (lower.includes("search")) return "search";
    return "other";
  }

  /**
   * Count the calls of a run by kind, reads and writes apart. A failed or
   * denied call is left out: it touched nothing.
   */
  public summarize(
    tools: ReadonlyArray<{ name: string; state: string }>,
  ): ToolTraceSummary {
    const read = new Map<ToolKind, number>();
    const changed = new Map<ToolKind, number>();
    for (const tool of tools) {
      if (tool.state !== "done") continue;
      const into = this.write.test(tool.name) ? changed : read;
      const kind = this.kind(tool.name);
      into.set(kind, (into.get(kind) ?? 0) + 1);
    }
    const list = (counts: Map<ToolKind, number>) =>
      [...counts].map(([kind, count]) => ({ kind, count }));
    return { read: list(read), changed: list(changed) };
  }
}
