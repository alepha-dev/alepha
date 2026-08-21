import { Button } from "@alepha/ui/components/ui/button";
import { useI18n } from "alepha/react/i18n";
import { Link, useRouter } from "alepha/react/router";

import type { AreaDetail } from "@/api/schemas/areaResourceSchema.ts";
import type { AppRouter } from "@/web/app/AppRouter.ts";
import type { I18n } from "@/web/app/services/I18n.ts";

export interface ProjectSettingsAreaHeaderProps {
  area: AreaDetail;
  onRename: () => void;
  onDelete: () => void;
}

/**
 * Back link, the area's name as a heading, the Rename button, and Delete
 * only when the area is empty — a non-empty area is merged, not deleted
 * (see `AreaController.deleteArea`).
 */
const ProjectSettingsAreaHeader = (props: ProjectSettingsAreaHeaderProps) => {
  const { tr } = useI18n<I18n, "en">();
  const router = useRouter<AppRouter>();

  return (
    <div className="flex flex-col gap-2">
      <Link
        href={router.path("projectSettingsAreas")}
        className="text-muted-foreground text-xs"
      >
        {tr("area.detail.back")}
      </Link>
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-base font-semibold">{props.area.name}</h2>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={props.onRename}>
            {tr("area.detail.rename")}
          </Button>
          {props.area.questCount === 0 && (
            <Button variant="ghost" size="sm" onClick={props.onDelete}>
              {tr("project.settings.areas.delete.action")}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
};

export default ProjectSettingsAreaHeader;
