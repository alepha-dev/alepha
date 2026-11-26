import {
  Button,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  Switch,
  useDialog,
} from "@alepha/ui";
import { SettingsRow, SettingsSection } from "@alepha/ui/settings";
import {
  capabilityOption,
  currentProjectAtom,
  type I18n,
  TokenReveal,
  useRank,
} from "@lore/core/web";
import { useAction, useClient, useQuery, useStore } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { useState } from "react";

import type { MonitorController } from "../../../../../api/controllers/MonitorController.ts";
import type { UptimePushController } from "../../../../../api/controllers/UptimePushController.ts";
import { currentInstanceAtom } from "../../../atoms/currentInstanceAtom.ts";
import { currentInstancesAtom } from "../../../atoms/currentInstancesAtom.ts";
import { monitorOfInstance } from "../uptime/instanceMonitors.ts";
import MonitorFormDialog from "../uptime/MonitorFormDialog.tsx";

/**
 * An app copy's Monitor (#Q3684): the one switch that watches it, and the
 * check's settings while it does.
 *
 * ON creates the copy's HTTP monitor on the address set above, or resumes the
 * one it had; OFF pauses it, keeping its history. The address is required to
 * turn it on, and only the address field counts, not a host the app reports
 * from: the check requests what the operator set. Shown while the Ship
 * `uptime` option is on.
 */
