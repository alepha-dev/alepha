import { Badge } from "@alepha/ui/components/ui/badge";
import { Button } from "@alepha/ui/components/ui/button";
import { CardContent } from "@alepha/ui/components/ui/card";
import { Input } from "@alepha/ui/components/ui/input";
import { useToast } from "@alepha/ui/components/use-toast/use-toast";
import { useClient } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { RotateCcw } from "lucide-react";
import { useEffect, useState } from "react";

import type {
  EstateCommandController,
  EstateCommandResource,
} from "@/api/controllers/EstateCommandController.ts";
import type { I18n } from "@/web/app/services/I18n.ts";

export interface MyEstateCommandsProps {
  estateId: string;
}

/**
 * The queue behind one estate, newest first, and the one thing an owner can
 * put in it before epic #1: a `restart` of an app on the machine.
 *
 * States are the row's (`pending`, `sent`, `running`, `done`, `failed`), as
 * `EstateCommandService` records them; nothing here asks a socket. A
 * `pending` command means the machine is offline and the command waits for
 * its next `hello`; the sweep fails it after a day.
 */
const MyEstateCommands = (props: MyEstateCommandsProps) => {
  const { tr, l } = useI18n<I18n, "en">();
  const toaster = useToast();
  const api = useClient<EstateCommandController>();

  const [items, setItems] = useState<EstateCommandResource[] | undefined>();
  const [app, setApp] = useState("");
  const [environment, setEnvironment] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api
      .listEstateCommands({ params: { estateId: props.estateId } })
      .then((res) => {
        if (!cancelled) setItems(res.items);
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          toaster.error(error instanceof Error ? error.message : String(error));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [api, props.estateId]);

  const canRestart = app.trim().length > 0 && environment.trim().length > 0;

  const restart = async () => {
    if (!canRestart || busy) return;
    setBusy(true);
    try {
      const queued = await api.enqueueEstateCommand({
        params: { estateId: props.estateId },
        body: {
          kind: "restart",
          app: app.trim(),
          environment: environment.trim(),
        },
      });
      setItems((current) => [queued, ...(current ?? [])]);
      toaster.success(tr("account.estates.toast.restartQueued"));
    } catch (error) {
      toaster.error(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <CardContent className="flex flex-col gap-3 px-4 py-3">
      <span className="text-sm font-medium">
        {tr("account.estates.commands.title")}
      </span>
      <form
        className="flex flex-wrap items-center gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          void restart();
        }}
      >
        <Input
          value={app}
          onChange={(event) => setApp(event.target.value)}
          placeholder={tr("account.estates.commands.app")}
          aria-label={tr("account.estates.commands.app")}
          maxLength={100}
          className="w-36"
          data-testid="my-estate-restart-app"
        />
        <Input
          value={environment}
          onChange={(event) => setEnvironment(event.target.value)}
          placeholder={tr("account.estates.commands.environment")}
          aria-label={tr("account.estates.commands.environment")}
          maxLength={100}
          className="w-36"
          data-testid="my-estate-restart-environment"
        />
        <Button
          type="submit"
          variant="outline"
          size="sm"
          disabled={!canRestart || busy}
          data-testid="my-estate-restart"
        >
          <RotateCcw className="size-4" />
          {tr("account.estates.commands.restart")}
        </Button>
      </form>

      {items !== undefined && items.length === 0 && (
        <span className="text-muted-foreground text-xs">
          {tr("account.estates.commands.empty")}
        </span>
      )}
      {(items ?? []).map((command) => (
        <div
          key={command.id}
          className="flex flex-wrap items-center gap-2 text-xs"
          data-testid="my-estate-command"
        >
          <Badge
            variant={
              command.status === "failed"
                ? "destructive"
                : command.status === "done"
                  ? "default"
                  : "secondary"
            }
          >
            {tr(STATUS_KEYS[command.status])}
          </Badge>
          <span className="font-medium">{command.kind}</span>
          <span className="text-muted-foreground">
            {command.payload.app}/{command.payload.environment}
          </span>
          <span className="text-muted-foreground">
            {String(l(String(command.createdAt), { date: "lll" }))}
          </span>
          {command.step && (
            <span className="text-muted-foreground">{command.step}</span>
          )}
          {command.reason && (
            <span className="text-destructive">{command.reason}</span>
          )}
        </div>
      ))}
    </CardContent>
  );
};

/**
 * One literal per state, so the catalogue audit can see every key is read:
 * a key built at runtime reads as unused to it.
 */
const STATUS_KEYS = {
  pending: "account.estates.commands.status.pending",
  sent: "account.estates.commands.status.sent",
  running: "account.estates.commands.status.running",
  done: "account.estates.commands.status.done",
  failed: "account.estates.commands.status.failed",
} as const;

export default MyEstateCommands;
