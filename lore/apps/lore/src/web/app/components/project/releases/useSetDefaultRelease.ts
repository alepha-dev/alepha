import { useDialog, useToast } from "@alepha/ui";
import { useAction, useClient, useStore } from "alepha/react";
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

  const apply = async (projectId: number, releaseId: number | null) => {
    setReleases(
      await releaseApi.setDefaultRelease({
        params: { projectId },
        body: { releaseId },
      }),
    );
  };

  // One `useAction` per verb (#E59 rule 1, #Q2326): `true` when it happened,
  // `false` when the reader backed out, `undefined` when the server refused,
  // which the root `ActionErrorToaster` has already shown.
  const setAction = useAction<[release: ReleaseResource], boolean>(
    {
      handler: async (release) => {
        const label = name(release);
        const ok = await dialog.confirm({
          title: tr("release.default.confirm.title", { args: [label] }),
          description: tr("release.default.confirm.description", {
            args: [label],
          }),
          confirmLabel: tr("release.default.set"),
          cancelLabel: tr("common.cancel"),
        });
        if (!ok) return false;
        await apply(release.projectId, release.id);
        return true;
      },
    },
    [releaseApi, dialog, tr],
  );

  const clearAction = useAction<[release: ReleaseResource], boolean>(
    {
      handler: async (release) => {
        await apply(release.projectId, null);
        toaster.success(
          tr("release.default.cleared", { args: [name(release)] }),
        );
        return true;
      },
    },
    [releaseApi, toaster, tr],
  );

  return {
    can: releaseApi.setDefaultRelease.can(),
    busy: setAction.loading || clearAction.loading,
    set: setAction.run,
    clear: clearAction.run,
  };
};

export interface SetDefaultRelease {
  /** Whether this rank may point intake anywhere. Hide the control when false. */
  can: boolean;
  /**
   * True while either verb runs. A second call made meanwhile is dropped, so
   * the caller disables its control for that time.
   */
  busy: boolean;
  set: (release: ReleaseResource) => Promise<boolean | undefined>;
  clear: (release: ReleaseResource) => Promise<boolean | undefined>;
}
