import { useDialog, useToast } from "@alepha/ui";
import type { Infer } from "alepha";
import { useAction, useClient } from "alepha/react";
import { useI18n } from "alepha/react/i18n";

import type { AppSecretController } from "@/api/controllers/AppSecretController.ts";
import type { appSecretResourceSchema } from "@/api/schemas/appSecretResourceSchema.ts";

import type { I18n } from "../../../services/I18n.ts";

export type AppEnvironmentItem = Infer<typeof appSecretResourceSchema>;

export interface AppEnvironmentActions {
  /**
   * Change a stored value: a variable's prompt starts from its current value,
   * a secret's starts blank, since nothing can hand a secret back. `true` when
   * it was saved, `false` when the user backed out, `undefined` on a failure.
   */
  edit: (item: AppEnvironmentItem) => Promise<boolean | undefined>;
  /**
   * Remove one after a confirm. Same three answers as {@link edit}.
   */
  remove: (item: AppEnvironmentItem) => Promise<boolean | undefined>;
  /**
   * True while either runs. A second call made meanwhile is dropped, so the
   * table disables its row actions for that time.
   */
  busy: boolean;
}

/**
 * The row verbs of an app's Environment table (#Q2467).
 *
 * A wrapper hook that owns the interaction, so each verb is a `useAction` run:
 * the dialog lives inside the handler, backing out sends nothing, and a
 * refusal is the server's own words through the root `ActionErrorToaster`.
 */
export const useAppEnvironmentActions = (target: {
  projectId: number;
  instanceId: string;
}): AppEnvironmentActions => {
  const { tr } = useI18n<I18n, "en">();
  const toaster = useToast();
  const dialog = useDialog();
  const secretApi = useClient<AppSecretController>();
  const key = ["app-secrets", target.projectId, target.instanceId];

  const editAction = useAction<[item: AppEnvironmentItem], boolean>(
    {
      handler: async (item) => {
        const variable = item.kind === "variable";
        const value = await dialog.prompt({
          title: tr(
            variable
              ? "app.environment.edit.title"
              : "app.environment.replace.title",
            { args: [item.key] },
          ),
          description: variable
            ? undefined
            : tr("app.environment.replace.description"),
          label: tr("app.environment.value"),
          defaultValue: variable ? (item.value ?? "") : "",
          confirmLabel: tr("app.environment.save"),
          validate: (next) =>
            next ? null : tr("app.environment.value.required"),
        });
        if (value === null) {
          return false;
        }
        await secretApi.setAppSecret({
          params: {
            projectId: target.projectId,
            instanceId: target.instanceId,
          },
          body: { key: item.key, value },
        });
        toaster.success(tr("app.environment.saved"));
        return true;
      },
      invalidates: [key],
    },
    [secretApi, dialog, target.projectId, target.instanceId, toaster, tr],
  );

  const removeAction = useAction<[item: AppEnvironmentItem], boolean>(
    {
      handler: async (item) => {
        const confirmed = await dialog.confirm({
          title: tr("app.environment.remove.title"),
          description: tr("app.environment.remove.description", {
            args: [item.key],
          }),
          confirmLabel: tr("app.environment.remove.confirm"),
          destructive: true,
        });
        if (!confirmed) {
          return false;
        }
        await secretApi.deleteAppSecret({
          params: {
            projectId: target.projectId,
            instanceId: target.instanceId,
            key: item.key,
          },
        });
        toaster.success(tr("app.environment.removed"));
        return true;
      },
      invalidates: [key],
    },
    [secretApi, dialog, target.projectId, target.instanceId, toaster, tr],
  );

  return {
    edit: editAction.run,
    remove: removeAction.run,
    busy: editAction.loading || removeAction.loading,
  };
};
