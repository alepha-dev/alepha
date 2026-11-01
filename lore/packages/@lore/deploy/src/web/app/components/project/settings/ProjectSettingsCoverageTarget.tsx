import { Button, Card, CardContent } from "@alepha/ui";
import { Control } from "@alepha/ui/form";
import type { ProjectController } from "@lore/core/api";
import {
  currentProjectAtom,
  type I18n,
  setCurrentProject,
} from "@lore/core/web";
import { z } from "alepha";
import { useAlepha, useClient, useStore } from "alepha/react";
import { useForm } from "alepha/react/form";
import { useI18n } from "alepha/react/i18n";

/**
 * The coverage target the Delivery tab draws as a line (#Q3010). Empty means
 * no target, and no line.
 */
const ProjectSettingsCoverageTarget = () => {
  const { tr } = useI18n<I18n, "en">();
  const alepha = useAlepha();
  const projectApi = useClient<ProjectController>();
  const [project] = useStore(currentProjectAtom);

  const form = useForm({
    schema: z.object({
      coverageTarget: z.integer().min(0).max(100).optional(),
    }),
    initialValues: { coverageTarget: project?.coverageTarget },
    handler: async ({ coverageTarget }) => {
      if (!project) {
        return;
      }
      const updated = await projectApi.updateProjectById({
        params: { id: project.id },
        body: { coverageTarget: coverageTarget ?? null },
      });
      setCurrentProject(alepha, updated);
    },
  });

  return (
    <Card>
      <CardContent>
        <form {...form.props} className="flex items-end gap-3">
          <Control
            input={form.input.coverageTarget}
            label={tr("project.settings.coverageTarget")}
            description={tr("project.settings.coverageTarget.hint")}
          />
          <Button type="submit" variant="outlined">
            {tr("project.settings.coverageTarget.save")}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
};

export default ProjectSettingsCoverageTarget;
