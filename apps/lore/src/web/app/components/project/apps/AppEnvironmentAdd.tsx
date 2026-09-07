import { Button } from "@alepha/ui/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@alepha/ui/components/ui/card";
import { Input } from "@alepha/ui/components/ui/input";
import { useToast } from "@alepha/ui/components/use-toast/use-toast";
import { useClient } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { useState } from "react";

import type { AppSecretController } from "@/api/controllers/AppSecretController.ts";

import type { I18n } from "../../../services/I18n.ts";

export interface AppEnvironmentAddProps {
  projectId: number;
  instanceId: string;
  onSaved: () => void;
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
 * and the key count all come back as messages naming what to do instead.
 */
const AppEnvironmentAdd = (props: AppEnvironmentAddProps) => {
  const { tr } = useI18n<I18n, "en">();
  const toaster = useToast();
  const secretApi = useClient<AppSecretController>();

  const [key, setKey] = useState("");
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);

  const save = async () => {
    if (!key.trim() || !value) {
      return;
    }

    setBusy(true);
    try {
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
      props.onSaved();
    } catch (error) {
      toaster.error(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

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
          onClick={save}
          data-testid="app-environment-save"
        >
          {tr("app.environment.save")}
        </Button>
      </CardContent>
    </Card>
  );
};

export default AppEnvironmentAdd;
