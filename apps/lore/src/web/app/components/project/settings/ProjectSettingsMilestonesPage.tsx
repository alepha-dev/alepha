import { AutoForm } from "@alepha/ui/components/auto-form/auto-form";
import { z } from "alepha";
import { useAlepha, useClient, useStore } from "alepha/react";
import { useForm } from "alepha/react/form";
import { useI18n } from "alepha/react/i18n";
import { Hourglass } from "lucide-react";

import type { ProjectController } from "@/api/controllers/ProjectController.ts";
import { currentProjectAtom } from "@/web/app/atoms/currentProjectAtom.ts";
import { userProjectsAtom } from "@/web/app/atoms/userProjectsAtom.ts";
import type { I18n } from "@/web/app/services/I18n.ts";

import ProjectSettingsFeatureSection from "./ProjectSettingsFeatureSection.tsx";
import { useProjectFeatureToggle } from "./useProjectFeatureToggle.ts";

const DURATION_SENTINEL_MANUAL = "manual";

const ProjectSettingsMilestonesPage = () => {
  const { enabled, toggle } = useProjectFeatureToggle("milestones");
  const { tr } = useI18n<I18n, "en">();
  const [project] = useStore(currentProjectAtom);
  const projectApi = useClient<ProjectController>();
  const alepha = useAlepha();

  const form = useForm({
    initialValues: {
      milestoneDuration: project?.milestoneDuration ?? DURATION_SENTINEL_MANUAL,
    },
    schema: z.object({
      milestoneDuration: z.string().optional(),
    }),
    handler: async (values) => {
      if (!project) return;
      const duration =
        values.milestoneDuration === DURATION_SENTINEL_MANUAL
          ? null
          : (values.milestoneDuration ?? null);
      const updated = await projectApi.updateProjectById({
        params: { id: project.id },
        body: { milestoneDuration: duration },
      });
      alepha.store.set(currentProjectAtom, updated);
      const overview = alepha.store.get(userProjectsAtom);
      if (overview) {
        alepha.store.set(userProjectsAtom, {
          ...overview,
          // `updateProjectById`'s response has neither `areaCount` nor
          // `openQuestCount` — only
          // `getHomeOverview` computes that — so carry the existing one
          // forward rather than dropping it to 0.
          projects: overview.projects.map((c) =>
            c.id === updated.id
              ? {
                  ...updated,
                  areaCount: c.areaCount,
                  openQuestCount: c.openQuestCount,
                }
              : c,
          ),
        });
      }
    },
  });

  return (
    <div className="flex flex-col gap-4">
      <ProjectSettingsFeatureSection
        featureKey="milestones"
        enabled={enabled}
        onToggle={toggle}
      />
      {enabled && (
        <div className="flex flex-col gap-2">
          <span className="text-sm">
            {tr("project.settings.milestones.release.title")}
          </span>
          <AutoForm
            form={form}
            autoSave
            layout="row"
            groups={[{ fields: ["milestoneDuration"] }]}
            fields={{
              milestoneDuration: {
                icon: Hourglass,
                select: true,
                items: [
                  {
                    value: DURATION_SENTINEL_MANUAL,
                    label: String(
                      tr("project.settings.milestones.duration.manual"),
                    ),
                  },
                  {
                    value: "P7D",
                    label: tr("project.settings.milestones.duration.1w"),
                  },
                  {
                    value: "P14D",
                    label: tr("project.settings.milestones.duration.2w"),
                  },
                  {
                    value: "P1M",
                    label: String(
                      tr("project.settings.milestones.duration.1mo"),
                    ),
                  },
                  {
                    value: "P3M",
                    label: String(
                      tr("project.settings.milestones.duration.3mo"),
                    ),
                  },
                ],
              },
            }}
          />
        </div>
      )}
    </div>
  );
};

export default ProjectSettingsMilestonesPage;
