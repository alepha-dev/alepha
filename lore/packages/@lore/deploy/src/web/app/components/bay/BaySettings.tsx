import {
  Button,
  Card,
  CardContent,
  Segmented,
  Switch,
  TimeAgo,
  useDialog,
  useToast,
} from "@alepha/ui";
import { AccountPage } from "@alepha/ui/account";
import { DataTable } from "@alepha/ui/table";
import type { I18n } from "@lore/core/web";
import { useAction, useClient, useStore } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { Link, useRouter } from "alepha/react/router";
import { FolderKanban, RefreshCw, Trash2, Unlink } from "lucide-react";
import { useState } from "react";

import type { HostController } from "../../../../api/controllers/HostController.ts";
import type { ProjectHostController } from "../../../../api/controllers/ProjectHostController.ts";
import type { HostLoan } from "../../../../api/schemas/ownedHostResourceSchema.ts";
import { currentHostAtom } from "../../atoms/currentHostAtom.ts";
import HostSecretDialog from "../hosts/HostSecretDialog.tsx";
import BayMoveDialog from "./BayMoveDialog.tsx";
import BaySettingsHome from "./BaySettingsHome.tsx";
import BaySettingsReadOnly from "./BaySettingsReadOnly.tsx";

/**
 * The switches, the lending and the credential, for one machine.
 *
 * This is `HostDrawer`'s body for a `bay` host, on a page of its own.
 * The wording moves verbatim rather than being rewritten, because two
 * sentences here are load-bearing and were written to prevent a specific
 * misunderstanding.
 *
 * ⚠️ **A drawer is not a permission boundary, and neither is a page.** Every
 * action here is enforced server-side by the rank of the host's home
 * project, and refused to anyone the rank does not let act. Moving the UI changes
 * what is drawn and nothing else; do not let the move quietly become a
 * permission change.
 *
 * ⚠️ **The delete dialog says what deleting does NOT do**, because the
 * intuitive reading is the opposite: nothing is undeployed, the machine keeps
 * serving, and Lore only loses the ability to inspect, redeploy or roll back.
 * Losing that sentence would be a data-loss-shaped bug in the reader's head.
 *
 * ⚠️ **Rotate is the revoke path**, and it takes the machine off the air until
 * `bay connector set` is run again over ssh with the new secret. That is a
 * manual step on another computer, so it is said before the click.
 *
 * The interval stays a short list of offered values rather than a free field:
 * it reaches the machine in its `welcome` frame, and an arbitrary number is a
 * choice nobody needs to make by hand.
 */
