import { Button } from "@alepha/ui/components/ui/button";
import { useDialog } from "@alepha/ui/components/use-dialog/use-dialog";
import { useToast } from "@alepha/ui/components/use-toast/use-toast";
import type { Infer } from "alepha";
import { useClient } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { useState } from "react";

import type { AppSecretController } from "@/api/controllers/AppSecretController.ts";
import type { appSecretResourceSchema } from "@/api/schemas/appSecretResourceSchema.ts";

import type { I18n } from "../../../services/I18n.ts";

export interface AppEnvironmentRowProps {
  secret: Infer<typeof appSecretResourceSchema>;
  projectId: number;
  instanceId: string;
  canWrite: boolean;
  onChanged: () => void;
}

/**
 * One variable, as much as anybody is told about it.
 *
 * ⚠️ **`valuePrefix` is the whole of what is shown, and it is often empty.**
 * The server stores it only for values long enough that four characters say
 * less than the value does; below that threshold the row says a value exists
 * and nothing else. There is deliberately no reveal control: the value is not
 * in this response, so there would be nothing for it to reveal.
 */
const AppEnvironmentRow = (props: AppEnvironmentRowProps) => {
  const { tr } = useI18n<I18n, "en">();
  const toaster = useToast();
  const dialog = useDialog();
  const secretApi = useClient<AppSecretController>();
  const [busy, setBusy] = useState(false);

  const remove = async () => {
    const confirmed = await dialog.confirm({
      title: tr("app.environment.remove.title"),
      description: tr("app.environment.remove.description", {
        args: [props.secret.key],
      }),
      confirmLabel: tr("app.environment.remove.confirm"),
      destructive: true,
    });
    if (!confirmed) {
      return;
    }

    setBusy(true);
    try {
      await secretApi.deleteAppSecret({
        params: {
          projectId: props.projectId,
          instanceId: props.instanceId,
          key: props.secret.key,
        },
      });
      toaster.success(tr("app.environment.removed"));
      props.onChanged();
    } catch (error) {
      toaster.error(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex items-center justify-between gap-3 py-2">
      <div className="flex min-w-0 flex-col">
        <span className="font-mono text-sm">{props.secret.key}</span>
        <span className="text-muted-foreground text-xs">
          {props.secret.valuePrefix
            ? tr("app.environment.masked", {
                args: [props.secret.valuePrefix],
              })
            : tr("app.environment.masked.short")}
        </span>
      </div>
      {props.canWrite ? (
        <Button
          variant="ghost"
          size="sm"
          disabled={busy}
          onClick={remove}
          data-testid={`app-environment-remove-${props.secret.key}`}
        >
          {tr("app.environment.remove")}
        </Button>
      ) : null}
    </div>
  );
};

export default AppEnvironmentRow;
