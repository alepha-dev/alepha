import { Card, CardContent } from "@alepha/ui";
import { currentProjectAtom, type I18n, useRank } from "@lore/core/web";
import { useClient, useQuery, useStore } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { useMemo } from "react";

import type { BackupController } from "../../../../../api/controllers/BackupController.ts";
import { currentInstanceAtom } from "../../../atoms/currentInstanceAtom.ts";
import BackupPanel, { type BackupSource } from "../../backup/BackupPanel.tsx";

/**
 * This copy's backups, as the Bay machine it is deployed on reports them, and
 * every verb Bay offers on them.
 *
 * ⚠️ Everything goes through the project-scoped `BackupController`, never the
 * estate's own routes: a project member who may deploy here has no business
 * reading the rest of a lent machine.
 *
 * ⚠️ A copy the machine's inventory does not list still gets the panel and
 * its verbs (#Q3285). `sendAppBackupCommand` never reads the inventory: it
 * needs a lent Bay and a stored machine name, which `not-reported` already
 * has. Withholding the buttons there hid a command the server accepts, on a
 * copy that was deployed and serving. The panel's notice says which of the
 * two it is: no inventory received yet, or one that does not list this copy
 * under the name Lore deployed it as. Only the four states with no machine
 * to ask keep a message and no button.
 */
const AppBackups = () => {
  const { tr, l } = useI18n<I18n, "en">();
  const { can } = useRank();
  const api = useClient<BackupController>();
  const [project] = useStore(currentProjectAtom);
  const [instance] = useStore(currentInstanceAtom);

  const scope =
    project && instance
      ? { projectId: project.id, app: instance.app, env: instance.env }
      : undefined;

  const { data, loading, error, refetch } = useQuery(
    {
      enabled: Boolean(scope),
      key: ["app-backup", project?.id, instance?.app, instance?.env],
      keepPreviousData: true,
      handler: async () => {
        if (!scope) return undefined;
        return await api.getAppBackup({ params: scope });
      },
      onError: () => {},
    },
    [project?.id, instance?.app, instance?.env],
  );

  const source = useMemo<BackupSource | undefined>(() => {
    if (
      !scope ||
      !data?.estate ||
      (data.status !== "reported" && data.status !== "not-reported")
    ) {
      return undefined;
    }
    const machineApp = data.machineApp ?? scope.app;
    return {
      appLabel: machineApp,
      backup: data.instance?.backup,
      notice:
        data.status === "reported"
          ? undefined
          : data.reportedAt
            ? tr("backup.status.notListed", {
                args: [
                  l(data.reportedAt, { date: "fromNow" }),
                  `${machineApp}/${scope.env}`,
                ],
              })
            : tr("backup.status.noInventory"),
      events: data.events,
      online: data.estate.online,
      deployAllowed: data.estate.deployAllowed,
      canManage: can("deploy:manage"),
      canRestoreFrom: false,
      canEditPolicy: false,
      send: (body) => api.sendAppBackupCommand({ params: scope, body }),
      poll: (commandId) =>
        api.getAppBackupCommand({ params: { ...scope, commandId } }),
      result: async (commandId) => {
        try {
          const file = await api.getAppBackupCommandResult({
            params: { ...scope, commandId },
          });
          return JSON.parse(await (file as unknown as Blob).text());
        } catch {
          // 404 until the machine uploads.
          return undefined;
        }
      },
      reload: () => void refetch(),
    };
  }, [
    api,
    can,
    data,
    l,
    refetch,
    scope?.projectId,
    scope?.app,
    scope?.env,
    tr,
  ]);

  if (!project || !instance) {
    return null;
  }

  return (
    <div className="flex flex-col gap-4 p-4" data-testid="app-backups">
      {source ? (
        <BackupPanel source={source} />
      ) : (
        <Card>
          <CardContent className="text-muted-foreground text-sm">
            {loading && !data
              ? tr("backup.loading")
              : error || !data
                ? tr("backup.error")
                : tr(STATUS_TEXT[data.status])}
          </CardContent>
        </Card>
      )}
    </div>
  );
};

export default AppBackups;

const STATUS_TEXT = {
  "no-estate": "backup.status.noEstate",
  "not-bay": "backup.status.notBay",
  "not-lent": "backup.status.notLent",
  "not-deployed": "backup.status.notDeployed",
  "not-reported": "backup.status.notReported",
  reported: "backup.status.notReported",
} as const;
