import { outlineEntry } from "@alepha/ui";
import {
  capabilityOption,
  currentProjectAtom,
  type I18n,
} from "@lore/core/web";
import { useClient, useQuery, useStore } from "alepha/react";
import { useI18n } from "alepha/react/i18n";

import type { AppSecretController } from "../../../../../api/controllers/AppSecretController.ts";
import { currentInstanceAtom } from "../../../atoms/currentInstanceAtom.ts";
import AppSigilFeatures from "./AppSigilFeatures.tsx";
import { sigilConfigurable } from "./appTabs.ts";

/**
 * The Settings tab's Sigil features section (#Q3103): what this copy
 * collects, for a copy Lore deploys. It was a tab of its own, which put a
 * tab in the bar for a handful of switches.
 *
 * Absent unless Lore can really configure it: a sigil, somewhere Lore deploys
 * to (`sigilConfigurable`), and the project's `apps.deploy` option. Nothing is
 * fetched otherwise.
 *
 * Reads the copy's variables through the Environment tab's own endpoint and
 * query key, so a save here and an edit there refresh each other. Only the
 * `SIGIL_CONFIG` row is used; the rest of the set stays on Environment.
 */
const AppSettingsSigilFeatures = () => {
  const { tr } = useI18n<I18n, "en">();
  const secretApi = useClient<AppSecretController>();
  const [project] = useStore(currentProjectAtom);
  const [instance] = useStore(currentInstanceAtom);

  const configurable =
    !!project &&
    !!instance &&
    sigilConfigurable(instance) &&
    capabilityOption(project, "ship", "deploy");

  const { data, loading, error } = useQuery(
    {
      enabled: configurable,
      key: ["app-secrets", project?.id, instance?.id],
      keepPreviousData: true,
      handler: async () => {
        if (!project || !instance) return undefined;
        return await secretApi.listAppSecrets({
          params: { projectId: project.id, instanceId: instance.id },
        });
      },
      // Handled: the section renders its own error line.
      onError: () => {},
    },
    [project?.id, instance?.id, configurable],
  );

  if (!configurable || !instance) {
    return null;
  }

  const stored = data?.items.find((item) => item.key === "SIGIL_CONFIG");

  return (
    // A link target and an outline entry like the sections around it; the
    // form draws its own heading, so the label is given here.
    <div
      id="sigil-features"
      {...outlineEntry(tr("app.sigil.title"))}
      className="scroll-mt-4"
    >
      {loading && !data ? (
        <p className="text-muted-foreground text-sm">
          {tr("app.environment.loading")}
        </p>
      ) : error || !data ? (
        <p className="text-muted-foreground text-sm">
          {tr("app.environment.error")}
        </p>
      ) : (
        <AppSigilFeatures
          // Re-seeded by every save, here or on the Environment tab.
          key={`${instance.id}-${stored?.updatedAt ?? "unset"}`}
          stored={stored}
        />
      )}
    </div>
  );
};

export default AppSettingsSigilFeatures;
