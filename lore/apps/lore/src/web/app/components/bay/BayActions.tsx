import { Button } from "@alepha/ui/components/ui/button";
import { useDialog } from "@alepha/ui/components/use-dialog/use-dialog";
import { useToast } from "@alepha/ui/components/use-toast/use-toast";
import { useClient } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { HttpError } from "alepha/server";
import { Play, RefreshCw, RotateCw, Save, Square } from "lucide-react";

import type { EstateController } from "@/api/controllers/EstateController.ts";
import type { I18n } from "@/web/app/services/I18n.ts";

import type { BayInstanceRow } from "./bayInstanceRow.ts";
import { bayProcessState } from "./bayInstanceRow.ts";
import { useBayCommand } from "./useBayCommand.ts";
import { useBayInventory } from "./useBayInventory.ts";

export interface BayActionsProps {
  row: BayInstanceRow;
}

/**
 * What can be done to one instance, and what became of it.
 *
 * ## The buttons follow the row's state
 *
 * `restart` and `stop` for something running; `start` for something that is
 * not; `backup` only where a database Bay provisioned exists; none of them for
 * a static site or a row the machine never reported. Showing every verb always
 * and letting the machine refuse is the opposite of a console that says the
 * true thing.
 *
 * ⚠️ **There is no `env` button.** The verb was removed from the epic by the
 * owner: dangerous against today's empty secret set, and duplicated by the
 * deploy path, which already pulls the secret set by command id and applies it
 * before the release swap.
 *
 * ## Two different offline behaviours, and each says its own words
 *
 * `restart`, `stop`, `start` and `backup` QUEUE for an offline machine and run
 * when it reconnects, bounded by a day. `refresh` and the log tail REFUSE,
 * because a stale read is worthless. Papering over that difference with one
 * disabled state would make the queued ones look lost.
 *
 * ## The stop is the one that makes a site go dark
 *
 * It confirms destructively, names the instance and its domains, and says the
 * stop holds until a start or a deploy - because it does: the intent is
 * persisted and the unit disabled, so a reboot and a Bay upgrade both leave it
 * down. Never `window.confirm`.
 */
const BayActions = (props: BayActionsProps) => {
  const { tr } = useI18n<I18n, "en">();
  const dialog = useDialog();
  const toaster = useToast();
  const estateApi = useClient<EstateController>();
  const { estate, refetch } = useBayInventory();
  const { command, busy, run } = useBayCommand(estate);
  const row = props.row;

  if (!estate) {
    return null;
  }

  const state = bayProcessState(row);
  const actionable = row.reported && state !== "static";
  const canStop = actionable && (state === "running" || state === "restarting");
  const canStart =
    actionable &&
    (state === "stopped" || state === "down" || state === "crashed");
  const canBackup = row.reported && row.backups;

  const enqueue = async (kind: "restart" | "stop" | "start" | "backup") => {
    const result = await run({
      kind,
      app: row.app,
      environment: row.env,
    });
    // The inventory moved if anything did: a restart changes the uptime, a
    // backup moves lastBackupAt. Bay pushes one after every command, so this
    // only asks Lore for what it already has.
    if (result?.status === "done") {
      await refetch();
    }
  };

  const confirmStop = async () => {
    const domains = row.reported ? (row.domains ?? []) : [];
    const ok = await dialog.confirm({
      title: String(tr("bay.actions.stop.title", { args: [row.app, row.env] })),
      description: String(
        domains.length
          ? tr("bay.actions.stop.description", { args: [domains.join(", ")] })
          : tr("bay.actions.stop.description.noDomains"),
      ),
      confirmLabel: String(tr("bay.actions.stop")),
      destructive: true,
    });
    if (ok) {
      await enqueue("stop");
    }
  };

  const refresh = async () => {
    try {
      await estateApi.refreshEstate({ params: { estateId: estate.id } });
      // The machine answers on its own connection, so the page re-reads a
      // moment later rather than pretending the call returned an inventory.
      setTimeout(() => void refetch(), REREAD_MS);
      toaster.success(String(tr("bay.actions.refresh.asked")));
    } catch (error) {
      if (HttpError.is(error, 429)) {
        // Six a minute per estate. A cooldown, not a failure.
        toaster.error(String(tr("bay.actions.refresh.cooldown")));
        return;
      }
      toaster.error(error instanceof Error ? error.message : String(error));
    }
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        {canStop && (
          <>
            <Button
              variant="secondary"
              size="sm"
              disabled={busy}
              onClick={() => void enqueue("restart")}
              data-testid="bay-action-restart"
            >
              <RotateCw className="size-4" />
              {tr("bay.actions.restart")}
            </Button>
            <Button
              variant="secondary"
              size="sm"
              disabled={busy}
              onClick={() => void confirmStop()}
              data-testid="bay-action-stop"
            >
              <Square className="size-4" />
              {tr("bay.actions.stop")}
            </Button>
          </>
        )}
        {canStart && (
          <Button
            variant="secondary"
            size="sm"
            disabled={busy}
            onClick={() => void enqueue("start")}
            data-testid="bay-action-start"
          >
            <Play className="size-4" />
            {tr("bay.actions.start")}
          </Button>
        )}
        {canBackup && (
          <Button
            variant="secondary"
            size="sm"
            disabled={busy}
            onClick={() => void enqueue("backup")}
            data-testid="bay-action-backup"
          >
            <Save className="size-4" />
            {tr("bay.actions.backup")}
          </Button>
        )}
        <Button
          variant="ghost"
          size="sm"
          // Refuses offline rather than queueing, so it is disabled and the
          // sentence below says which of the two behaviours this is.
          disabled={!estate.online}
          onClick={() => void refresh()}
          data-testid="bay-action-refresh"
        >
          <RefreshCw className="size-4" />
          {tr("bay.actions.refresh")}
        </Button>
      </div>

      {command && (
        <p
          className="text-muted-foreground text-xs"
          data-testid="bay-command-state"
        >
          {command.status === "pending"
            ? // Not a failure: the machine is not connected, and this runs
              // when it comes back.
              tr("bay.actions.queued")
            : command.status === "failed"
              ? // The machine's own sentence about the host, verbatim.
                tr("bay.actions.failed", {
                  args: [command.reason ?? String(tr("bay.actions.noReason"))],
                })
              : command.status === "done"
                ? tr("bay.actions.done")
                : tr("bay.actions.running", {
                    args: [command.step ?? command.status],
                  })}
        </p>
      )}

      {!estate.online && (
        <p className="text-muted-foreground text-xs">
          {tr("bay.actions.offline")}
        </p>
      )}
    </div>
  );
};

export default BayActions;

/**
 * How long to wait before re-reading after a refresh was accepted. The machine
 * has to receive the frame, assemble an inventory and push it back, and Bay's
 * own kick floor is five seconds.
 */
const REREAD_MS = 6000;
