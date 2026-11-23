import {
  Badge,
  Button,
  Segmented,
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  Switch,
  useDialog,
  useToast,
  cn,
  textLinkUnderlineClassName,
} from "@alepha/ui";
import { useAction, useClient, useInject } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { Link, useRouter } from "alepha/react/router";
import { RefreshCw, Trash2, Unlink } from "lucide-react";

import type { HostController } from "../../../../api/controllers/HostController.ts";
import type { ProjectHostController } from "../../../../api/controllers/ProjectHostController.ts";
import type { OwnedHostResource } from "../../../../api/schemas/ownedHostResourceSchema.ts";
import { HostTypeUiRegistry } from "../../registries/HostTypeUiRegistry.ts";
import { type I18n } from "../../services/I18n.ts";
import BayCommands from "../bay/BayCommands.tsx";

export interface HostDrawerProps {
  /**
   * The host to show, or `undefined` when the drawer is closed. Its
   * presence is the open state, so there is no way to be open over nothing.
   */
  host?: OwnedHostResource;
  onOpenChange: (open: boolean) => void;
  onChanged: (host: OwnedHostResource) => void;
  onDeleted: (id: string) => void;
  /**
   * A freshly rotated secret, for the page to reveal once.
   */
  onSecret: (secret: string) => void;
}

/**
 * The stats intervals offered, in seconds. A short list rather than a free
 * field: the value reaches the machine in its `welcome` frame and an
 * arbitrary number there is a UX choice nobody needs to make by hand.
 */
const INTERVALS = [300, 900, 1800, 3600, 21_600, 86_400];

/**
 * Everything about one host that is not worth a row: the two switches, the
 * stats interval, the projects it is lent to, its command queue, and the two
 * actions that touch the credential.
 *
 * A `cloudflare` host's settings, opened from its row in the home
 * project's Settings ▸ Apps ▸ Hosts list: a `bay` host has a console of
 * its own instead. It was the account Hosts page's drawer until hosts
 * left the account (#E126).
 *
 * ⚠️ **A drawer is not a permission boundary.** Every action here is enforced
 * server-side by the rank of the host's home project. This decides what to draw and nothing more, which is exactly
 * as true now that it is hidden behind a click as it was when it was on the
 * page.
 *
 * The delete confirmation says what deleting does NOT do, because the
 * intuitive reading is the opposite: nothing is undeployed, and a
 * `cloudflare` credential is not revoked at Cloudflare, only a `bay` secret
 * Lore minted itself.
 */
