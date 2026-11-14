import { useToast } from "@alepha/ui";
import { Control } from "@alepha/ui/form";
import { SettingsRow, SettingsSection } from "@alepha/ui/settings";
import { useRank, currentProjectAtom, type I18n } from "@lore/core/web";
import { z } from "alepha";
import { useClient, useQuery, useStore } from "alepha/react";
import { useForm } from "alepha/react/form";
import { useI18n } from "alepha/react/i18n";
import { Link } from "alepha/react/router";
import { useState } from "react";

import type { AppController } from "../../../../../api/controllers/AppController.ts";
import type { ProjectHostController } from "../../../../../api/controllers/ProjectHostController.ts";
import { currentInstanceAtom } from "../../../atoms/currentInstanceAtom.ts";
import { currentInstancesAtom } from "../../../atoms/currentInstancesAtom.ts";

/**
 * The value the select carries for "no host".
 *
 * Not the empty string: Base UI reads that as "nothing selected" and shows the
 * placeholder instead of the row, so the option would be unpickable once an
 * host had been chosen.
 */
const CLEARED = "__none__";

/**
 * The one field this row is. Required, so `Control` does not make it
 * deselectable: clearing has its own row in the list, and a re-press of the
 * chosen host must not silently post `null`.
 */
const hostFieldSchema = z.object({ hostId: z.text() });

/**
 * Where this deployed copy deploys to.
 *
 * **The host is per instance, never per app**, which is the case the whole
 * level exists for: `docs` deploys to Cloudflare and `bay` runs on the OVH VPS,
 * and both are "production", so one row per environment could not serve both.
 *
 * ## Why it ships before there is anything to deploy
 *
 * There is no Deploy tab in v3 - that is epic #1's - and this row is still
 * worth having. A host is a FACT about the instance whether or not a deploy
 * exists yet, and without the row `AppService.setHost`'s lending check and
 * `HostService.assertUnreferenced`'s two refusals would be live code that no
 * user path can reach and no e2e can drive.
 *
 * ## The list is what the project was LENT
 *
 * `listProjectHosts` is the same read the project's own Hosts settings page
 * does. The select never offers anything else, and the server validates against
 * `host_projects` regardless: a host belongs to its home project and is lent to a
 * project, so resolving an id against `hosts` directly would let a project
 * point at somebody else's cloud account.
 *
 * With nothing lent, the row says so in words and links to the page that lends
 * one, the way that page's own empty state does. Offering an empty select would
 * be a control that changes nothing.
 */
const AppSettingsHost = () => {
  const { tr } = useI18n<I18n, "en">();
  const { can } = useRank();
  const toaster = useToast();
  const appApi = useClient<AppController>();
  const hostApi = useClient<ProjectHostController>();

  const [project] = useStore(currentProjectAtom);
  const [instance, setInstance] = useStore(currentInstanceAtom);
  const [instances, setInstances] = useStore(currentInstancesAtom);
  const [busy, setBusy] = useState(false);

  const form = useForm({
    schema: hostFieldSchema,
    // ⚠️ Re-seeded from the ATOM, which `select` writes on a successful save:
    // the field follows the server, and a refusal leaves it showing the host
    // this instance actually points at.
    initialValues: { hostId: instance?.hostId ?? CLEARED },
    // Saves on change - "which host" is one choice with nothing else to
    // submit beside it - so the form's own submit is never reached.
    handler: () => {},
    onChange: (_key, value) =>
      void select(value === CLEARED ? undefined : String(value)),
  });

  const { data } = useQuery(
    {
      enabled: Boolean(project),
      key: ["project-hosts", project?.id],
      handler: async () => {
        if (!project) return undefined;
        return await hostApi.listProjectHosts({
          params: { projectId: project.id },
        });
      },
    },
    [project?.id],
  );

  if (!project || !instance) {
    return null;
  }

  // A member of a stack takes its host from the stack environment, never
  // from this row (#Q2695): saying so is the whole row, since a picker here
  // would be a second place to choose it that nothing reads.
  if (instance.stack) {
    return (
      <SettingsSection
        id="host"
        title={tr("app.settings.host.title")}
        description={tr("app.settings.host.description")}
      >
        <SettingsRow
          label={tr("app.settings.host.label")}
          description={tr("app.settings.host.member", {
            args: [`${instance.stack.name}/${instance.stack.env}`],
          })}
        >
          <span data-testid="app-settings-host-member" className="text-sm">
            {`${instance.stack.name}/${instance.stack.env}`}
          </span>
        </SettingsRow>
      </SettingsSection>
    );
  }

  const isOwner = can("host:lend");
  const hosts = data?.items ?? [];

  const select = async (hostId: string | undefined) => {
    // ⚠️ Also the re-entrancy guard for the restore below: putting the field
    // back calls this again, and this line ends it.
    if ((hostId ?? CLEARED) === (instance.hostId ?? CLEARED)) return;
    setBusy(true);
    try {
      const updated = await appApi.updateApp({
        params: {
          projectId: project.id,
          app: instance.app,
          env: instance.env,
        },
        // `null` clears it, which is a real operation: an instance that was
        // pointed at the wrong host has to be able to stop pointing anywhere.
        body: { hostId: hostId ?? null },
      });
      setInstance(updated);
      setInstances(
        (instances ?? []).map((it) => (it.id === updated.id ? updated : it)),
      );
      toaster.success(tr("app.settings.host.saved"));
    } catch (error) {
      // Back to what the instance still points at: nothing re-seeds the field
      // on a refusal, so it would otherwise keep showing a host this copy
      // does not deploy to.
      form.input.hostId.set(instance.hostId ?? CLEARED);
      toaster.error(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <SettingsSection
      id="host"
      title={tr("app.settings.host.title")}
      description={tr("app.settings.host.description")}
    >
      <SettingsRow
        label={tr("app.settings.host.label")}
        description={
          hosts.length === 0
            ? tr("app.settings.host.none")
            : tr("app.settings.host.rowDescription")
        }
      >
        {hosts.length === 0 ? (
          <Link
            className="text-primary text-sm underline-offset-4 hover:underline"
            href={`/${project.slug}/settings/hosts`}
          >
            {tr("app.settings.host.manage")}
          </Link>
        ) : (
          <Control
            select
            input={form.input.hostId}
            label=""
            disabled={!isOwner || busy}
            triggerClassName="w-full sm:w-72"
            inputProps={{
              "aria-label": tr("app.settings.host.label"),
            }}
            items={[
              // Clearing is a real operation: an instance pointed at the
              // wrong host has to be able to stop pointing anywhere. A
              // sentinel rather than `""`, which Base UI reads as "no value"
              // and renders as the placeholder.
              {
                value: CLEARED,
                label: tr("app.settings.host.clear"),
              },
              ...hosts.map((host) => ({
                value: host.id,
                label: host.label ? `${host.slug} (${host.label})` : host.slug,
              })),
            ]}
          />
        )}
      </SettingsRow>
    </SettingsSection>
  );
};

export default AppSettingsHost;
