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
 * A refusal (a copy whose estate still holds a Worker or a database, or that
 * still runs on its Bay) is the server's sentence; in a batch it is reported
 * beside the deletes that went through, never instead of them.
 *
 * Each refused copy's sentence is shown, not a count (#Q3603), in a dialog
 * that offers the way out with its consequence spelled out: delete them
 * anyway and leave what they run in place (`forget`). Removing a copy from
 * its machine first stays `lore apps destroy`, its own verb with a typed
 * confirmation, which the dialog names.
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

  /**
   * Delete `ids`, drop the ones that went from the list, and say so. Returns
   * the outcome so the caller can offer the way out for the refusals.
   */
  const settle = async (
    selected: AppInstanceResource[],
    forget: boolean,
    listed: AppInstanceResource[],
  ) => {
    const outcome = await settleBulk(
      selected.map((it) => it.id),
      (id) => {
        const it = selected.find((row) => row.id === id)!;
        return appApi.deleteApp({
          params: { projectId: it.projectId, app: it.app, env: it.env },
          // ⚠️ `forget` only after the owner read every refusal and chose to
          // leave what those copies run in place (#Q3603). Never on the
          // first try: the refusal that names a Worker or a Bay still to
          // remove is the point, as on the Settings tab.
          body: forget ? { forget: true } : {},
        });
      },
    );
    // A new array, not a mutation: the table reads the atom as static
    // data and re-renders on identity.
    const remaining = listed.filter((it) => !outcome.done.includes(it.id));
    setInstances(remaining);
    reportBulk(
      outcome,
      tr("board.bulk.deleted", { args: [String(outcome.done.length)] }),
      undefined,
      tr("apps.delete.failed", { args: [String(outcome.failed.length)] }),
    );
    return { outcome, remaining };
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

        const { outcome, remaining } = await settle(
          selected,
          false,
          instances ?? [],
        );
        if (outcome.failed.length === 0) return true;

        // Every refusal in the server's own words, then the way out.
        const refused = outcome.failed.map(
          (failure) => selected.find((row) => row.id === failure.id)!,
        );
        const reasons = outcome.failed.map((failure) =>
          failure.error instanceof Error
            ? failure.error.message
            : String(failure.error),
        );
        const forget = await dialog.confirm({
          title: tr("apps.delete.refusedTitle", {
            args: [String(refused.length)],
          }),
          description: [...reasons, tr("apps.delete.forgetConsequence")].join(
            " ",
          ),
          confirmLabel: tr("apps.delete.forget"),
          cancelLabel: tr("apps.delete.keep"),
          destructive: true,
        });
        if (!forget) return true;
        await settle(refused, true, remaining);
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
