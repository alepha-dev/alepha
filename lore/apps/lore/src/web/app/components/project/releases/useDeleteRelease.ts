import { useDialog } from "@alepha/ui/components/use-dialog/use-dialog";
import { useToast } from "@alepha/ui/components/use-toast/use-toast";
import { useClient, useStore } from "alepha/react";
import { useI18n } from "alepha/react/i18n";

import type { ReleaseController } from "@/api/controllers/ReleaseController.ts";
import type { ReleaseResource } from "@/api/schemas/releaseResourceSchema.ts";
import { currentReleasesAtom } from "@/web/app/atoms/currentReleasesAtom.ts";
import type { I18n } from "@/web/app/services/I18n.ts";

import { formatReference } from "../../shared/element/typedReference.ts";

/**
 * Delete a release, after saying what the row does not show.
 *
 * `ReleaseController.deleteRelease` existed for a long time with nothing in
 * the web app calling it, so a release created by mistake could only be
 * removed from the MCP. The Releases table's row menu is the door now.
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
 * At most one of the two ever applies: publishing clears the default, and
 * `setDefaultRelease` refuses a published release. The description is still
 * built as sentences joined rather than a branch per case, because
 * `ConfirmOptions.description` is a string and a list cannot be drawn in it.
 *
 * ⚠️ **No guard is added anywhere.** The server stays as permissive as the
 * MCP; a UI that refuses what the MCP allows is a second rule that drifts
 * from the first. The dialog is where the loss is named, not where it is
 * prevented.
 *
 * ⚠️ **It refetches `currentReleasesAtom`.** The sidebar, both release
 * controls and the Epics and Quests release filters read the atom, and none
 * of them watches the table this is called from.
 */
export const useDeleteRelease = (): DeleteRelease => {
  const releaseApi = useClient<ReleaseController>();
  const { tr } = useI18n<I18n, "en">();
  const dialog = useDialog();
  const toaster = useToast();
  const [, setReleases] = useStore(currentReleasesAtom);

  const name = (release: ReleaseResource): string =>
    release.tag ?? formatReference("release", release.number);

  return {
    can: releaseApi.deleteRelease.can(),
    remove: async (release) => {
      const label = name(release);
      const description = [
        String(tr("release.delete.detached", { args: [label] })),
        release.releasedAt
          ? String(tr("release.delete.published", { args: [label] }))
          : undefined,
        release.defaultSince
          ? String(tr("release.delete.default", { args: [label] }))
          : undefined,
      ]
        .filter((sentence): sentence is string => Boolean(sentence))
        .join(" ");

      const ok = await dialog.confirm({
        title: String(tr("release.delete.title", { args: [label] })),
        description,
        confirmLabel: String(tr("release.delete.action")),
        cancelLabel: String(tr("common.cancel")),
        destructive: true,
      });
      if (!ok) return false;

      try {
        await releaseApi.deleteRelease({ params: { id: release.id } });
      } catch (error) {
        toaster.error(error instanceof Error ? error.message : String(error));
        return false;
      }
      toaster.success(String(tr("release.delete.done", { args: [label] })));
      // The release is gone whatever this answers, so a failed refetch is
      // reported and still resolves `true`: the caller's rows must go too.
      try {
        setReleases(
          await releaseApi.getReleases({
            params: { projectId: release.projectId },
          }),
        );
      } catch (error) {
        toaster.error(error instanceof Error ? error.message : String(error));
      }
      return true;
    },
  };
};

export interface DeleteRelease {
  /**
   * Whether this rank may delete a release. Hide the entry when false.
   */
  can: boolean;
  /**
   * Confirms, deletes, reports, and refreshes `currentReleasesAtom`.
   * Resolves `true` once the release is gone, so the caller knows to
   * refresh its own rows; `false` when the reader backed out or the server
   * refused, which has already been toasted.
   */
  remove: (release: ReleaseResource) => Promise<boolean>;
}
