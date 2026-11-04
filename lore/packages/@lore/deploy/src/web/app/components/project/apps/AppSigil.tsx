import { currentProjectAtom, type I18n } from "@lore/core/web";
import { useClient, useQuery, useStore } from "alepha/react";
import { useI18n } from "alepha/react/i18n";

import type { AppSecretController } from "../../../../../api/controllers/AppSecretController.ts";
import { currentInstanceAtom } from "../../../atoms/currentInstanceAtom.ts";
import AppSigilFeatures from "./AppSigilFeatures.tsx";

/**
 * The Sigil tab (#Q3103): what this copy collects, for a copy Lore deploys.
 *
 * Reads the copy's variables through the Environment tab's own endpoint and
 * query key, so a save here and an edit there refresh each other. Only the
 * `SIGIL_CONFIG` row is used; the rest of the set stays on Environment.
 */
const AppSigil = () => {
  const { tr } = useI18n<I18n, "en">();
  const secretApi = useClient<AppSecretController>();
  const [project] = useStore(currentProjectAtom);
  const [instance] = useStore(currentInstanceAtom);

  const { data, loading, error } = useQuery(
    {
      enabled: Boolean(project && instance),
      key: ["app-secrets", project?.id, instance?.id],
      keepPreviousData: true,
      handler: async () => {
        if (!project || !instance) return undefined;
        return await secretApi.listAppSecrets({
          params: { projectId: project.id, instanceId: instance.id },
        });
      },
      // Handled: the tab renders its own error line.
      onError: () => {},
    },
    [project?.id, instance?.id],
  );

  if (!project || !instance) {
    return null;
  }

  const stored = data?.items.find((item) => item.key === "SIGIL_CONFIG");

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 p-4">
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

export default AppSigil;
