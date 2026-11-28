import { Button, CardContent } from "@alepha/ui";
import { Control } from "@alepha/ui/form";
import { SettingsSection } from "@alepha/ui/settings";
import { z } from "alepha";
import { useAction, useClient, useQuery, useStore } from "alepha/react";
import { useForm } from "alepha/react/form";
import { useI18n } from "alepha/react/i18n";

import type { ProjectThresholdController } from "../../../../../api/controllers/ProjectThresholdController.ts";
import { currentProjectAtom } from "../../../atoms/currentProjectAtom.ts";
import type { I18n } from "../../../services/I18n.ts";

export interface ProjectSettingsThresholdProps {
  /**
   * `coverage`: line coverage on `main`, in percent, alerted when a push
   * brings it under. `errors`: open errors, alerted by the hourly check
   * when the count goes over.
   */
  kind: "coverage" | "errors";
}

/**
 * One alert threshold of the project (#Q3894), with no schedule to pick:
 * in core since #Q4059, as Ship's Errors tab and Build's Quality tab both
 * hold one.
 * whoever is notified of its event on Settings > Notifications is told
 * when the value crosses it, once, and again only after it came back.
 * Empty means no threshold, and no alert.
 */
const ProjectSettingsThreshold = (props: ProjectSettingsThresholdProps) => {
  const { tr } = useI18n<I18n, "en">();
  const api = useClient<ProjectThresholdController>();
  const [project] = useStore(currentProjectAtom);
  const projectId = project?.id ?? 0;
  const key = ["project-thresholds", projectId];
  const coverage = props.kind === "coverage";
  const current = useQuery(
    {
      key,
      enabled: !!project,
      handler: ({ signal }) =>
        api.getProjectThresholds(
          { params: { projectId } },
          { request: { signal } },
        ),
    },
    [projectId],
  );
  const save = useAction<[value: number | undefined], void>(
    {
      handler: async (_ctx, value) => {
        await api.setProjectThresholds({
          params: { projectId },
          body: coverage
            ? { coverageMin: value ?? null }
            : { openErrorsMax: value ?? null },
        });
      },
      invalidates: [key],
    },
    [api, projectId, coverage],
  );
  const initial = coverage
    ? current.data?.coverageMin
    : current.data?.openErrorsMax;
  const form = useForm(
    {
      schema: z.object({
        value: coverage
          ? z.number().min(0).max(100).optional()
          : z.integer().min(0).max(1_000_000).optional(),
      }),
      initialValues: { value: initial ?? undefined },
      handler: async ({ value }) => {
        await save.run(value);
      },
    },
    [initial],
  );

  return (
    <SettingsSection>
      <CardContent className="px-4 py-3">
        <form
          {...form.props}
          className="flex flex-col gap-3 sm:grid sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center sm:gap-6"
          data-testid={`threshold-${props.kind}`}
        >
          <Control
            input={form.input.value}
            label={tr(`thresholds.${props.kind}.label`)}
            description={tr(`thresholds.${props.kind}.hint`)}
            disabled={save.loading}
          />
          <div className="flex justify-start sm:justify-end">
            <Button type="submit" variant="outlined" loading={save.loading}>
              {tr("thresholds.save")}
            </Button>
          </div>
        </form>
      </CardContent>
    </SettingsSection>
  );
};

export default ProjectSettingsThreshold;
