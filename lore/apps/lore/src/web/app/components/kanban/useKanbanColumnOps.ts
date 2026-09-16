import { useDialog } from "@alepha/ui";
import { useAction, useAlepha, useClient } from "alepha/react";
import { useI18n } from "alepha/react/i18n";

import type { ProjectController } from "@/api/controllers/ProjectController.ts";
import type { PaletteColor } from "@/api/schemas/paletteColorSchema.ts";
import { currentProjectAtom } from "@/web/app/atoms/currentProjectAtom.ts";
import { userProjectsAtom } from "@/web/app/atoms/userProjectsAtom.ts";
import { setCurrentProject } from "@/web/app/services/currentProjectWrite.ts";
import type { I18n } from "@/web/app/services/I18n.ts";

/**
 * Create, rename, recolour and delete an in-progress column, from wherever
 * the operator happens to be looking.
 *
 * Extracted so the board (#1511) and Settings ▸ Work drive the SAME four
 * endpoints. That is what the quest meant by no second source of truth: the
 * validation is the server's - name length, uniqueness, the five-column cap,
 * and the refusal to delete a column that still holds quests - so whatever
 * Settings refuses, the board refuses, without either side restating a rule.
 * Settings adopted it in #E59 (#Q2324); until then it carried a copy of the
 * three column verbs of its own.
 *
 * Each verb is a `useAction` run (#E59): it resolves `true` when the column
 * changed, `false` when there was nothing to do or the operator backed out,
 * and `undefined` when the server refused. A refusal is toasted by the root
 * `ActionErrorToaster` with the server's own message ("Move or complete the
 * quests in this column before deleting it" is the whole story).
 *
 * ## What it deliberately does not do
 *
 * **Reordering stays in Settings.** Dragging a column on the board would
 * fight the card drag that is already there, and reordering is a
 * rearrange-the-workspace act rather than an in-flight one.
 *
 * **Only in-progress columns are editable.** The lifecycle triple is
 * authoritative (folio #1125): a synthesized `todo` or `completed` lane has
 * no entry in `kanbanColumns`, so there is nothing to rename or delete, and
 * the caller is expected not to offer it.
 */
