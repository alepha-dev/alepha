import type { Project } from "@lore/core/schemas";
import type { KanbanColumnSettings } from "@lore/core/schemas";

/**
 * A board column, fully resolved: what it is called, what it collapses to,
 * and whether the project configured it or the board synthesized it.
 */
export interface ResolvedKanbanColumn {
  name: string;
  status: NonNullable<KanbanColumnSettings["status"]>;
  wipLimit?: number;
  /**
   * The operator's chosen dot colour, when they chose one. Absent leaves the
   * board to derive one from the column's status and position, which is what
   * it did before columns could be tinted.
   */
  color?: KanbanColumnSettings["color"];
  /**
   * `true` for the ends the board adds when the project has not named a
   * column carrying that status. A synthesized column has no entry in
   * `kanbanColumns`, so it cannot be renamed, deleted or given a limit.
   */
  synthesized: boolean;
}

/**
 * Turns a project's column names plus its per-column settings into the
 * board's frame.
 *
 * **The quest's lifecycle remains the source of truth** (quest #1227,
 * decided by the owner). A column does not carry a status of its own; it
 * declares which of `draft` / `todo` / `in_progress` / `completed` a card
 * dropped in it collapses to. Everything downstream — the quest log,
 * releases, reports, MCP, the Discussion feed, `QuestlineLayout.stateOf` —
 * keeps reading the quest's timestamps and never learns that columns exist.
 *
 * What changes is that the frame is no longer hardcoded. Before #1227, the
 * board was always `New | <every configured column> | Completed`. Now:
 *
 * - every configured column takes its status from the config, defaulting
 *   to `in_progress`, which is what a configured column has always meant;
 * - a lifecycle state that no configured column carries gets a column
 *   synthesized for it, at its place in the lifecycle: "Draft" FIRST, then
 *   "To do", both before the configured columns, and "Completed" last.
 *   Draft follows the rule To do and Completed already did (#E178, review
 *   item 10): a project that configures its own `draft` column gets it
 *   where it put it, and none is synthesized.
 *
 * So a project can have two done-ish columns, or replace the synthesized
 * ends with its own, or keep the default frame by configuring nothing. A
 * project with no config at all resolves to Draft, To do, its configured
 * columns, Completed.
 */
export class KanbanColumnConfig {
  resolve(
    project: Pick<Project, "kanbanColumns" | "kanbanColumnConfig">,
    labels: { draft: string; todo: string; completed: string },
  ): ResolvedKanbanColumn[] {
    const names = project.kanbanColumns ?? [];
    const config = project.kanbanColumnConfig ?? {};

    const configured: ResolvedKanbanColumn[] = names.map((name) => {
      const settings: KanbanColumnSettings = config[name] ?? {};
      return {
        name,
        status: settings.status ?? "in_progress",
        wipLimit: settings.wipLimit,
        color: settings.color,
        synthesized: false,
      };
    });

    const has = (status: ResolvedKanbanColumn["status"]) =>
      configured.some((column) => column.status === status);

    const synthesized = (
      status: "draft" | "todo" | "completed",
    ): ResolvedKanbanColumn[] =>
      has(status) ? [] : [{ name: labels[status], status, synthesized: true }];

    return [
      ...synthesized("draft"),
      ...synthesized("todo"),
      ...configured,
      ...synthesized("completed"),
    ];
  }

  /**
   * The settings for one column, or an empty object. Used by the write
   * paths so a rename can carry an entry across and a delete can drop one.
   */
  settingsOf(
    project: Pick<Project, "kanbanColumnConfig">,
    name: string,
  ): KanbanColumnSettings {
    return project.kanbanColumnConfig?.[name] ?? {};
  }
}
