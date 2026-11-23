import { Switch } from "@alepha/ui";
import { SettingsRow } from "@alepha/ui/settings";
import type { ProjectController } from "@lore/core/api";
import {
  type CapabilityRowProps,
  currentProjectAtom,
  setCurrentProject,
  type I18n,
} from "@lore/core/web";
import { useAction, useAlepha, useClient, useStore } from "alepha/react";
import { useI18n } from "alepha/react/i18n";

/**
 * The roadmap on or off (#Q4060), on General > Capabilities under Plan,
 * after Requirements (#Q4184): registered on core's `CapabilityRowRegistry`
 * by `WorkShell`, since the page is core's.
 *
 * Not a capability option: the switch is `projects.roadmapVisibility` seen
 * as a boolean. Off is the `off` level, which already refuses everyone and
 * 404s the page; on is `members`, the level that discloses nothing new. Who
 * may read it beyond the members (Public) is chosen on the Roadmap tab, which
 * is listed only while this is on. A boolean option beside the column would
 * have been a second way to say off, and every project with a roadmap today
 * would have read it as off until a migration wrote it.
 */
const ProjectSettingsRoadmapSwitch = (props: CapabilityRowProps) => {
  const { tr } = useI18n<I18n, "en">();
  const alepha = useAlepha();
  const projectApi = useClient<ProjectController>();
  const [project] = useStore(currentProjectAtom);
  const on = (project?.roadmapVisibility ?? "off") !== "off";

  const toggle = useAction<[next: boolean], void>(
    {
      handler: async (_ctx, next) => {
        if (!project || next === on) return;
        const updated = await projectApi.updateProjectById({
          params: { id: project.id },
          // Off clears the column, as the Roadmap tab's levels did.
          body: { roadmapVisibility: next ? "members" : null },
        });
        setCurrentProject(alepha, updated);
      },
    },
    [projectApi, alepha, project, on],
  );

  if (!project) return null;

  return (
    <SettingsRow
      className={props.className}
      label={tr("project.settings.roadmap.title")}
      description={tr("project.settings.roadmap.switch.description")}
    >
      <Switch
        checked={on}
        disabled={
          props.disabled ||
          toggle.loading ||
          !projectApi.updateProjectById.can()
        }
        onCheckedChange={(value) => {
          void toggle.run(value);
        }}
        aria-label={tr("project.settings.roadmap.title")}
      />
    </SettingsRow>
  );
};

export default ProjectSettingsRoadmapSwitch;