export const useKanbanColumnOps = (
  projectId: number,
  onColumnsChanged?: () => void,
): KanbanColumnOps => {
  const projectApi = useClient<ProjectController>();
  const alepha = useAlepha();
  const dialog = useDialog();
  const { tr } = useI18n<I18n, "en">();

  /**
   * Writes what a column mutation answered into the two atoms that show it.
   *
   * `currentProjectAtom`, not a local copy: the board, the sidebar and
   * Settings all read the project from it, so a column added here has to be
   * visible there without a reload. And `userProjectsAtom`, the home
   * overview, which Settings kept in step by hand before it used this hook:
   * a column changed from the board has to be true there too.
   */
  const apply = (next: (project: any) => any): true => {
    const project = alepha.store.get(currentProjectAtom);
    if (project) {
      const updated = next(project);
      setCurrentProject(alepha, updated);
      const overview = alepha.store.get(userProjectsAtom);
      if (overview) {
        alepha.store.set(userProjectsAtom, {
          ...overview,
          // `areaCount`, `openQuestCount` and `owner` are computed by
          // `getHomeOverview` alone, so they are carried forward rather than
          // dropped to their empty values.
          projects: overview.projects.map((it) =>
            it.id === updated.id
              ? {
                  ...updated,
                  areaCount: it.areaCount,
                  openQuestCount: it.openQuestCount,
                  owner: it.owner,
                }
              : it,
          ),
        });
      }
    }
    onColumnsChanged?.();
    return true;
  };

  const withColumns = (columns: string[]) => (project: any) => ({
    ...project,
    kanbanColumns: columns,
  });

  const add = useAction<[name: string], boolean>(
    {
      handler: async (name) =>
        apply(
          withColumns(
            await projectApi.addKanbanColumn({
              params: { id: projectId },
              body: { name: name.trim() },
            }),
          ),
        ),
    },
    [projectApi, projectId, onColumnsChanged],
  );

  const rename = useAction<[oldName: string, newName: string], boolean>(
    {
      handler: async (oldName, newName) => {
        const trimmed = newName.trim();
        if (!trimmed || trimmed === oldName) return false;
        return apply(
          withColumns(
            await projectApi.renameKanbanColumn({
              params: { id: projectId },
              body: { oldName, newName: trimmed },
            }),
          ),
        );
      },
    },
    [projectApi, projectId, onColumnsChanged],
  );

  const remove = useAction<[name: string], boolean>(
    {
      handler: async (name) => {
        // Confirmed here rather than at the call site, for the reason
        // `useRevokeInvitation` gives: the confirmation is part of the action.
        //
        // ⚠️ The description says the column must be EMPTY rather than
        // telling the operator what will happen to its cards, because nothing
        // happens to them: the server refuses a non-empty column outright.
        // Promising a move here and getting a refusal there would be worse
        // than the plain rule.
        const confirmed = await dialog.confirm({
          title: tr("kanban.column.delete.title"),
          description: tr("kanban.column.delete.description", {
            args: [name],
          }),
          confirmLabel: tr("kanban.column.delete.confirm"),
          cancelLabel: tr("kanban.column.delete.cancel"),
          destructive: true,
        });
        if (!confirmed) return false;
        return apply(
          withColumns(
            await projectApi.deleteKanbanColumn({
              params: { id: projectId },
              body: { name },
            }),
          ),
        );
      },
    },
    [projectApi, projectId, dialog, tr, onColumnsChanged],
  );

  const setColor = useAction<
    [name: string, color: PaletteColor | undefined],
    boolean
  >(
    {
      handler: async (name, color) => {
        const project = alepha.store.get(currentProjectAtom);
        const current = (project as any)?.kanbanColumnConfig ?? {};
        const merged = { ...current[name] };
        // Absent rather than a stored default: "no colour chosen" is what an
        // empty entry means, so writing one would leave two encodings of the
        // same state - the same rule Settings applies to `status` and
        // `wipLimit`.
        if (color) {
          merged.color = color;
        } else {
          delete merged.color;
        }

        const next = { ...current };
        if (Object.keys(merged).length) {
          next[name] = merged;
        } else {
          delete next[name];
        }

        const updated = await projectApi.updateProjectById({
          params: { id: projectId },
          body: { kanbanColumnConfig: next },
        });
        return apply(() => updated);
      },
    },
    [projectApi, projectId, onColumnsChanged],
  );

  return {
    loading:
      add.loading || rename.loading || remove.loading || setColor.loading,

    // The four verbs are one permission server-side, so one flag - and it
    // comes off the action rather than a string, which is what stops the
    // board and Settings from asking two different questions.
    can: projectApi.addKanbanColumn.can(),

    add: add.run,
    rename: rename.run,
    remove: remove.run,
    setColor: setColor.run,
  };
};

export interface KanbanColumnOps {
  /**
   * True while any column verb runs. Every column control is disabled for
   * that time, on the board and in Settings alike.
   *
   * ⚠️ A boolean, and that reverses a choice. This was a key naming the
   * operation in flight (`rename:<name>`), so one column's spinner did not
   * disable the whole board. Over `useAction` that keyed state lies: `run()`
   * drops a call made while one is in flight, so a second column's enabled
   * button would take the click and do nothing. Busy is page-wide instead
   * (#E59 rule 10).
   */
  loading: boolean;
  /**
   * Whether this reader's rank may edit columns at all. Every caller should
   * gate its own affordances on this rather than on a permission string.
   */
  can: boolean;
  add: (name: string) => Promise<boolean | undefined>;
  rename: (oldName: string, newName: string) => Promise<boolean | undefined>;
  /**
   * Confirms first, and resolves `false` when the operator backs out,
   * `undefined` when the server refuses. Either way they have been told.
   */
  remove: (name: string) => Promise<boolean | undefined>;
  setColor: (
    name: string,
    color: PaletteColor | undefined,
  ) => Promise<boolean | undefined>;
}