const HostDrawer = (props: HostDrawerProps) => {
  const { tr } = useI18n<I18n, "en">();
  const toaster = useToast();
  const dialog = useDialog();
  const router = useRouter();
  const api = useClient<HostController>();
  const projectHostApi = useClient<ProjectHostController>();
  const host = props.host;
  const isCloudflare = host?.type === "cloudflare";
  const DrawerSection = useInject(HostTypeUiRegistry).get(
    host?.type ?? "",
  )?.DrawerSection;

  // One `useAction` per write. A refusal is not caught here: the root
  // `ActionErrorToaster` shows the server's message, except for the two
  // credential writes, which render theirs beside the field (their `onError`).
  const updateAction = useAction<[body: HostSwitches], void>(
    {
      handler: async (_ctx, body) => {
        if (!host) return;
        const updated = await api.updateHost({
          params: { hostId: host.id },
          body,
        });
        props.onChanged({ ...updated, projects: host.projects });
      },
    },
    [api, host, props.onChanged],
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
        props.onChanged({ ...rotated, projects: host.projects });
        // Rotation only reaches a bay host, so a secret always comes back;
        // the field is optional because a cloudflare create mints nothing, and
        // the guard is what makes that impossible to forget here.
        if (secret) {
          props.onSecret(secret);
        }
        toaster.success(tr("account.hosts.toast.rotated"));
      },
    },
    [api, host, dialog, props.onChanged, props.onSecret, toaster, tr],
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
        props.onDeleted(host.id);
        // The host this drawer is about no longer exists, so it cannot stay
        // open over it.
        props.onOpenChange(false);
        toaster.success(tr("account.hosts.toast.deleted"));
      },
    },
    [api, host, dialog, props.onDeleted, props.onOpenChange, toaster, tr],
  );

  const detachAction = useAction<
    [loan: OwnedHostResource["projects"][number]],
    void
  >(
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
        props.onChanged({
          ...host,
          projects: host.projects.filter((item) => item.id !== loan.id),
        });
        toaster.success(tr("hosts.toast.detached"));
      },
    },
    [projectHostApi, host, dialog, props.onChanged, toaster, tr],
  );

  const update = updateAction.run;
  const rotate = rotateAction.run;
  const remove = removeAction.run;
  const detach = detachAction.run;
  // Page-wide: every control of the drawer waits while any write runs, since
  // `run()` drops a call made while its own is in flight.
  // What the reader's rank in the home project lets them do, computed by the
  // server (#Q3279): the controls the rank does not allow stay visible and
  // say so by being disabled; the server refuses them anyway.
  const canUpdate = host?.can.includes("host:update") ?? false;
  const canDelete = host?.can.includes("host:delete") ?? false;
  const canLend = host?.can.includes("host:lend") ?? false;
  const busy =
    updateAction.loading ||
    rotateAction.loading ||
    removeAction.loading ||
    detachAction.loading;

  return (
    <Sheet
      open={Boolean(host)}
      onOpenChange={(next) => {
        props.onOpenChange(next);
      }}
    >
      <SheetContent
        side="right"
        className="flex w-full flex-col gap-4 overflow-y-auto data-[side=right]:sm:max-w-xl"
        data-testid="my-host-drawer"
      >
        {host && (
          <>
            <SheetHeader>
              <SheetTitle className="flex items-center gap-2">
                <span className="truncate">{host.slug}</span>
                <Badge variant="outline">{host.type}</Badge>
                {isCloudflare ? (
                  <Badge
                    variant={
                      host.credentialStatus === "valid"
                        ? "default"
                        : "destructive"
                    }
                  >
                    {host.credentialStatus === "valid"
                      ? tr("hosts.credential.valid")
                      : tr("hosts.credential.invalid")}
                  </Badge>
                ) : (
                  <Badge variant={host.online ? "default" : "outline"}>
                    {host.online ? tr("hosts.online") : tr("hosts.offline")}
                  </Badge>
                )}
              </SheetTitle>
              <SheetDescription>
                {/* Truncated, here as in the row. A bay secret's cleartext
                    is gone the moment its dialog is dismissed; a cloudflare
                    token was never Lore's to show at all. */}
                {host.secretPrefix &&
                  (isCloudflare
                    ? tr("account.hosts.tokenPrefix", {
                        args: [host.secretPrefix],
                      })
                    : tr("account.hosts.secretPrefix", {
                        args: [host.secretPrefix],
                      }))}
                {host.secretPrefix && " · "}
                {isCloudflare
                  ? tr("hosts.cloudflare.accountLabel", {
                      args: [host.accountId ?? "?"],
                    })
                  : host.cpuPercent !== undefined &&
                      host.memoryPercent !== undefined
                    ? tr("account.hosts.gauge", {
                        args: [
                          String(Math.round(host.cpuPercent)),
                          String(Math.round(host.memoryPercent)),
                        ],
                      })
                    : tr("account.hosts.gauge.none")}
              </SheetDescription>
            </SheetHeader>

            <div className="flex flex-col gap-3 px-4">
              <div className="flex items-center justify-between gap-4 text-sm">
                <span className="flex flex-col gap-0.5">
                  <span>{tr("account.hosts.switch.deploys")}</span>
                  <span className="text-muted-foreground text-xs">
                    {tr("account.hosts.switch.deploys.description")}
                  </span>
                </span>
                <Switch
                  checked={host.deployAllowed}
                  disabled={!canUpdate || busy}
                  onCheckedChange={(value) => {
                    void update({ deployAllowed: value });
                  }}
                  aria-label={tr("account.hosts.switch.deploys")}
                  data-testid="my-host-deploys"
                />
              </div>
              {!isCloudflare && (
                <div className="flex items-center justify-between gap-4 text-sm">
                  <span className="flex flex-col gap-0.5">
                    <span>{tr("account.hosts.switch.series")}</span>
                    <span className="text-muted-foreground text-xs">
                      {tr("account.hosts.switch.series.description")}
                    </span>
                  </span>
                  <Switch
                    checked={host.collectSeries}
                    disabled={!canUpdate || busy}
                    onCheckedChange={(value) => {
                      void update({ collectSeries: value });
                    }}
                    aria-label={tr("account.hosts.switch.series")}
                    data-testid="my-host-series"
                  />
                </div>
              )}
              {!isCloudflare && (
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
                    disabled={!canUpdate || busy}
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
              )}
            </div>

            {/* The type's own section, from its module (#E166): a
                cloudflare token, replaced and checked again. */}
            {DrawerSection ? (
              <DrawerSection
                key={host.id}
                host={host}
                canUpdate={canUpdate}
                busy={busy}
                onChanged={props.onChanged}
              />
            ) : null}

            <div className="flex flex-col gap-2 border-t px-4 pt-4">
              <span className="text-muted-foreground text-xs">
                {host.projects.length === 0
                  ? tr("account.hosts.loans.none")
                  : tr("account.hosts.loans.label")}
              </span>
              {host.projects.map((loan) => (
                <div
                  key={loan.id}
                  className="flex items-center justify-between gap-2 text-sm"
                  data-testid="my-host-loan"
                >
                  {loan.slug ? (
                    <Link
                      href={router.path("projectSettingsHosts", {
                        params: { projectSlug: loan.slug },
                      })}
                      className={cn(
                        textLinkUnderlineClassName,
                        "hover:text-foreground truncate",
                      )}
                    >
                      {loan.title}
                    </Link>
                  ) : (
                    <span className="truncate">{loan.title}</span>
                  )}
                  <Button
                    variant="minimal"
                    size="sm"
                    disabled={!canLend || busy}
                    aria-label={tr("hosts.detach.action")}
                    onClick={() => {
                      void detach(loan);
                    }}
                  >
                    <Unlink className="size-4" />
                    {tr("hosts.detach.action")}
                  </Button>
                </div>
              ))}
            </div>

            {/* The command queue exists because a bay machine dials in and
                asks for work. A cloudflare account has no connector to come
                for it, and #1629 refuses one at enqueue.
                ⚠️ A `bay` row opens its console rather than this drawer,
                so in practice this branch is never taken and the queue is
                read at /:projectSlug/hosts/:hostSlug/commands. Kept as the guard
                rather than deleted: it states the rule, and deleting it
                would leave a cloudflare drawer one route change away from
                rendering a queue nothing can serve. */}
            {!isCloudflare && (
              <div className="border-t pt-4">
                <BayCommands hostId={host.id} />
              </div>
            )}

            <div className="flex flex-wrap items-center justify-end gap-2 border-t px-4 pt-4 pb-4">
              {host.type === "bay" && (
                <Button
                  variant="outlined"
                  size="sm"
                  disabled={!canUpdate || busy}
                  onClick={() => {
                    void rotate();
                  }}
                  data-testid="my-host-rotate"
                >
                  <RefreshCw className="size-4" />
                  {tr("account.hosts.rotate")}
                </Button>
              )}
              <Button
                variant="outlined"
                intent="danger"
                size="sm"
                disabled={!canDelete || busy}
                onClick={() => {
                  void remove();
                }}
                data-testid="my-host-delete"
              >
                <Trash2 className="size-4" />
                {tr("account.hosts.delete")}
              </Button>
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
};

/**
 * What one switch change sends: an omitted key is left alone server-side.
 */
interface HostSwitches {
  label?: string;
  collectSeries?: boolean;
  deployAllowed?: boolean;
  statsIntervalSeconds?: number;
}

export default HostDrawer;
