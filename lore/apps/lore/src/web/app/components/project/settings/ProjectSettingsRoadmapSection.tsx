import { SettingsRow } from "@alepha/ui/components/settings/settings-row";
import { SettingsSection } from "@alepha/ui/components/settings/settings-section";
import { Button } from "@alepha/ui/components/ui/button";
import { Segmented } from "@alepha/ui/components/ui/segmented";
import { useDialog } from "@alepha/ui/components/use-dialog/use-dialog";
import { useToast } from "@alepha/ui/components/use-toast/use-toast";
import { useAlepha, useClient, useStore } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { Copy } from "lucide-react";
import { useState } from "react";

import type { ProjectController } from "@/api/controllers/ProjectController.ts";
import type { RoadmapVisibility } from "@/api/schemas/roadmapVisibilitySchema.ts";
import { currentProjectAtom } from "@/web/app/atoms/currentProjectAtom.ts";
import type { I18n } from "@/web/app/services/I18n.ts";

/**
 * Who may read `/:projectSlug/roadmap`, and the two things the owner has to
 * know before they decide.
 *
 * It sits on the Releases settings page because the roadmap IS the release
 * plan rendered for someone who does not use Lore daily. It is not a
 * `features.*` toggle: a tri-state does not fit a boolean bag, and adding a
 * key to `defaultProjectFeatures` changes the `projects.features` column
 * DEFAULT, which is the D1 table rebuild that cascade-wipes children.
 *
 * ⚠️ **Public is confirmed, not just switched.** Publishing a roadmap
 * publishes the titles of epics nobody has announced - planned epics are
 * shown on purpose, because a roadmap that hides unstarted work cannot answer
 * the question it exists for. The confirmation naming that outcome IS the
 * safeguard; there is no filter in the endpoint, since a filter there would
 * silently contradict the members page. The other two levels apply straight
 * away: neither discloses anything new.
 */
const ProjectSettingsRoadmapSection = () => {
  const { tr } = useI18n<I18n, "en">();
  const alepha = useAlepha();
  const dialog = useDialog();
  const toaster = useToast();
  const projectApi = useClient<ProjectController>();
  const [project] = useStore(currentProjectAtom);
  const [pending, setPending] = useState(false);

  if (!project) return null;

  const current: RoadmapVisibility = project.roadmapVisibility ?? "off";
  // Relative when there is no window (SSR, prerender): the settings page is
  // member-gated and therefore client-rendered, but a path is still the
  // honest answer rather than an origin invented on the server.
  const url =
    typeof window === "undefined"
      ? `/${project.slug}/roadmap`
      : `${window.location.origin}/${project.slug}/roadmap`;

  const apply = async (next: RoadmapVisibility) => {
    if (next === current) return;

    if (next === "public") {
      const confirmed = await dialog.confirm({
        title: tr("project.settings.roadmap.publicConfirm.title"),
        description: tr("project.settings.roadmap.publicConfirm.description"),
        confirmLabel: tr("project.settings.roadmap.publicConfirm.confirm"),
      });
      if (!confirmed) return;
    }

    setPending(true);
    try {
      const updated = await projectApi.updateProjectById({
        params: { id: project.id },
        // `off` is the absence of a preference rather than a value, so it
        // clears the column instead of writing a second way to say closed.
        body: { roadmapVisibility: next === "off" ? null : next },
      });
      alepha.store.set(currentProjectAtom, updated);
    } catch (error) {
      toaster.error(error instanceof Error ? error.message : String(error));
    } finally {
      setPending(false);
    }
  };

  return (
    <SettingsSection
      title={tr("project.settings.roadmap.title")}
      description={tr("project.settings.roadmap.description")}
    >
      <SettingsRow
        label={tr("project.settings.roadmap.visibility.label")}
        // The disclosure window is a property of the gate, not a caveat: the
        // project row reaches the roadmap through the 30 second `$ownsProject`
        // cache, so turning it back off is not instant. An owner who is told
        // has a property; one who is not has a bug.
        description={tr("project.settings.roadmap.delay")}
      >
        <Segmented
          size="sm"
          value={current}
          disabled={pending}
          onChange={(next) => {
            void apply(next as RoadmapVisibility);
          }}
          options={[
            { value: "off", label: tr("project.settings.roadmap.level.off") },
            {
              value: "members",
              label: tr("project.settings.roadmap.level.members"),
            },
            {
              value: "public",
              label: tr("project.settings.roadmap.level.public"),
            },
          ]}
        />
      </SettingsRow>

      {current === "off" ? null : (
        <SettingsRow
          label={tr("project.settings.roadmap.url.label")}
          description={url}
        >
          <Button
            size="sm"
            variant="outline"
            aria-label={tr("project.settings.roadmap.url.copy")}
            onClick={async () => {
              // The toast only after the write resolved: the clipboard call
              // rejects on an insecure context, and "copied" would be a lie.
              try {
                await navigator.clipboard.writeText(url);
                toaster.success(tr("project.settings.roadmap.url.copied"));
              } catch (error) {
                toaster.error(
                  error instanceof Error ? error.message : String(error),
                );
              }
            }}
          >
            <Copy />
          </Button>
        </SettingsRow>
      )}
    </SettingsSection>
  );
};

export default ProjectSettingsRoadmapSection;
