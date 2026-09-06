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
import { useClient, useQuery, useStore } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { Link } from "alepha/react/router";
import { useState } from "react";

import type { AppController } from "@/api/controllers/AppController.ts";
import type { ProjectEstateController } from "@/api/controllers/ProjectEstateController.ts";

import { currentInstanceAtom } from "../../../atoms/currentInstanceAtom.ts";
import { currentInstancesAtom } from "../../../atoms/currentInstancesAtom.ts";
import { currentProjectAtom } from "../../../atoms/currentProjectAtom.ts";
import { currentProjectMemberAtom } from "../../../atoms/currentProjectMemberAtom.ts";
import type { I18n } from "../../../services/I18n.ts";

/**
 * The value the select carries for "no estate".
 *
 * Not the empty string: Base UI reads that as "nothing selected" and shows the
 * placeholder instead of the row, so the option would be unpickable once an
 * estate had been chosen.
 */
const CLEARED = "__none__";

/**
 * Where this deployed copy deploys to.
 *
 * **The estate is per instance, never per app**, which is the case the whole
 * level exists for: `docs` deploys to Cloudflare and `bay` runs on the OVH VPS,
 * and both are "production", so one row per environment could not serve both.
 *
 * ## Why it ships before there is anything to deploy
 *
 * There is no Deploy tab in v3 - that is epic #1's - and this row is still
 * worth having. An estate is a FACT about the instance whether or not a deploy
 * exists yet, and without the row `AppService.setEstate`'s lending check and
 * `EstateService.assertUnreferenced`'s two refusals would be live code that no
 * user path can reach and no e2e can drive.
 *
 * ## The list is what the project was LENT
 *
 * `listProjectEstates` is the same read the project's own Estates settings page
 * does. The select never offers anything else, and the server validates against
 * `estate_projects` regardless: an estate is owned by a user and lent to a
 * project, so resolving an id against `estates` directly would let a project
 * point at somebody else's cloud account.
 *
 * With nothing lent, the row says so in words and links to the page that lends
 * one, the way that page's own empty state does. Offering an empty select would
 * be a control that changes nothing.
 */
const AppSettingsEstate = () => {
  const { tr } = useI18n<I18n, "en">();
  const toaster = useToast();
  const appApi = useClient<AppController>();
  const estateApi = useClient<ProjectEstateController>();

  const [project] = useStore(currentProjectAtom);
  const [member] = useStore(currentProjectMemberAtom);
  const [instance, setInstance] = useStore(currentInstanceAtom);
  const [instances, setInstances] = useStore(currentInstancesAtom);
  const [busy, setBusy] = useState(false);

  const { data } = useQuery(
    {
      enabled: Boolean(project),
      key: ["project-estates", project?.id],
      handler: async () => {
        if (!project) return undefined;
        return await estateApi.listProjectEstates({
          params: { projectId: project.id },
        });
      },
    },
    [project?.id],
  );

  if (!project || !instance) {
    return null;
  }

  const isOwner = member?.owner ?? false;
  const estates = data?.items ?? [];

  const select = async (estateId: string | undefined) => {
    setBusy(true);
    try {
      const updated = await appApi.updateApp({
        params: {
          projectId: project.id,
          app: instance.app,
          env: instance.env,
        },
        // `null` clears it, which is a real operation: an instance that was
        // pointed at the wrong estate has to be able to stop pointing anywhere.
        body: { estateId: estateId ?? null },
      });
      setInstance(updated);
      setInstances(
        (instances ?? []).map((it) => (it.id === updated.id ? updated : it)),
      );
      toaster.success(tr("app.settings.estate.saved"));
    } catch (error) {
      toaster.error(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <SettingsSection
      title={tr("app.settings.estate.title")}
      description={tr("app.settings.estate.description")}
    >
      <SettingsRow
        label={tr("app.settings.estate.label")}
        description={
          estates.length === 0
            ? tr("app.settings.estate.none")
            : tr("app.settings.estate.rowDescription")
        }
      >
        {estates.length === 0 ? (
          <Link
            className="text-primary text-sm underline-offset-4 hover:underline"
            href={`/${project.slug}/settings/estates`}
          >
            {tr("app.settings.estate.manage")}
          </Link>
        ) : (
          // A plain select rather than `ControlSelect`: that one binds to a
          // `useForm` field, and this row has no form - it saves on change,
          // because "which estate" is one choice with nothing else to submit
          // beside it.
          <Select
            value={instance.estateId ?? CLEARED}
            disabled={!isOwner || busy}
            onValueChange={(value) =>
              void select(value === CLEARED ? undefined : String(value))
            }
          >
            <SelectTrigger
              className="w-full sm:w-72"
              aria-label={String(tr("app.settings.estate.label"))}
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {/* Clearing is a real operation: an instance pointed at the
                  wrong estate has to be able to stop pointing anywhere. A
                  sentinel rather than `""`, which Base UI reads as "no
                  value" and renders as the placeholder. */}
              <SelectItem value={CLEARED}>
                {tr("app.settings.estate.clear")}
              </SelectItem>
              {estates.map((estate) => (
                <SelectItem key={estate.id} value={estate.id}>
                  {estate.label
                    ? `${estate.slug} (${estate.label})`
                    : estate.slug}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </SettingsRow>
    </SettingsSection>
  );
};

export default AppSettingsEstate;
