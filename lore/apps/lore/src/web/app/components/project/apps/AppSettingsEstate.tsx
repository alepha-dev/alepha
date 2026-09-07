import { Control } from "@alepha/ui/components/control/control";
import { SettingsRow } from "@alepha/ui/components/settings/settings-row";
import { SettingsSection } from "@alepha/ui/components/settings/settings-section";
import { useToast } from "@alepha/ui/components/use-toast/use-toast";
import { z } from "alepha";
import { useClient, useQuery, useStore } from "alepha/react";
import { useForm } from "alepha/react/form";
import { useI18n } from "alepha/react/i18n";
import { Link } from "alepha/react/router";
import { useState } from "react";

import type { AppController } from "@/api/controllers/AppController.ts";
import type { ProjectEstateController } from "@/api/controllers/ProjectEstateController.ts";
import { useRank } from "@/web/app/components/shared/useRank.ts";

import { currentInstanceAtom } from "../../../atoms/currentInstanceAtom.ts";
import { currentInstancesAtom } from "../../../atoms/currentInstancesAtom.ts";
import { currentProjectAtom } from "../../../atoms/currentProjectAtom.ts";
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
 * The one field this row is. Required, so `Control` does not make it
 * deselectable: clearing has its own row in the list, and a re-press of the
 * chosen estate must not silently post `null`.
 */
const estateFieldSchema = z.object({ estateId: z.text() });

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
  const { can } = useRank();
  const toaster = useToast();
  const appApi = useClient<AppController>();
  const estateApi = useClient<ProjectEstateController>();

  const [project] = useStore(currentProjectAtom);
  const [instance, setInstance] = useStore(currentInstanceAtom);
  const [instances, setInstances] = useStore(currentInstancesAtom);
  const [busy, setBusy] = useState(false);

  const form = useForm({
    schema: estateFieldSchema,
    // ⚠️ Re-seeded from the ATOM, which `select` writes on a successful save:
    // the field follows the server, and a refusal leaves it showing the estate
    // this instance actually points at.
    initialValues: { estateId: instance?.estateId ?? CLEARED },
    // Saves on change - "which estate" is one choice with nothing else to
    // submit beside it - so the form's own submit is never reached.
    handler: () => {},
    onChange: (_key, value) =>
      void select(value === CLEARED ? undefined : String(value)),
  });

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

  const isOwner = can("estate:lend");
  const estates = data?.items ?? [];

  const select = async (estateId: string | undefined) => {
    // ⚠️ Also the re-entrancy guard for the restore below: putting the field
    // back calls this again, and this line ends it.
    if ((estateId ?? CLEARED) === (instance.estateId ?? CLEARED)) return;
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
      // Back to what the instance still points at: nothing re-seeds the field
      // on a refusal, so it would otherwise keep showing an estate this copy
      // does not deploy to.
      form.input.estateId.set(instance.estateId ?? CLEARED);
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
          <Control
            select
            input={form.input.estateId}
            label=""
            disabled={!isOwner || busy}
            triggerClassName="w-full sm:w-72"
            inputProps={{
              "aria-label": String(tr("app.settings.estate.label")),
            }}
            items={[
              // Clearing is a real operation: an instance pointed at the
              // wrong estate has to be able to stop pointing anywhere. A
              // sentinel rather than `""`, which Base UI reads as "no value"
              // and renders as the placeholder.
              {
                value: CLEARED,
                label: String(tr("app.settings.estate.clear")),
              },
              ...estates.map((estate) => ({
                value: estate.id,
                label: estate.label
                  ? `${estate.slug} (${estate.label})`
                  : estate.slug,
              })),
            ]}
          />
        )}
      </SettingsRow>
    </SettingsSection>
  );
};

export default AppSettingsEstate;
