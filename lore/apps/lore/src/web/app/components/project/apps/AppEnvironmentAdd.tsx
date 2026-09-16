import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Input,
  useToast,
} from "@alepha/ui";
import { useAction, useClient } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { useState } from "react";

import type { AppSecretController } from "@/api/controllers/AppSecretController.ts";

import type { I18n } from "../../../services/I18n.ts";

export interface AppEnvironmentAddProps {
  projectId: number;
  instanceId: string;
}

/**
 * Set a variable, or replace one.
 *
 * ⚠️ **One form for both**, because there is no third option. Nothing can hand
 * an existing value back to be edited, so "change `STRIPE_KEY`" is typing the
 * name again with the new value - which is what the endpoint does anyway, and
 * saying so on screen is kinder than an edit control that starts blank and
 * looks broken.
 *
 * ⚠️ The value field is a plain input rather than `type="password"`. Masking
 * the one place a value is legitimately visible - while somebody types it,
 * once - buys nothing and costs the typo they cannot see. The property that
 * matters is that no response ever carries it back.
 *
 * The refusals are the server's own words: reserved names, the length bound
 * and the key count all come back as messages naming what to do instead, and
 * the root `ActionErrorToaster` shows them as they are (#E59, #Q2329).
 */
const AppEnvironmentAdd = (props: AppEnvironmentAddProps) => {
  const { tr } = useI18n<I18n, "en">();
  const toaster = useToast();
  const secretApi = useClient<AppSecretController>();

  const [key, setKey] = useState("");
  const [value, setValue] = useState("");

  const saveAction = useAction<[], void>(
    {
      handler: async () => {
        if (!key.trim() || !value) {
          return;
        }
        await secretApi.setAppSecret({
          params: {
            projectId: props.projectId,
            instanceId: props.instanceId,
          },
          body: { key: key.trim(), value },
        });
        // Cleared on success, and only on success: a refused name is one the
        // operator wants to correct rather than retype.
        setKey("");
        setValue("");
        toaster.success(tr("app.environment.saved"));
      },
      invalidates: [["app-secrets", props.projectId, props.instanceId]],
    },
    [secretApi, key, value, props.projectId, props.instanceId, toaster, tr],
  );
  const busy = saveAction.loading;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{tr("app.environment.add")}</CardTitle>
        <CardDescription>
          {tr("app.environment.add.description")}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <div className="flex flex-1 flex-col gap-1">
          <label className="text-muted-foreground text-xs" htmlFor="env-key">
            {tr("app.environment.key")}
          </label>
          <Input
            id="env-key"
            value={key}
            onChange={(event) => setKey(event.target.value)}
            placeholder="STRIPE_SECRET_KEY"
            className="font-mono"
            data-testid="app-environment-key"
          />
        </div>
        <div className="flex flex-1 flex-col gap-1">
          <label className="text-muted-foreground text-xs" htmlFor="env-value">
            {tr("app.environment.value")}
          </label>
          <Input
            id="env-value"
            value={value}
            onChange={(event) => setValue(event.target.value)}
            data-testid="app-environment-value"
          />
        </div>
        <Button
          disabled={busy || !key.trim() || !value}
          onClick={() => void saveAction.run()}
          data-testid="app-environment-save"
        >
          {tr("app.environment.save")}
        </Button>
      </CardContent>
    </Card>
  );
};

export default AppEnvironmentAdd;
