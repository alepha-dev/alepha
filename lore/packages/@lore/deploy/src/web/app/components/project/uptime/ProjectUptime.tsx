import {
  Button,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  useDialog,
} from "@alepha/ui";
import { Control } from "@alepha/ui/form";
import {
  canInProject,
  capabilityOption,
  currentProjectAtom,
  type I18n,
  TokenReveal,
} from "@lore/core/web";
import { useAction, useClient, useQuery, useStore } from "alepha/react";
import { useForm, useFormValues } from "alepha/react/form";
import { useI18n } from "alepha/react/i18n";
import { useState } from "react";

import type { MonitorController } from "../../../../../api/controllers/MonitorController.ts";
import type { UptimePushController } from "../../../../../api/controllers/UptimePushController.ts";
import type { MonitorListItem } from "../../../../../api/schemas/monitorListItemSchema.ts";
import { monitorListQuerySchema } from "../../../../../api/schemas/monitorListQuerySchema.ts";
import type { MonitorWindow } from "../../../../../api/schemas/monitorWindowSchema.ts";
import MonitorFormDialog from "./MonitorFormDialog.tsx";
import MonitorListRow from "./MonitorListRow.tsx";

const ProjectUptime = () => {
  const { tr } = useI18n<I18n, "en">();
  const [project] = useStore(currentProjectAtom);
  const api = useClient<MonitorController>();
  const pushApi = useClient<UptimePushController>();
  const dialog = useDialog();
  const [editing, setEditing] = useState<MonitorListItem | "new">();
  const [token, setToken] = useState<string>();
  const filters = useForm({
    schema: monitorListQuerySchema,
    handler: () => {},
    initialValues: { window: "24h" },
  });
  const window = (useFormValues(filters).window ?? "24h") as MonitorWindow;
  const query = useQuery(
    {
      enabled: Boolean(project),
      key: ["uptime-monitors", project?.id, window],
      runEvery: [60, "seconds"],
      handler: async () =>
        project
          ? api.listMonitors({
              params: { projectId: project.id },
              query: { window },
            })
          : undefined,
      onError: () => {},
    },
    [api, project?.id, window],
  );
  const mutation = useAction<
    [
      request: {
        kind: "toggle" | "delete" | "rotate";
        monitor: MonitorListItem;
      },
    ],
    boolean
  >(
    {
      invalidates: [["uptime-monitors", project?.id]],
      handler: async (request) => {
        const monitorId = request.monitor.id;
        if (request.kind === "toggle")
          await api.setMonitorActive({
            params: { monitorId },
            body: { active: !request.monitor.active },
          });
        if (request.kind === "delete") {
          if (
            !(await dialog.confirm({
              title: tr("uptime.deleteTitle"),
              description: tr("uptime.deleteDescription"),
              confirmLabel: tr("uptime.delete"),
              cancelLabel: tr("uptime.cancel"),
              destructive: true,
            }))
          )
            return false;
          await api.deleteMonitor({ params: { monitorId } });
        }
        if (request.kind === "rotate") {
          if (
            !(await dialog.confirm({
              title: tr("uptime.rotate"),
              description: tr("uptime.rotateDescription"),
              confirmLabel: tr("uptime.rotate"),
              cancelLabel: tr("uptime.cancel"),
            }))
          )
            return false;
          const minted = await pushApi.rotateMonitorPushToken({
            params: { monitorId },
          });
          setToken(
            `${globalThis.location?.origin ?? ""}/uptime/push/${minted.token}`,
          );
        }
        return true;
      },
    },
    [api, pushApi, dialog, project?.id, tr],
  );
  if (!project) return null;
  const canManage =
    canInProject(project, "app:manage") &&
    capabilityOption(project, "apps", "uptime");
  const busy = mutation.loading;
  return (
    <section className="flex h-full min-h-0 flex-col" aria-busy={query.loading}>
      <header className="flex flex-wrap items-center justify-between gap-4 border-b p-5">
        <div>
          <h1 className="text-xl font-semibold">{tr("uptime.title")}</h1>
          <p className="text-muted-foreground mt-1 text-sm">
            {tr("uptime.description")}
          </p>
        </div>
        <div className="flex items-end gap-3">
          <Control
            select
            input={filters.input.window}
            label={tr("uptime.windowLabel")}
            disabled={busy}
            items={["24h", "7d", "30d"].map((value) => ({
              value,
              label: tr(`uptime.window.${value}` as never),
            }))}
          />
          {canManage && (
            <Button disabled={busy} onClick={() => setEditing("new")}>
              {tr("uptime.createTitle")}
            </Button>
          )}
        </div>
      </header>
      <div className="min-h-0 flex-1 overflow-auto p-5">
        {query.error && (
          <p role="alert" className="text-danger-text mb-4">
            {query.error.message}
          </p>
        )}
        {query.data?.estimated && (
          <p className="text-muted-foreground mb-3 text-xs">
            {tr("uptime.estimated")}
          </p>
        )}
        <p className="text-muted-foreground mb-3 text-xs">
          {tr("uptime.bucketNote")}
        </p>
        {query.loading && !query.data ? (
          <p>{tr("uptime.loading")}</p>
        ) : query.data?.items.length ? (
          <ul className="bg-card overflow-hidden rounded-lg border">
            {query.data.items.map((monitor) => (
              <MonitorListRow
                key={monitor.id}
                monitor={monitor}
                canManage={canManage}
                busy={busy}
                onEdit={setEditing}
                onToggle={(row) => {
                  void mutation.run({ kind: "toggle", monitor: row });
                }}
                onDelete={(row) => {
                  void mutation.run({ kind: "delete", monitor: row });
                }}
                onRotate={(row) => {
                  void mutation.run({ kind: "rotate", monitor: row });
                }}
              />
            ))}
          </ul>
        ) : (
          <div className="text-muted-foreground rounded-lg border border-dashed p-10 text-center">
            {tr("uptime.empty")}
          </div>
        )}
      </div>
      {editing && (
        <MonitorFormDialog
          key={editing === "new" ? "new" : editing.id}
          projectId={project.id}
          monitor={editing === "new" ? undefined : editing}
          onClose={() => setEditing(undefined)}
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
    </section>
  );
};
export default ProjectUptime;
