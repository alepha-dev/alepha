import { Button, useDialog } from "@alepha/ui";
import type { HostCommandController } from "@lore/core/api";
import type { I18n } from "@lore/core/web";
import { useClient, useQuery } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { ArrowUpCircle } from "lucide-react";

import BayCommandLine from "./BayCommandLine.tsx";
import { bayVersionState } from "./bayVersionState.ts";
import { useBayCommand } from "./useBayCommand.ts";
import { useBayInventory } from "./useBayInventory.ts";

/**
 * Which Bay the machine runs, and the one button that upgrades it (#E152).
 *
 * ## What each state says
 *
 * - **Current**, or a version Lore cannot compare: the version, nothing else.
 * - **Behind, and able to hand over**: "Bay 0.39.0 → 0.40.0" and **Upgrade
 *   Bay**, for whoever holds `host:update` in the home project. Shown but
 *   disabled, with the reason, while the home project has deploys off or the
 *   host is offline: an upgrade is held to the deploy switch, and is never
 *   queued for a machine that is away.
 * - **Behind, and upgraded by hand**: no button. Why (a Bay older than the
 *   command, a unit with no handoff drop-in, a Bay outside systemd) and the
 *   one line to run on the machine, which also makes the next upgrade a
 *   button.
 * - **Offline since the upgrade**: said in those words, with the line that
 *   puts the previous version back. An offline host's inventory is the old
 *   Bay's, and offering the same upgrade again would be the wrong answer.
 *
 * ⚠️ **One confirm, one wording.** The button only exists where Bay can hand
 * its sockets over, so the dialog never has to describe a restart of the
 * proxy: connections are handed over, apps keep running unless the new
 * version builds their containers differently, and a new version that does
 * not start leaves the current one serving.
 *
 * The command is followed like any other (`useBayCommand`): `done` is said
 * only once the old Bay has acked that the new one serves, and a failure is
 * the machine's own sentence.
 */
const BayVersion = () => {
  const { tr } = useI18n<I18n, "en">();
  const dialog = useDialog();
  const commandApi = useClient<HostCommandController>();
  const { host, data, refetch } = useBayInventory();
  const { command, busy, run } = useBayCommand(host, UPGRADE_ATTEMPTS);

  // The last upgrade sent to this host: what "offline since the upgrade"
  // reads, and what a page opened mid-upgrade shows.
  const history = useQuery(
    {
      enabled: Boolean(host),
      key: ["bay-upgrades", host?.id],
      handler: async () => {
        if (!host) {
          return undefined;
        }
        const { items } = await commandApi.listHostCommands({
          params: { hostId: host.id },
          query: {},
        });
        return items.find((item) => item.kind === "upgrade");
      },
    },
    [host?.id],
  );

  if (!host) {
    return null;
  }

  const state = bayVersionState(
    host,
    data?.inventory ?? undefined,
    history.data ?? undefined,
  );
  const canUpdate = host.can.includes("host:update");
  // What this page asked for wins over what the history says of an earlier
  // one; a page opened while an upgrade runs reads the row it finds.
  const shown =
    command ??
    (history.data &&
    (history.data.status === "sent" || history.data.status === "running")
      ? history.data
      : undefined);

  const upgrade = async (from: string, to: string) => {
    const ok = await dialog.confirm({
      title: tr("bay.version.confirm.title", { args: [from, to] }),
      description: tr("bay.version.confirm.description"),
      confirmLabel: tr("bay.version.upgrade"),
    });
    if (!ok) {
      return;
    }
    await run({ kind: "upgrade", version: to });
    // The new Bay reports on its own connection once the old one has left.
    setTimeout(() => {
      void refetch();
      void history.refetch();
    }, REREAD_MS);
  };

  return (
    <div className="flex flex-col gap-2" data-testid="bay-version">
      {state.kind === "unknown" && (
        <p className="text-muted-foreground text-xs" data-state="unknown">
          {tr("bay.overview.versionUnknown")}
        </p>
      )}

      {state.kind === "current" && (
        <p className="text-muted-foreground text-xs" data-state="current">
          {tr("bay.overview.version", { args: [state.version] })}
        </p>
      )}

      {state.kind === "upgradable" && (
        <div className="flex flex-col gap-1" data-state="upgradable">
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-sm font-medium tabular-nums">
              {tr("bay.version.behind", { args: [state.from, state.to] })}
            </span>
            {canUpdate && (
              <Button
                variant="solid"
                intent="none"
                size="sm"
                disabled={busy || Boolean(state.blocked)}
                onClick={() => void upgrade(state.from, state.to)}
                data-testid="bay-version-upgrade"
              >
                <ArrowUpCircle className="size-4" />
                {tr("bay.version.upgrade")}
              </Button>
            )}
          </div>
          {state.blocked === "deploysOff" && (
            <p
              className="text-muted-foreground text-xs"
              data-testid="bay-version-blocked"
            >
              {tr("bay.version.blocked.deploysOff")}
            </p>
          )}
          {state.blocked === "offline" && (
            <p
              className="text-muted-foreground text-xs"
              data-testid="bay-version-blocked"
            >
              {tr("bay.version.blocked.offline")}
            </p>
          )}
        </div>
      )}

      {state.kind === "byHand" && (
        <div className="flex flex-col gap-2" data-state="byHand">
          <span className="text-sm font-medium tabular-nums">
            {tr("bay.version.behind", { args: [state.from, state.to] })}
          </span>
          <p className="text-muted-foreground text-xs">
            {state.why === "noDropIn"
              ? tr("bay.version.byHand.noDropIn")
              : state.why === "noSystemd"
                ? tr("bay.version.byHand.noSystemd")
                : tr("bay.version.byHand.tooOld")}{" "}
            {tr("bay.version.byHand.run")}
          </p>
          <BayCommandLine
            command={state.command}
            copyLabel={tr("bay.version.copy")}
            copiedMessage={tr("bay.version.copied")}
            testId="bay-version-command"
          />
        </div>
      )}

      {state.kind === "offlineSinceUpgrade" && (
        <div className="flex flex-col gap-2" data-state="offlineSinceUpgrade">
          <span className="text-sm font-medium">
            {tr("bay.version.offlineSince", { args: [state.to] })}
          </span>
          {state.recover && (
            <>
              <p className="text-muted-foreground text-xs">
                {tr("bay.version.offlineSince.recover")}
              </p>
              <BayCommandLine
                command={state.recover}
                copyLabel={tr("bay.version.copy")}
                copiedMessage={tr("bay.version.copied")}
                testId="bay-version-command"
              />
            </>
          )}
        </div>
      )}

      {shown && state.kind !== "offlineSinceUpgrade" && (
        <p
          className="text-muted-foreground text-xs"
          data-testid="bay-version-progress"
        >
          {shown.status === "failed"
            ? // The machine's own sentence, verbatim.
              tr("bay.version.failed", {
                args: [shown.reason ?? tr("bay.actions.noReason")],
              })
            : shown.status === "done"
              ? tr("bay.version.done", {
                  args: [shown.payload.version ?? ""],
                })
              : tr("bay.version.running", {
                  args: [shown.step || shown.status],
                })}
        </p>
      )}
    </div>
  );
};

export default BayVersion;

/**
 * Enough two-second polls to outlast the command's own five minutes: a
 * download, a checksum, and a handoff that waits a minute for the new Bay.
 */
const UPGRADE_ATTEMPTS = 165;

/**
 * How long to wait before re-reading once the command has settled: the new
 * Bay dials in after the old one has drained and left.
 */
const REREAD_MS = 8000;
