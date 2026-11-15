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
import {
  useAction,
  useClient,
  useQuery,
  useQueryClient,
  useStore,
} from "alepha/react";
import { useForm, useFormValues } from "alepha/react/form";
import { useI18n } from "alepha/react/i18n";
import { useRouter } from "alepha/react/router";
import { useState } from "react";

import type { MonitorController } from "../../../../../api/controllers/MonitorController.ts";
import type { UptimePushController } from "../../../../../api/controllers/UptimePushController.ts";
import { monitorListQuerySchema } from "../../../../../api/schemas/monitorListQuerySchema.ts";
import type { MonitorWindow } from "../../../../../api/schemas/monitorWindowSchema.ts";
import MonitorDetailBody from "./MonitorDetailBody.tsx";
import MonitorFormDialog from "./MonitorFormDialog.tsx";
export interface ProjectMonitorProps {
  monitorId: string;
}
const ProjectMonitor = (props: ProjectMonitorProps) => {
  const { tr } = useI18n<I18n, "en">();
  const [project] = useStore(currentProjectAtom);
  const api = useClient<MonitorController>();
  const pushApi = useClient<UptimePushController>();
  const dialog = useDialog();
  const router = useRouter();
  const queries = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [token, setToken] = useState<string>();
  const form = useForm({
    schema: monitorListQuerySchema,
    initialValues: { window: "24h" },
    handler: () => {},
  });
  const window = (useFormValues(form).window ?? "24h") as MonitorWindow;
  const query = useQuery(
    {
      key: ["uptime-monitor", props.monitorId, window],
      runEvery: [60, "seconds"],
      handler: () =>
        api.getMonitorDetail({
          params: { monitorId: props.monitorId },
          query: { window },
        }),
      onError: () => {},
    },
    [api, props.monitorId, window],
  );
  // Edit, pause, rotate and delete live here since the Uptime list is gone
  // (#Q3657): a monitor's page is the one place that manages it, until it
  // becomes its app's Uptime tab (#Q3677).
  const mutation = useAction<[kind: "toggle" | "delete" | "rotate"], boolean>(
    {
      invalidates: [
        ["uptime-monitor", props.monitorId],
        ["uptime-monitors", project?.id],
      ],
      handler: async (_ctx, kind) => {
        const monitor = query.data?.monitor;
        if (!monitor) return false;
        const monitorId = monitor.id;
        if (kind === "toggle") {
          await api.setMonitorActive({
            params: { monitorId },
            body: { active: !monitor.active },
          });
        }
        if (kind === "delete") {
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
          if (project) {
            void router.push(
              router.path("projectApps", {
                params: { projectSlug: project.slug },
              }),
            );
          }
        }
        if (kind === "rotate") {
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
    [api, pushApi, dialog, router, project?.id, query.data, tr],
  );
  const monitor = query.data?.monitor;
  const canManage = Boolean(
    project &&
    canInProject(project, "app:manage") &&
    capabilityOption(project, "ship", "uptime"),
  );
  const busy = mutation.loading;
  return (
    <section className="mx-auto w-full max-w-6xl overflow-auto p-5">
      <div className="mb-5 flex flex-wrap items-end justify-end gap-2">
        {monitor && canManage && (
          <div className="me-auto flex flex-wrap gap-2">
            <Button
              variant="minimal"
              size="sm"
              disabled={busy}
              onClick={() => setEditing(true)}
            >
              {tr("uptime.edit")}
            </Button>
            <Button
              variant="minimal"
              size="sm"
              disabled={busy}
              onClick={() => void mutation.run("toggle")}
            >
              {tr(monitor.active ? "uptime.pause" : "uptime.resume")}
            </Button>
            {monitor.kind === "push" && (
              <Button
                variant="minimal"
                size="sm"
                disabled={busy}
                onClick={() => void mutation.run("rotate")}
              >
                {tr("uptime.rotate")}
              </Button>
            )}
            <Button
              variant="minimal"
              size="sm"
              disabled={busy}
              onClick={() => void mutation.run("delete")}
            >
              {tr("uptime.delete")}
            </Button>
          </div>
        )}
        <Control
          select
          input={form.input.window}
          label={tr("uptime.windowLabel")}
          items={["24h", "7d", "30d"].map((value) => ({
            value,
            label: tr(`uptime.window.${value}`),
          }))}
        />
      </div>
      {query.error && (
        <p role="alert" className="text-danger-text">
          {query.error.message}
        </p>
      )}
      {query.data ? (
        <MonitorDetailBody data={query.data} />
      ) : (
        !query.error && <p>{tr("uptime.loading")}</p>
      )}
      {editing && monitor && project && (
        <MonitorFormDialog
          key={monitor.id}
          projectId={project.id}
          monitor={monitor}
          onClose={() => {
            setEditing(false);
            queries.invalidate(["uptime-monitor", props.monitorId]);
          }}
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
export default ProjectMonitor;
