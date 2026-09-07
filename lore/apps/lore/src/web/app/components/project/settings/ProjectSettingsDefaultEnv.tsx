import { Control } from "@alepha/ui/components/control/control";
import { SettingsRow } from "@alepha/ui/components/settings/settings-row";
import { SettingsSection } from "@alepha/ui/components/settings/settings-section";
import { useToast } from "@alepha/ui/components/use-toast/use-toast";
import { z } from "alepha";
import { useAlepha, useClient, useStore } from "alepha/react";
import { useForm } from "alepha/react/form";
import { useI18n } from "alepha/react/i18n";
import { useState } from "react";

import type { ProjectController } from "@/api/controllers/ProjectController.ts";
import { setCurrentProject } from "@/web/app/services/currentProjectWrite.ts";

import { currentInstancesAtom } from "../../../atoms/currentInstancesAtom.ts";
import { currentProjectAtom } from "../../../atoms/currentProjectAtom.ts";
import type { I18n } from "../../../services/I18n.ts";
import { useRank } from "../../shared/useRank.ts";

/**
 * ⚠️ `.optional()`, and that is the control's whole clearing story: `Control`
 * offers its clear row only for a nullable field, and picking it writes
 * `undefined`. The sentinel this replaced (`CLEARED = "__none__"`) existed
 * because Base UI's raw `Select` reserves the empty string as its own
 * no-selection marker, so a real "none" option could not be picked - a
 * problem `ControlSelect` already solved internally.
 */
const defaultEnvFieldSchema = z.object({ defaultEnv: z.text().optional() });

/**
 * Which environment this project means when a command names none.
 *
 * ## Why the column needed a control the day it shipped
 *
 * `projects.defaultEnv` is read by `lore apps build|deploy` and by
 * `defaultAppInstance`, so without this row it would be a flag nobody can set,
 * which is folio #1172's failure. It ships in the same commit as the column
 * for that reason and no other.
 *
 * ## On the Apps page rather than General
 *
 * #1811 said General. It is here because an environment is an Apps concept:
 * a project without the Apps capability has no environments at all, so the row
 * would be a control over nothing. Every other app-shaped project setting -
 * the blight ignore rules - is already on this page for the same reason.
 *
 * ## A select over what exists, not a text field
 *
 * The column deliberately accepts a value naming no row, so an operator can
 * set the env they are about to create, and `defaultAppInstance` falls through
 * to its fixed rule when it names nothing. That tolerance is what makes a text
 * field the wrong control here: a typo would be accepted, change nothing, and
 * say nothing. The API still takes any valid name, so the CLI and MCP keep the
 * looser door.
 *
 * With no instance at all the row says so, the way the estate row does.
 * Offering an empty select would be a control that changes nothing.
 *
 * ## ⚠️ The save goes through `setCurrentProject`, never `setProject`
 *
 * `updateProjectById` answers `projectResourceSchema`, which does not carry
 * `permissions` - that field lives on the EXTENDED response the layout loader
 * uses, deliberately, because the plain schema is also the shape of
 * `getMyProjects` and the Kanban payload. Writing the update response
 * straight into the atom therefore replaced a project that HAS an effective
 * permission set with one that does not, and `canInProject` answers **false**
 * for an absent set - so every permission-gated nav entry disappeared and the
 * whole sidebar emptied until the next full load (feedback #P2141).
 *
 * `setCurrentProject` carries `permissions` and `rank` forward. It is the one
 * sanctioned way to write that atom from a narrow response, and every other
 * settings surface already used it; this row was the one that reached for the
 * raw setter.
 */
const ProjectSettingsDefaultEnv = () => {
  const { tr } = useI18n<I18n, "en">();
  const { can } = useRank();
  const toaster = useToast();
  const alepha = useAlepha();
  const projectApi = useClient<ProjectController>();

  const [project] = useStore(currentProjectAtom);
  const [instances] = useStore(currentInstancesAtom);
  const [busy, setBusy] = useState(false);

  const form = useForm({
    schema: defaultEnvFieldSchema,
    // Re-seeded from the atom, so the field follows what the server agreed
    // to rather than what was clicked.
    initialValues: { defaultEnv: project?.defaultEnv ?? undefined },
    // Saving on change is what this control is - there is nothing else on
    // the row to submit beside it - so the form's own submit is never
    // reached. Same shape as `ProjectMemberRankPicker`.
    handler: () => {},
    onChange: (_key, value) =>
      void select(value === undefined ? undefined : String(value)),
  });

  if (!project) {
    return null;
  }

  // The permission the write itself takes, not a rank name: `updateProjectById`
  // is gated on `project:update`, so the control and the endpoint answer the
  // same question. ⚠️ Never the boundary; the server refuses regardless.
  const canEdit = can("project:update");
  // Distinct, because one environment usually holds several apps and the
  // default is a property of the project rather than of any one of them.
  const envs = [...new Set((instances ?? []).map((it) => it.env))].sort();

  const select = async (env: string | undefined) => {
    const previous = project.defaultEnv ?? undefined;
    if (env === previous) return;
    setBusy(true);
    try {
      const updated = await projectApi.updateProjectById({
        params: { id: project.id },
        // `null` clears it, which is a real operation: a project that named
        // the wrong environment has to be able to stop naming one.
        body: { defaultEnv: env ?? null },
      });
      setCurrentProject(alepha, updated);
      toaster.success(tr("project.settings.apps.defaultEnv.saved"));
    } catch (error) {
      // Back to what the server still says: nothing refetches on a refusal,
      // so the field would otherwise keep showing an environment the project
      // does not have.
      form.input.defaultEnv.set(previous);
      toaster.error(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <SettingsSection
      title={tr("project.settings.apps.defaultEnv.title")}
      description={tr("project.settings.apps.defaultEnv.description")}
    >
      <SettingsRow
        label={tr("project.settings.apps.defaultEnv.label")}
        description={
          envs.length === 0
            ? tr("project.settings.apps.defaultEnv.none")
            : project.defaultEnv
              ? tr("project.settings.apps.defaultEnv.rowDescription")
              : tr("project.settings.apps.defaultEnv.fallback")
        }
      >
        {envs.length > 0 && (
          <Control
            select
            input={form.input.defaultEnv}
            label=""
            disabled={!canEdit || busy}
            triggerClassName="w-full sm:w-72"
            items={envs}
            // The clear row, and the trigger's text while nothing is chosen -
            // `clearLabel` is both, which is why the string reads as a state
            // and not as a verb.
            clearable
            clearLabel={String(tr("project.settings.apps.defaultEnv.clear"))}
            inputProps={{
              "aria-label": String(
                tr("project.settings.apps.defaultEnv.label"),
              ),
            }}
          />
        )}
      </SettingsRow>
    </SettingsSection>
  );
};

export default ProjectSettingsDefaultEnv;