const BaySettings = () => {
  const { tr } = useI18n<I18n, "en">();
  const toaster = useToast();
  const dialog = useDialog();
  const router = useRouter();
  const api = useClient<HostController>();
  const projectHostApi = useClient<ProjectHostController>();
  const [host, setHost] = useStore(currentHostAtom);
  const [freshSecret, setFreshSecret] = useState<string | undefined>();
  const [moving, setMoving] = useState(false);

  // One `useAction` per write, the way `HostDrawer` sends the same four
  // (#E59, #Q2329). A refusal is not caught here: the root
  // `ActionErrorToaster` shows the server's message.
  const updateAction = useAction<
    [
      body: {
        deployAllowed?: boolean;
        collectSeries?: boolean;
        statsIntervalSeconds?: number;
      },
    ],
    void
  >(
    {
      handler: async (_ctx, body) => {
        if (!host) return;
        // The row is re-read from the server's answer rather than assumed, so
        // a switch that was refused does not stay flipped on screen.
        const updated = await api.updateHost({
          params: { hostId: host.id },
          body,
        });
        // The loans are not on the update's answer, and they did not change.
        setHost({ ...updated, projects: host.projects });
      },
    },
    [api, host],
  );

  const rotateAction = useAction<[], void>(
    {
      handler: async () => {
        if (!host) return;
        const ok = await dialog.confirm({
          title: tr("account.hosts.rotate.confirmTitle", {
            args: [host.slug],
          }),
          description: tr("account.hosts.rotate.confirmDescription"),
          confirmLabel: tr("account.hosts.rotate.confirm"),
          destructive: true,
        });
        if (!ok) return;
        const minted = await api.rotateHost({
          params: { hostId: host.id },
        });
        const { secret, ...rotated } = minted;
        setHost({ ...rotated, projects: host.projects });
        setFreshSecret(secret);
        toaster.success(tr("account.hosts.toast.rotated"));
      },
    },
    [api, host, dialog, toaster, tr],
  );

  const removeAction = useAction<[], void>(
    {
      handler: async () => {
        if (!host) return;
        const ok = await dialog.confirm({
          title: tr("account.hosts.delete.confirmTitle", {
            args: [host.slug],
          }),
          // A provisioned server outlives a delete from the page (#Q3167):
          // Lore holds no provider key, only the CLI can terminate it.
          description: host.providerServerId
            ? tr("account.hosts.delete.confirmProvisioned", {
                args: [host.providerServerId, host.provider ?? "", host.slug],
              })
            : tr("account.hosts.delete.confirmDescription"),
          confirmLabel: tr("account.hosts.delete.confirm"),
          destructive: true,
        });
        if (!ok) return;
        await api.deleteHost({ params: { hostId: host.id } });
        toaster.success(tr("account.hosts.toast.deleted"));
        // The host this console is about no longer exists, so the console
        // cannot stay open over it.
        await router.push("projectSettingsHosts", {
          params: { projectSlug: host.project?.slug ?? "" },
        });
      },
    },
    [api, host, dialog, router, toaster, tr],
  );

  const detachAction = useAction<[loan: { id: number; title: string }], void>(
    {
      handler: async (_ctx, loan) => {
        if (!host) return;
        const ok = await dialog.confirm({
          title: tr("account.hosts.detach.confirmTitle", {
            args: [host.slug, loan.title],
          }),
          description: tr("hosts.detach.confirmDescription"),
          confirmLabel: tr("hosts.detach.confirm"),
          destructive: true,
        });
        if (!ok) return;
        await projectHostApi.detachHost({
          params: { projectId: loan.id, hostId: host.id },
        });
        toaster.success(tr("hosts.toast.detached"));
        // The loans live on the owned-list resource, which this page does not
        // hold; the list is where they are read, so it is re-read there.
        await router.push("projectSettingsHosts", {
          params: { projectSlug: host.project?.slug ?? "" },
        });
      },
    },
    [projectHostApi, host, dialog, router, toaster, tr],
  );

  // Page-wide: every control waits while any write runs, since `run()` drops
  // a call made while its own is in flight.
  const busy =
    updateAction.loading ||
    rotateAction.loading ||
    removeAction.loading ||
    detachAction.loading;

  if (!host) {
    return null;
  }

  // What the reader's rank in the home project lets them do, as the server
  // computed it (#Q3279). The server is the authority; this decides what to
  // draw.
  const canUpdate = host.can.includes("host:update");
  const canDelete = host.can.includes("host:delete");
  const canLend = host.can.includes("host:lend");
  const readOnly = !canUpdate && !canDelete;

  const update = updateAction.run;
  const rotate = rotateAction.run;
  const remove = removeAction.run;
  const detach = detachAction.run;

  return (
    <AccountPage variant="form" className="gap-4">
      <BaySettingsHome
        host={host}
        busy={busy}
        {...(canDelete ? { onMove: () => setMoving(true) } : {})}
      />
      {readOnly && (
        <BaySettingsReadOnly
          projectTitle={host.project?.title ?? tr("hosts.project.noHome")}
        />
      )}
      {canUpdate && (
        <Card>
          <CardContent className="flex flex-col gap-4">
            <div className="flex items-center justify-between gap-4 text-sm">
              <span className="flex flex-col gap-0.5">
                <span>{tr("account.hosts.switch.deploys")}</span>
                <span className="text-muted-foreground text-xs">
                  {tr("account.hosts.switch.deploys.description")}
                </span>
              </span>
              <Switch
                checked={host.deployAllowed}
                disabled={busy}
                onCheckedChange={(value) =>
                  void update({ deployAllowed: value })
                }
                aria-label={tr("account.hosts.switch.deploys")}
                data-testid="bay-settings-deploys"
              />
            </div>

            <div className="flex items-center justify-between gap-4 text-sm">
              <span className="flex flex-col gap-0.5">
                <span>{tr("account.hosts.switch.series")}</span>
                <span className="text-muted-foreground text-xs">
                  {tr("account.hosts.switch.series.description")}
                </span>
              </span>
              <Switch
                checked={host.collectSeries}
                disabled={busy}
                onCheckedChange={(value) =>
                  void update({ collectSeries: value })
                }
                aria-label={tr("account.hosts.switch.series")}
                data-testid="bay-settings-series"
              />
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
              <span className="flex flex-col gap-0.5">
                <span>{tr("account.hosts.interval")}</span>
                <span className="text-muted-foreground text-xs">
                  {tr("account.hosts.interval.description")}
                </span>
              </span>
              <Segmented
                size="sm"
                className="self-start"
                value={String(host.statsIntervalSeconds)}
                disabled={busy}
                onChange={(value) => {
                  const seconds = Number(value);
                  if (host.statsIntervalSeconds !== seconds) {
                    void update({ statsIntervalSeconds: seconds });
                  }
                }}
                options={INTERVALS.map((seconds) => ({
                  value: String(seconds),
                  label:
                    seconds < 3600
                      ? tr("account.hosts.interval.minutes", {
                          args: [String(seconds / 60)],
                        })
                      : tr("account.hosts.interval.hours", {
                          args: [String(seconds / 3600)],
                        }),
                }))}
              />
            </div>
          </CardContent>
        </Card>
      )}

      {/*
        The projects this host is lent to (#E68). A table rather than rows in
        a card: the list grows with every project that borrows the machine,
        and each row carries the one verb that ends the loan.
      */}
      <div className="flex flex-col gap-2">
        <span className="text-sm font-medium">
          {tr("account.hosts.loans.label")}
        </span>
        <DataTable<HostLoan>
          data={host.projects}
          rowKey={(loan) => String(loan.id)}
          // A short list inside a column of cards: no column picker, no
          // refresh (the rows come with the host), no page-size picker.
          hideColumnPicker
          hideActionsMenu
          pageSizes={[]}
          emptyState={{
            icon: FolderKanban,
            title: tr("account.hosts.loans.none"),
          }}
          columns={{
            title: {
              label: tr("bay.settings.loans.col.project"),
              sortable: true,
              cell: (loan) => (
                <span data-testid="bay-settings-loan">
                  {loan.slug ? (
                    <Link
                      href={router.path("projectSettingsHosts", {
                        params: { projectSlug: loan.slug },
                      })}
                      className="truncate underline-offset-4 hover:underline"
                    >
                      {loan.title}
                    </Link>
                  ) : (
                    <span className="truncate">{loan.title}</span>
                  )}
                </span>
              ),
            },
            lentAt: {
              label: tr("bay.settings.loans.col.lentAt"),
              sortable: true,
              cell: (loan) => (
                <TimeAgo
                  value={loan.lentAt}
                  className="text-muted-foreground text-xs"
                />
              ),
            },
          }}
          rowActions={(loan) =>
            canLend
              ? [
                  {
                    label: tr("hosts.detach.action"),
                    icon: Unlink,
                    destructive: true,
                    disabled: () => busy,
                    onClick: () => void detach(loan),
                  },
                ]
              : []
          }
        />
      </div>

      {(canUpdate || canDelete) && (
        <Card>
          <CardContent className="flex flex-col gap-3">
            {canUpdate && (
              <p className="text-muted-foreground text-xs">
                {tr("bay.settings.rotate.warning")}
              </p>
            )}
            <div className="flex flex-wrap items-center justify-end gap-2">
              {canUpdate && (
                <Button
                  variant="outlined"
                  size="sm"
                  disabled={busy}
                  onClick={() => void rotate()}
                  data-testid="bay-settings-rotate"
                >
                  <RefreshCw className="size-4" />
                  {tr("account.hosts.rotate")}
                </Button>
              )}
              {canDelete && (
                <Button
                  variant="outlined"
                  intent="danger"
                  size="sm"
                  disabled={busy}
                  onClick={() => void remove()}
                  data-testid="bay-settings-delete"
                >
                  <Trash2 className="size-4" />
                  {tr("account.hosts.delete")}
                </Button>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      <BayMoveDialog
        open={moving}
        onOpenChange={setMoving}
        host={host}
        loans={host.projects}
        onMoved={(moved) => {
          setHost({ ...moved, projects: host.projects });
          // The console lives under the home project, so it follows the
          // host there: the old URL now names a project it left.
          if (moved.project?.slug) {
            void router.push("baySettings", {
              params: {
                projectSlug: moved.project.slug,
                hostSlug: moved.slug,
              },
            });
          }
        }}
      />

      <HostSecretDialog
        secret={freshSecret}
        onDismiss={() => setFreshSecret(undefined)}
      />
    </AccountPage>
  );
};

export default BaySettings;

/**
 * The stats intervals offered, in seconds. A short list rather than a free
 * field: the value reaches the machine in its `welcome` frame and an arbitrary
 * number there is a choice nobody needs to make by hand.
 */
const INTERVALS = [300, 900, 1800, 3600, 21_600, 86_400];
