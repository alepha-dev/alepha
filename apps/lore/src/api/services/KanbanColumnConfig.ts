import type { Project } from "../entities/projects.ts";
import type { KanbanColumnSettings } from "../schemas/kanbanColumnSchema.ts";

/**
 * A board column, fully resolved: what it is called, what it collapses to,
 * and whether the project configured it or the board synthesized it.
 */
export interface ResolvedKanbanColumn {
  name: string;
  status: "new" | "accepted" | "completed";
  wipLimit?: number;
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
 * **The lifecycle triple remains the source of truth** (quest #1227,
 * decided by the owner). A column does not carry a status of its own; it
 * declares which of `new` / `accepted` / `completed` a card dropped in it
 * collapses to. Everything downstream — the quest log, releases,
 * reports, MCP, the Discussion feed, `QuestlineLayout.stateOf` — keeps
 * reading the three timestamps and never learns that columns exist.
 *
 * What changes is that the frame is no longer hardcoded. Before this, the
 * board was always `New | <every configured column> | Completed`. Now:
 *
 * - every configured column takes its status from the config, defaulting
 *   to `accepted`, which is what a configured column has always meant;
 * - a "New" column is synthesized ONLY when no configured column carries
 *   `new`, and likewise for "Completed".
 *
 * So a project can have two done-ish columns, or replace the synthesized
 * ends with its own, or keep the old frame by configuring nothing. A
 * project with no config at all resolves to exactly the board it had.
 */
export class KanbanColumnConfig {
  resolve(
    project: Pick<Project, "kanbanColumns" | "kanbanColumnConfig">,
    labels: { new: string; completed: string },
  ): ResolvedKanbanColumn[] {
    const names = project.kanbanColumns ?? [];
    const config = project.kanbanColumnConfig ?? {};

    const configured: ResolvedKanbanColumn[] = names.map((name) => {
      const settings: KanbanColumnSettings = config[name] ?? {};
      return {
        name,
        status: settings.status ?? "accepted",
        wipLimit: settings.wipLimit,
        synthesized: false,
      };
    });

    const has = (status: ResolvedKanbanColumn["status"]) =>
      configured.some((column) => column.status === status);

    return [
      ...(has("new")
        ? []
        : [
            {
              name: labels.new,
              status: "new" as const,
              synthesized: true,
            },
          ]),
      ...configured,
      ...(has("completed")
        ? []
        : [
            {
              name: labels.completed,
              status: "completed" as const,
              synthesized: true,
            },
          ]),
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
