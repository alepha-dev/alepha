import { useDialog } from "@alepha/ui/components/use-dialog/use-dialog";
import { useToast } from "@alepha/ui/components/use-toast/use-toast";
import { useClient, useStore } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { useRouter } from "alepha/react/router";
import { useState } from "react";
import type { AreaController } from "@/api/controllers/AreaController.ts";
import type { AreaDetail } from "@/api/schemas/areaResourceSchema.ts";
import type { AppRouter } from "@/web/app/AppRouter.ts";
import { currentAreasAtom } from "@/web/app/atoms/currentAreasAtom.ts";
import type { I18n } from "@/web/app/services/I18n.ts";
import AreaRenameDialog from "./AreaRenameDialog.tsx";
import ProjectSettingsAreaDescription from "./ProjectSettingsAreaDescription.tsx";
import ProjectSettingsAreaHeader from "./ProjectSettingsAreaHeader.tsx";
import ProjectSettingsAreaQuests from "./ProjectSettingsAreaQuests.tsx";
import ProjectSettingsAreaStats from "./ProjectSettingsAreaStats.tsx";

export interface ProjectSettingsAreaPageProps {
  area: AreaDetail;
}

/**
 * The Area detail page: header (rename / delete), the activity rollup, the
 * description card, and a sample of what is filed here.
 *
 * `siblings` (for the rename dialog's merge-collision check) comes from
 * `currentAreasAtom`, filled by the `project` route loader — not refetched
 * here.
 */
const ProjectSettingsAreaPage = (props: ProjectSettingsAreaPageProps) => {
  const toaster = useToast();
  const dialog = useDialog();
  const { tr } = useI18n<I18n, "en">();
  const router = useRouter<AppRouter>();
  const areaApi = useClient<AreaController>();
  const [siblings] = useStore(currentAreasAtom);
  const [renaming, setRenaming] = useState(false);

  const remove = async () => {
    const ok = await dialog.confirm({
      title: String(tr("project.settings.areas.delete.confirm")),
      destructive: true,
    });
    if (!ok) return;
    try {
      await areaApi.deleteArea({ params: { id: props.area.id } });
      await router.push("projectSettingsAreas");
    } catch (error) {
      toaster.error(error instanceof Error ? error.message : String(error));
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <ProjectSettingsAreaHeader
        area={props.area}
        onRename={() => setRenaming(true)}
        onDelete={() => void remove()}
      />
      <ProjectSettingsAreaStats area={props.area} />
      <ProjectSettingsAreaDescription area={props.area} />
      <ProjectSettingsAreaQuests area={props.area} />
      <AreaRenameDialog
        open={renaming}
        area={props.area}
        siblings={siblings ?? []}
        onClose={() => setRenaming(false)}
        onRenamed={(areaId) =>
          void router.push("projectSettingsArea", {
            params: { areaId: String(areaId) },
            // Forced unconditionally, not just on a merge: on a PLAIN
            // rename the surviving id equals the path id, so an unforced
            // push targets the URL already on screen and
            // `ReactPageProvider.createLayers` reuses every layer's props
            // outright — the heading, stats and description would stay
            // stale with no error and no toast. `force: true` clears
            // `ReactBrowserProvider`'s `previous` layer list entirely
            // (not just this leaf), so it also re-runs the `project`
            // route's loader and refreshes `currentAreasAtom` for every
            // picker elsewhere in the app — see AppRouter.ts's `project`
            // loader. The merge branch re-runs anyway; the redundant
            // force there costs one loader round-trip.
            force: true,
          })
        }
      />
    </div>
  );
};

export default ProjectSettingsAreaPage;
