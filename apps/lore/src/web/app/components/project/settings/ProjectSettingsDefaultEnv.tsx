import { SettingsRow } from "@alepha/ui/components/settings/settings-row";
import { SettingsSection } from "@alepha/ui/components/settings/settings-section";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@alepha/ui/components/ui/select";
import { useToast } from "@alepha/ui/components/use-toast/use-toast";
import { useClient, useStore } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { useState } from "react";

import type { ProjectController } from "@/api/controllers/ProjectController.ts";

import { currentInstancesAtom } from "../../../atoms/currentInstancesAtom.ts";
import { currentProjectAtom } from "../../../atoms/currentProjectAtom.ts";
import { currentProjectMemberAtom } from "../../../atoms/currentProjectMemberAtom.ts";
import type { I18n } from "../../../services/I18n.ts";

/**
 * The value the select carries for "no default".
 *
 * Not the empty string, for the reason `AppSettingsEstate` records: Base UI
 * reads that as "nothing selected" and shows the placeholder instead of the
 * row, so the option would be unpickable once an environment had been chosen.
 */
const CLEARED = "__none__";

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
 */
const ProjectSettingsDefaultEnv = () => {
  const { tr } = useI18n<I18n, "en">();
  const toaster = useToast();
  const projectApi = useClient<ProjectController>();

  const [project, setProject] = useStore(currentProjectAtom);
  const [member] = useStore(currentProjectMemberAtom);
  const [instances] = useStore(currentInstancesAtom);
  const [busy, setBusy] = useState(false);

  if (!project) {
    return null;
  }

  const isOwner = member?.owner ?? false;
  // Distinct, because one environment usually holds several apps and the
  // default is a property of the project rather than of any one of them.
  const envs = [...new Set((instances ?? []).map((it) => it.env))].sort();

  const select = async (env: string | undefined) => {
    setBusy(true);
    try {
      const updated = await projectApi.updateProjectById({
        params: { id: project.id },
        // `null` clears it, which is a real operation: a project that named
        // the wrong environment has to be able to stop naming one.
        body: { defaultEnv: env ?? null },
      });
      setProject(updated);
      toaster.success(tr("project.settings.apps.defaultEnv.saved"));
    } catch (error) {
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
          <Select
            value={project.defaultEnv ?? CLEARED}
            disabled={!isOwner || busy}
            onValueChange={(value) =>
              void select(value === CLEARED ? undefined : String(value))
            }
          >
            <SelectTrigger
              className="w-full sm:w-72"
              aria-label={String(tr("project.settings.apps.defaultEnv.label"))}
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={CLEARED}>
                {tr("project.settings.apps.defaultEnv.clear")}
              </SelectItem>
              {envs.map((env) => (
                <SelectItem key={env} value={env}>
                  {env}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </SettingsRow>
    </SettingsSection>
  );
};

export default ProjectSettingsDefaultEnv;
