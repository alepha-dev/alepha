import { useDialog } from "@alepha/ui/components/use-dialog/use-dialog";
import { useToast } from "@alepha/ui/components/use-toast/use-toast";
import { useAlepha, useClient } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { useState } from "react";

import type { ProjectController } from "@/api/controllers/ProjectController.ts";
import type { PaletteColor } from "@/api/schemas/paletteColorSchema.ts";
import { currentProjectAtom } from "@/web/app/atoms/currentProjectAtom.ts";
import type { I18n } from "@/web/app/services/I18n.ts";

/**
 * Create, rename, recolour and delete an in-progress column, from wherever
 * the operator happens to be looking.
 *
 * Extracted so the board (#1511) and Settings ▸ Kanban drive the SAME four
 * endpoints. That is what the quest meant by no second source of truth: the
 * validation is the server's - name length, uniqueness, the five-column cap,
 * and the refusal to delete a column that still holds quests - so whatever
 * Settings refuses, the board refuses, without either side restating a rule.
 *
 * ## What it deliberately does not do
 *
 * **Reordering stays in Settings.** Dragging a column on the board would
 * fight the card drag that is already there, and reordering is a
 * rearrange-the-workspace act rather than an in-flight one.
 *
 * **Only in-progress columns are editable.** The lifecycle triple is
 * authoritative (folio #1125): a synthesized `new` or `completed` lane has
 * no entry in `kanbanColumns`, so there is nothing to rename or delete, and
 * the caller is expected not to offer it.
 */
export const useKanbanColumnOps = (
  projectId: number,
  onColumnsChanged?: () => void,
): KanbanColumnOps => {
  const projectApi = useClient<ProjectController>();
  const alepha = useAlepha();
  const toaster = useToast();
  const dialog = useDialog();
  const { tr } = useI18n<I18n, "en">();
  const [pending, setPending] = useState<string | null>(null);

  /**
   * Runs one column mutation and keeps `currentProjectAtom` true.
   *
   * The atom, not a local copy: the board, the sidebar and Settings all read
   * the project from it, so a column added here has to be visible there
   * without a reload.
   */
  const run = async <T>(
    label: string,
    fn: () => Promise<T>,
    apply: (result: T, project: any) => any,
  ): Promise<boolean> => {
    setPending(label);
    try {
      const result = await fn();
      const project = alepha.store.get(currentProjectAtom);
      if (project) {
        alepha.store.set(currentProjectAtom, apply(result, project));
      }
      onColumnsChanged?.();
      return true;
    } catch (error) {
      // The server's message wins when there is one: "Move or complete the
      // quests in this column before deleting it" is the whole story, and a
      // generic catalogue string would replace an answer with a shrug.
      toaster.error(
        error instanceof Error
          ? error.message
          : String(tr("kanban.column.failed")),
      );
      return false;
    } finally {
      setPending(null);
    }
  };

  const withColumns = (columns: string[], project: any) => ({
    ...project,
    kanbanColumns: columns,
  });

  return {
    pending,

    add: (name: string) =>
      run(
        "add",
        () =>
          projectApi.addKanbanColumn({
            params: { id: projectId },
            body: { name: name.trim() },
          }),
        withColumns,
      ),

    rename: (oldName: string, newName: string) => {
      const trimmed = newName.trim();
      if (!trimmed || trimmed === oldName) return Promise.resolve(false);
      return run(
        `rename:${oldName}`,
        () =>
          projectApi.renameKanbanColumn({
            params: { id: projectId },
            body: { oldName, newName: trimmed },
          }),
        withColumns,
      );
    },

    remove: async (name: string) => {
      // Confirmed here rather than at the call site, for the reason
      // `useRevokeInvitation` gives: the confirmation is part of the action.
      //
      // ⚠️ The description says the column must be EMPTY rather than telling
      // the operator what will happen to its cards, because nothing happens
      // to them: the server refuses a non-empty column outright. Promising a
      // move here and getting a refusal there would be worse than the plain
      // rule.
      const confirmed = await dialog.confirm({
        title: String(tr("kanban.column.delete.title")),
        description: String(
          tr("kanban.column.delete.description", { args: [name] }),
        ),
        confirmLabel: String(tr("kanban.column.delete.confirm")),
        cancelLabel: String(tr("kanban.column.delete.cancel")),
        destructive: true,
      });
      if (!confirmed) return false;

      return run(
        `delete:${name}`,
        () =>
          projectApi.deleteKanbanColumn({
            params: { id: projectId },
            body: { name },
          }),
        withColumns,
      );
    },

    setColor: (name: string, color: PaletteColor | undefined) => {
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

      return run(
        `color:${name}`,
        () =>
          projectApi.updateProjectById({
            params: { id: projectId },
            body: { kanbanColumnConfig: next },
          }),
        (updated) => updated,
      );
    },
  };
};

export interface KanbanColumnOps {
  /**
   * The operation in flight, as `add` / `rename:<name>` / `delete:<name>` /
   * `color:<name>`, or `null`. Keyed rather than a boolean so one column's
   * spinner does not disable the whole board.
   */
  pending: string | null;
  add: (name: string) => Promise<boolean>;
  rename: (oldName: string, newName: string) => Promise<boolean>;
  /**
   * Confirms first, and resolves `false` when the operator backs out or the
   * server refuses. Either way they have been told.
   */
  remove: (name: string) => Promise<boolean>;
  setColor: (name: string, color: PaletteColor | undefined) => Promise<boolean>;
}
