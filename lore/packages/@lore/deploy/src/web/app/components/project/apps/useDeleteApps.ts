import { useDialog } from "@alepha/ui";
import { type I18n, settleBulk, useBulkReport } from "@lore/core/web";
import { useAction, useClient, useStore } from "alepha/react";
import { useI18n } from "alepha/react/i18n";

import type { AppController } from "../../../../../api/controllers/AppController.ts";
import type { AppInstanceResource } from "../../../../../api/schemas/appInstanceResourceSchema.ts";
import { currentInstancesAtom } from "../../../atoms/currentInstancesAtom.ts";

/**
 * Delete deployed copies from the Apps list, one from a row's menu or several
 * from the selection (#Q3586), through the same `deleteApp` the copy's own
 * Settings tab calls.
 *
 * The confirm says what goes, because "delete" reads as the opposite of what
 * happens: Lore's record of the copy and its deploy history go, and its sigil
 * with everything that sigil reported; nothing is undeployed. An app is its
 * environments (there is no apps table), so deleting an app's last one takes
 * the app off the list, and the confirm names those apps.
 *
 * A refusal (a copy whose host still holds a Worker or a database, or that
 * still runs on its Bay) is the server's sentence; in a batch it is reported
 * beside the deletes that went through, never instead of them.
 */
export const useDeleteApps = () => {
  const { tr } = useI18n<I18n, "en">();
  const dialog = useDialog();
  const reportBulk = useBulkReport();
  const appApi = useClient<AppController>();
  const [instances, setInstances] = useStore(currentInstancesAtom);

  /**
   * The apps whose every environment is in `selected`.
   */
  const lastOf = (selected: AppInstanceResource[]): string[] => {
    const apps = [...new Set(selected.map((it) => it.app))];
    return apps.filter((app) =>
      (instances ?? [])
        .filter((it) => it.app === app)
        .every((it) => selected.some((picked) => picked.id === it.id)),
    );
  };

  const describe = (selected: AppInstanceResource[]): string => {
    const lines = [
      selected.length === 1
        ? tr("apps.delete.one", {
            args: [`${selected[0].app}/${selected[0].env}`],
          })
        : tr("apps.delete.many", { args: [String(selected.length)] }),
    ];
    if (selected.some((it) => it.sigil)) lines.push(tr("apps.delete.sigil"));
    const last = lastOf(selected);
    if (last.length > 0)
      lines.push(tr("apps.delete.lastEnv", { args: [last.join(", ")] }));
    lines.push(tr("apps.delete.nothingUndeployed"));
    return lines.join(" ");
  };

  const removeAction = useAction<[selected: AppInstanceResource[]], boolean>(
    {
      handler: async (_context, selected) => {
        if (selected.length === 0) return false;
        const n = String(selected.length);
        const ok = await dialog.confirm({
          title:
            selected.length === 1
              ? tr("app.settings.delete.confirmTitle", {
                  args: [`${selected[0].app}/${selected[0].env}`],
                })
              : tr("apps.delete.title", { args: [n] }),
          description: describe(selected),
          confirmLabel:
            selected.length === 1
              ? tr("app.settings.delete.confirm")
              : tr("apps.delete.confirm", { args: [n] }),
          cancelLabel: tr("common.cancel"),
          destructive: true,
        });
        if (!ok) return false;

        const outcome = await settleBulk(
          selected.map((it) => it.id),
          (id) => {
            const it = selected.find((row) => row.id === id)!;
            return appApi.deleteApp({
              params: { projectId: it.projectId, app: it.app, env: it.env },
              // ⚠️ Never `forget`: the refusal that names a Worker or a Bay
              // still to remove is the point, as on the Settings tab.
              body: {},
            });
          },
        );
        // A new array, not a mutation: the table reads the atom as static
        // data and re-renders on identity.
        setInstances(
          (instances ?? []).filter((it) => !outcome.done.includes(it.id)),
        );
        reportBulk(
          outcome,
          tr("board.bulk.deleted", { args: [String(outcome.done.length)] }),
        );
        return true;
      },
    },
    [appApi, dialog, reportBulk, tr, instances],
  );

  return {
    can: appApi.deleteApp.can(),
    busy: removeAction.loading,
    remove: async (selected: AppInstanceResource[]) =>
      (await removeAction.run(selected)).ok,
  };
};
