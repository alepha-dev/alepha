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
 * Point the project's intake at a release, or take it away.
 *
 * A hook rather than two copies, because two surfaces offer the same act:
 * the Releases table's row menu and the release page's plate. Both have to
 * confirm the same way, refresh the same atom and say the same thing
 * afterwards.
 *
 * ⚠️ **It writes `currentReleasesAtom` from the response.** The endpoint
 * answers the project's whole release list precisely so the chip can move
 * off one row and onto another without a second request; without this write
 * the chip stays on the old row until a navigation, because the atom is what
 * both chips read.
 *
 * ## Setting confirms, clearing does not
 *
 * Setting a default changes where every unfiled completion lands from that
 * moment on, invisibly, and the feature is invisible until used - so the
 * confirmation is where the one-line explanation of what a default release
 * IS gets said, at the moment somebody is deciding. Clearing only restores
 * the state every project starts in and is undone by setting it again, so it
 * asks nothing and reports what it did.
 */
export const useSetDefaultRelease = (): SetDefaultRelease => {
  const releaseApi = useClient<ReleaseController>();
  const { tr } = useI18n<I18n, "en">();
  const dialog = useDialog();
  const toaster = useToast();
  const [, setReleases] = useStore(currentReleasesAtom);

  const name = (release: ReleaseResource): string =>
    release.tag ?? formatReference("release", release.number);

  const apply = async (
    projectId: number,
    releaseId: number | null,
  ): Promise<boolean> => {
    try {
      setReleases(
        await releaseApi.setDefaultRelease({
          params: { projectId },
          body: { releaseId },
        }),
      );
      return true;
    } catch (error) {
      toaster.error(error instanceof Error ? error.message : String(error));
      return false;
    }
  };

  return {
    can: releaseApi.setDefaultRelease.can(),
    set: async (release) => {
      const label = name(release);
      const ok = await dialog.confirm({
        title: String(tr("release.default.confirm.title", { args: [label] })),
        description: String(
          tr("release.default.confirm.description", { args: [label] }),
        ),
        confirmLabel: String(tr("release.default.set")),
        cancelLabel: String(tr("common.cancel")),
      });
      if (!ok) return false;
      return await apply(release.projectId, release.id);
    },
    clear: async (release) => {
      const done = await apply(release.projectId, null);
      if (done) {
        toaster.success(
          String(tr("release.default.cleared", { args: [name(release)] })),
        );
      }
      return done;
    },
  };
};

export interface SetDefaultRelease {
  /** Whether this rank may point intake anywhere. Hide the control when false. */
  can: boolean;
  set: (release: ReleaseResource) => Promise<boolean>;
  clear: (release: ReleaseResource) => Promise<boolean>;
}
