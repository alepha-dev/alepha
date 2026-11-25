import { Control } from "@alepha/ui/form";
import { SettingsRow, SettingsSection } from "@alepha/ui/settings";
import type { ProjectController } from "@lore/core/api";
import {
  currentProjectAtom,
  type I18n,
  setCurrentProject,
  useRank,
} from "@lore/core/web";
import { z } from "alepha";
import { useAction, useAlepha, useClient, useStore } from "alepha/react";
import { useForm } from "alepha/react/form";
import { useI18n } from "alepha/react/i18n";

/**
 * Plan > Errors: whether a server error is trusted on arrival (#Q4257), so
 * agents read it at once, or waits for a member's trust like a browser one.
 * On by default. The switch decides new groups only; one already trusted
 * stays trusted. A one-field form whose change is the write.
 */
const ProjectSettingsTrustServerErrors = () => {
  const { tr } = useI18n<I18n, "en">();
  const alepha = useAlepha();
  const { can } = useRank();
  const projectApi = useClient<ProjectController>();
  const [project] = useStore(currentProjectAtom);
  const trusted = project?.trustServerErrors !== false;

  const save = useAction<[next: boolean], void>(
    {
      handler: async (_context, next) => {
        if (!project) return;
        const updated = await projectApi.updateProjectById({
          params: { id: project.id },
          // On is the default, stored as no value.
          body: { trustServerErrors: next ? null : false },
        });
        setCurrentProject(alepha, updated);
      },
    },
    [projectApi, project?.id],
  );
  const form = useForm({
    schema: z.object({ trusted: z.boolean() }),
    initialValues: { trusted },
    keepDirty: false,
    handler: async () => {},
    onChange: (_key, next) => {
      void save.run(next as boolean);
    },
  });

  if (!project) return null;

  return (
    <SettingsSection>
      <SettingsRow
        label={tr("errors.trustServer.title")}
        description={tr("errors.trustServer.description")}
      >
        <span data-testid="trust-server-errors">
          <Control
            input={form.input.trusted}
            aria-label={tr("errors.trustServer.title")}
            disabled={save.loading || !can("project:update")}
            switch
          />
        </span>
      </SettingsRow>
    </SettingsSection>
  );
};

export default ProjectSettingsTrustServerErrors;
