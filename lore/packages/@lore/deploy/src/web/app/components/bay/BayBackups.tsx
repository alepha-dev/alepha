import type { I18n } from "@lore/core/web";
import { useClient, useQuery, useStore } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { useMemo } from "react";

import type { BackupController } from "../../../../api/controllers/BackupController.ts";
import type { EstateCommandController } from "../../../../api/controllers/EstateCommandController.ts";
import type { EstateInventoryBackup } from "../../../../api/schemas/estateInventoryBackupSchema.ts";
import { currentEstateAtom } from "../../atoms/currentEstateAtom.ts";
import BackupPanel, { type BackupSource } from "../backup/BackupPanel.tsx";

export interface BayBackupsProps {
  /** The machine name, `<projectSlug>-<app>`, as the inventory reports it. */
  app: string;
  env: string;
  backup?: EstateInventoryBackup;
  /** Re-reads the inventory once a verb has changed what the machine holds. */
  reload: () => void;
}

/**
 * The same panel as a project's Backups tab, over the estate's own routes: the
 * console is the machine owner's, and it reads every instance the machine
 * runs, lent or not.
 */
const BayBackups = (props: BayBackupsProps) => {
  const { tr } = useI18n<I18n, "en">();
  const commandApi = useClient<EstateCommandController>();
  const backupApi = useClient<BackupController>();
  const [estate] = useStore(currentEstateAtom);

  const events = useQuery(
    {
      enabled: Boolean(estate),
      key: ["estate-events", estate?.id, props.app, props.env],
      keepPreviousData: true,
      handler: async () => {
        if (!estate) return undefined;
        return await backupApi.listEstateEvents({
          params: { estateId: estate.id },
          query: { app: props.app, env: props.env },
        });
      },
      onError: () => {},
    },
    [estate?.id, props.app, props.env],
  );

  const source = useMemo<BackupSource | undefined>(() => {
    if (!estate) return undefined;
    const target = { app: props.app, environment: props.env };
    return {
      appLabel: props.app,
      backup: props.backup,
      events: events.data?.items ?? [],
      online: estate.online,
      deployAllowed: estate.deployAllowed,
      // The owner's console; the enqueue refuses anyone else server-side.
      canManage: true,
      canRestoreFrom: true,
      send: (body) =>
        commandApi.enqueueEstateCommand({
          params: { estateId: estate.id },
          body: { ...body, ...target },
        }),
      poll: async (commandId) => {
        const listed = await commandApi.listEstateCommands({
          params: { estateId: estate.id },
        });
        return listed.items.find((item) => item.id === commandId);
      },
      result: async (commandId) => {
        try {
          const file = await commandApi.getEstateCommandResult({
            params: { estateId: estate.id, commandId },
          });
          return JSON.parse(await (file as unknown as Blob).text());
        } catch {
          return undefined;
        }
      },
      reload: () => {
        props.reload();
        void events.refetch();
      },
    };
  }, [
    commandApi,
    estate,
    events.data,
    events.refetch,
    props.app,
    props.env,
    props.backup,
    props.reload,
  ]);

  if (!source) return null;

  return (
    <section className="flex flex-col gap-2" aria-label={tr("backup.title")}>
      <BackupPanel source={source} />
    </section>
  );
};

export default BayBackups;
