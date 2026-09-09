import { settingsCardEdge } from "@alepha/ui/components/settings/settings-card-edge.ts";
import { Button } from "@alepha/ui/components/ui/button";
import { Card, CardContent } from "@alepha/ui/components/ui/card";
import { useToast } from "@alepha/ui/components/use-toast/use-toast";
import { cn } from "@alepha/ui/lib/utils";
import { useClient, useStore } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { Download } from "lucide-react";

import type { ProjectQuestPortabilityController } from "@/api/controllers/ProjectQuestPortabilityController.ts";
import { currentProjectAtom } from "@/web/app/atoms/currentProjectAtom.ts";
import type { I18n } from "@/web/app/services/I18n.ts";

/**
 * Data section: export the project's quests as CSV. Rendered inside the
 * General settings page next to the project edit form and the danger zone,
 * sharing their visual pattern.
 *
 * ⚠️ **Export only.** The Import card, its preview dialog and
 * `ProjectSettingsImportDetailsModal` were deleted with quest import in epic
 * #E48. The card that is left is the reason the controller survives at all:
 * it is what stats are pulled from.
 */
const ProjectSettingsDataSection = () => {
  const { tr } = useI18n<I18n, "en">();
  const toaster = useToast();
  const [project] = useStore(currentProjectAtom);
  const api = useClient<ProjectQuestPortabilityController>();

  if (!project) return null;

  const handleExport = async () => {
    try {
      const file = await api.exportQuests({ params: { id: project.id } });
      const url = window.URL.createObjectURL(
        new Blob([await file.text()], { type: "text/csv" }),
      );
      const a = document.createElement("a");
      a.href = url;
      a.download = file.name;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);
    } catch (err) {
      toaster.error(
        err instanceof Error
          ? err.message
          : String(tr("project.settings.data.export.failed")),
      );
    }
  };

  return (
    <div className="flex flex-col gap-2">
      <span className="text-sm">{tr("project.settings.data.title")}</span>
      <Card className={cn(settingsCardEdge, "gap-0 divide-y py-0")}>
        <CardContent className="flex flex-col gap-3 px-4 py-3 sm:grid sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center sm:gap-6">
          <div className="flex flex-col gap-0.5">
            <span className="text-sm font-medium">
              {tr("project.settings.data.export.title")}
            </span>
            <span className="text-muted-foreground text-xs">
              {tr("project.settings.data.export.subtitle")}
            </span>
          </div>
          <div className="flex justify-start sm:justify-end">
            <Button onClick={handleExport}>
              <Download className="size-4" />
              {tr("project.settings.data.export.button")}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default ProjectSettingsDataSection;
