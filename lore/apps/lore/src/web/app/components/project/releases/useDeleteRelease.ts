import { useDialog, useToast } from "@alepha/ui";
import { useClient, useStore } from "alepha/react";
import { useI18n } from "alepha/react/i18n";

import type { ReleaseController } from "@/api/controllers/ReleaseController.ts";
import type { ReleaseResource } from "@/api/schemas/releaseResourceSchema.ts";
import { currentReleasesAtom } from "@/web/app/atoms/currentReleasesAtom.ts";
import type { I18n } from "@/web/app/services/I18n.ts";

import { settleBulk } from "../../shared/bulkOutcome.ts";
import { formatReference } from "../../shared/element/typedReference.ts";
import { useBulkReport } from "../../shared/useBulkReport.ts";

/**
 * Delete a release, or a selection of them, after saying what the row does
 * not show.
 *
 * `ReleaseController.deleteRelease` existed for a long time with nothing in
 * the web app calling it, so a release created by mistake could only be
 * removed from the MCP. The Releases table's row menu and its checkbox
 * selection are the two doors now, and they share this hook so the single
 * and the bulk confirm cannot start disagreeing about what a delete costs.
 *
 * ## The server is cheap about it, the confirm is not
 *
 * `quests.releaseId` and `epics.releaseId` are both `ON DELETE SET NULL`, so
 * the work in a release is detached rather than deleted, and the confirm
 * names both: a release is mostly a set of epics, and "its quests" alone
 * would undersell what moves.
 *
 * Two further losses are invisible from the row, so the confirm raises each
 * one only when it applies:
 *
 * - **A published release is the only copy of its record.** The changelog,
 *   its groups and the four counts were frozen onto the row at publish and
 *   cannot be recomputed once it is gone.
 * - **The default release takes the default with it.** The flag lives on the
 *   row, and nothing on the delete path picks a successor the way publishing
 *   does, so the project is left with none.
 *
 * On one row at most one of the two applies: publishing clears the default,
 * and `setDefaultRelease` refuses a published release. A selection can carry
 * both, and says that it includes such a release, since someone who ticked
 * four rows cannot see which of them holds the frozen changelog. The
 * description is sentences joined rather than a branch per case, because
 * `ConfirmOptions.description` is a string and a list cannot be drawn in it.
 *
 * ⚠️ **No guard is added anywhere.** The server stays as permissive as the
 * MCP; a UI that refuses what the MCP allows is a second rule that drifts
 * from the first. The dialog is where the loss is named, not where it is
 * prevented.
 *
 * ⚠️ **It refetches `currentReleasesAtom`, once per run.** The sidebar, both
 * release controls and the Epics and Quests release filters read the atom,
 * and none of them watches the table this is called from. A bulk run
 * refetches after every call has settled, never once per id: the table's own
 * `ctx.refresh()` re-fires only its own fetch.
 */
export const useDeleteRelease = (): DeleteRelease => {
  const releaseApi = useClient<ReleaseController>();
  const { tr } = useI18n<I18n, "en">();
  const dialog = useDialog();
  const toaster = useToast();
  const reportBulk = useBulkReport();
  const [, setReleases] = useStore(currentReleasesAtom);

  const name = (release: ReleaseResource): string =>
    release.tag ?? formatReference("release", release.number);

  const sentences = (parts: Array<string | undefined>): string =>
    parts.filter((sentence): sentence is string => Boolean(sentence)).join(" ");

  const failure = (error: unknown) =>
    toaster.error(error instanceof Error ? error.message : String(error));

  /**
   * The releases are gone whatever this answers, so a failed refetch is
   * reported and the caller still refreshes: its rows must go too.
   */
  const refetch = async (projectId: number) => {
    try {
      setReleases(await releaseApi.getReleases({ params: { projectId } }));
    } catch (error) {
      failure(error);
    }
  };

  return {
    can: releaseApi.deleteRelease.can(),
    remove: async (release) => {
      const label = name(release);
      const ok = await dialog.confirm({
        title: tr("release.delete.title", { args: [label] }),
        // The title names the release; the sentences say "it", or a
        // default release reads "detached from 0.3.0. 0.3.0 is the default".
        description: sentences([
          tr("release.delete.detached"),
          release.releasedAt ? tr("release.delete.published") : undefined,
          release.defaultSince ? tr("release.delete.default") : undefined,
        ]),
        confirmLabel: tr("release.delete.action"),
        cancelLabel: tr("common.cancel"),
        destructive: true,
      });
      if (!ok) return false;

      try {
        await releaseApi.deleteRelease({ params: { id: release.id } });
      } catch (error) {
        failure(error);
        return false;
      }
      toaster.success(tr("release.delete.done", { args: [label] }));
      await refetch(release.projectId);
      return true;
    },
    removeMany: async (selected) => {
      if (selected.length === 0) return false;
      const n = String(selected.length);
      const ok = await dialog.confirm({
        title: tr("release.bulk.delete.title", { args: [n] }),
        description: sentences([
          tr("release.bulk.delete.detached"),
          selected.some((release) => release.releasedAt)
            ? tr("release.bulk.delete.published")
            : undefined,
          selected.some((release) => release.defaultSince)
            ? tr("release.bulk.delete.default")
            : undefined,
        ]),
        confirmLabel: tr("release.bulk.delete.confirm", { args: [n] }),
        cancelLabel: tr("common.cancel"),
        destructive: true,
      });
      if (!ok) return false;

      // Every call settles, and the report says how many landed: one
      // refusal must not hide the deletes that went through, nor stop the
      // ones after it.
      const outcome = await settleBulk(
        selected.map((release) => release.id),
        (id) => releaseApi.deleteRelease({ params: { id } }),
      );
      reportBulk(
        outcome,
        tr("board.bulk.deleted", { args: [String(outcome.done.length)] }),
      );
      await refetch(selected[0].projectId);
      return true;
    },
  };
};

export interface DeleteRelease {
  /**
   * Whether this rank may delete a release. Hide the entry, and the checkbox
   * column with it, when false.
   */
  can: boolean;
  /**
   * Confirms, deletes, reports, and refreshes `currentReleasesAtom`.
   * Resolves `true` once the release is gone, so the caller knows to
   * refresh its own rows; `false` when the reader backed out or the server
   * refused, which has already been toasted.
   */
  remove: (release: ReleaseResource) => Promise<boolean>;
  /**
   * The same over a selection. Resolves `true` once the run happened, even
   * when some of it was refused (the toast says how many landed), so the
   * caller refreshes and clears; `false` only when the reader backed out.
   */
  removeMany: (selected: ReleaseResource[]) => Promise<boolean>;
}