const AppSettingsMonitor = () => {
  const { tr, l } = useI18n<I18n, "en">();
  const { can } = useRank();
  const api = useClient<MonitorController>();
  const pushApi = useClient<UptimePushController>();
  const dialog = useDialog();
  const [project] = useStore(currentProjectAtom);
  const [instance, setInstance] = useStore(currentInstanceAtom);
  const [instances, setInstances] = useStore(currentInstancesAtom);
  const [editing, setEditing] = useState(false);
  const [token, setToken] = useState<string>();
  const enabled = Boolean(
    project && capabilityOption(project, "ship", "uptime"),
  );

  const query = useQuery(
    {
      enabled,
      key: ["uptime-monitors", project?.id, "24h"],
      handler: async () =>
        project
          ? api.listMonitors({
              params: { projectId: project.id },
              query: { window: "24h" },
            })
          : undefined,
      onError: () => {},
    },
    [api, project?.id, enabled],
  );

  const monitor =
    instance && query.data
      ? monitorOfInstance(instance, query.data.items ?? [])
      : undefined;

  const toggle = useAction<[on: boolean], void>(
    {
      invalidates: [["uptime-monitors", project?.id]],
      handler: async (_context, on) => {
        if (!project || !instance) return;
        // The copy carries its monitor's state, which the Uptime tab and its
        // route read (#Q3677): kept in step here rather than refetched.
        const follow = (id: string, active: boolean) => {
          const next = { ...instance, monitor: { id, active } };
          setInstance(next);
          setInstances(
            (instances ?? []).map((it) => (it.id === next.id ? next : it)),
          );
        };
        if (monitor) {
          await api.setMonitorActive({
            params: { monitorId: monitor.id },
            body: { active: on },
          });
          follow(monitor.id, on);
          return;
        }
        if (on && instance.url) {
          const created = await api.createMonitor({
            params: { projectId: project.id },
            body: {
              appInstanceId: instance.id,
              name: `${instance.app} ${instance.env}`,
              kind: "http",
              target: instance.url,
            },
          });
          follow(created.monitor.id, true);
        }
      },
    },
    [api, project?.id, instance, instances, monitor],
  );

  const rotate = useAction<[], void>(
    {
      handler: async () => {
        if (!monitor) return;
        if (
          !(await dialog.confirm({
            title: tr("uptime.rotate"),
            description: tr("uptime.rotateDescription"),
            confirmLabel: tr("uptime.rotate"),
            cancelLabel: tr("uptime.cancel"),
          }))
        )
          return;
        const minted = await pushApi.rotateMonitorPushToken({
          params: { monitorId: monitor.id },
        });
        setToken(
          `${globalThis.location?.origin ?? ""}/uptime/push/${minted.token}`,
        );
      },
    },
    [pushApi, dialog, monitor, tr],
  );

  if (!project || !instance || !enabled) {
    return null;
  }

  const canManage = can("app:manage");
  const on = Boolean(monitor?.active);
  // A copy that already owns a monitor can switch it back on without an
  // address only when that check needs none (a push receipt).
  const needsAddress = !instance.url && (!monitor || monitor.kind === "http");
  const busy = toggle.loading || rotate.loading || !query.data;

  return (
    <SettingsSection
      id="monitor"
      title={tr("app.settings.monitor.title")}
      description={tr("app.settings.monitor.description")}
    >
      <SettingsRow
        label={tr("app.settings.monitor.label")}
        description={
          needsAddress && !on
            ? tr("app.settings.monitor.needsAddress")
            : tr("app.settings.monitor.rowDescription")
        }
      >
        <Switch
          data-testid="app-monitor-toggle"
          checked={on}
          disabled={!canManage || busy || (needsAddress && !on)}
          onCheckedChange={(value) => {
            void toggle.run(value);
          }}
          aria-label={tr("app.settings.monitor.label")}
        />
      </SettingsRow>
      {on && monitor ? (
        <SettingsRow
          label={tr("app.settings.monitor.check")}
          description={tr("app.settings.monitor.checkDescription")}
        >
          <div className="flex w-full flex-col gap-3 sm:w-auto sm:items-end">
            <dl
              className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm"
              data-testid="app-monitor-summary"
            >
              <dt className="text-muted-foreground">
                {tr("uptime.kindLabel")}
              </dt>
              <dd>{tr(`uptime.kind.${monitor.kind}`)}</dd>
              {monitor.kind !== "push" && (
                <>
                  <dt className="text-muted-foreground">
                    {tr("uptime.target")}
                  </dt>
                  <dd className="break-all">{monitor.target}</dd>
                </>
              )}
              <dt className="text-muted-foreground">{tr("uptime.interval")}</dt>
              <dd>{l(monitor.intervalSecs)}</dd>
              {monitor.kind !== "push" && (
                <>
                  <dt className="text-muted-foreground">
                    {tr("uptime.timeout")}
                  </dt>
                  <dd>{l(monitor.timeoutSecs)}</dd>
                </>
              )}
              <dt className="text-muted-foreground">
                {tr("uptime.confirmations")}
              </dt>
              <dd>{l(monitor.confirmations)}</dd>
              {monitor.kind === "http" && (
                <>
                  <dt className="text-muted-foreground">
                    {tr("uptime.expectedStatus")}
                  </dt>
                  <dd>
                    {monitor.expect.status
                      ? String(monitor.expect.status)
                      : tr("app.settings.monitor.anySuccess")}
                  </dd>
                </>
              )}
            </dl>
            {canManage && (
              <div className="flex gap-2">
                {monitor.kind === "push" && (
                  <Button
                    variant="outlined"
                    size="sm"
                    disabled={busy}
                    onClick={() => void rotate.run()}
                  >
                    {tr("uptime.rotate")}
                  </Button>
                )}
                <Button
                  variant="outlined"
                  size="sm"
                  disabled={busy}
                  onClick={() => setEditing(true)}
                >
                  {tr("uptime.edit")}
                </Button>
              </div>
            )}
          </div>
        </SettingsRow>
      ) : null}
      {editing && monitor && (
        <MonitorFormDialog
          key={monitor.id}
          projectId={project.id}
          monitor={monitor}
          sockets={query.data?.sockets}
          onClose={() => setEditing(false)}
        />
      )}
      {token && (
        <Dialog
          open
          onOpenChange={(open) => {
            if (!open) setToken(undefined);
          }}
        >
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{tr("uptime.pushUrl")}</DialogTitle>
            </DialogHeader>
            <TokenReveal
              token={token}
              title={tr("uptime.tokenTitle")}
              copyLabel={tr("uptime.copyUrl")}
              copiedMessage={tr("uptime.copied")}
              doneLabel={tr("uptime.done")}
              onDismiss={() => setToken(undefined)}
            />
          </DialogContent>
        </Dialog>
      )}
    </SettingsSection>
  );
};

export default AppSettingsMonitor;
