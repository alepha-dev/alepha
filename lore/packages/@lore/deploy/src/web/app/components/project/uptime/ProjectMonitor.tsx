import { Control } from "@alepha/ui/form";
import type { I18n } from "@lore/core/web";
import { useClient, useQuery } from "alepha/react";
import { useForm, useFormValues } from "alepha/react/form";
import { useI18n } from "alepha/react/i18n";

import type { MonitorController } from "../../../../../api/controllers/MonitorController.ts";
import { monitorListQuerySchema } from "../../../../../api/schemas/monitorListQuerySchema.ts";
import type { MonitorWindow } from "../../../../../api/schemas/monitorWindowSchema.ts";
import MonitorDetailBody from "./MonitorDetailBody.tsx";
export interface ProjectMonitorProps {
  monitorId: string;
}
const ProjectMonitor = (props: ProjectMonitorProps) => {
  const { tr } = useI18n<I18n, "en">();
  const api = useClient<MonitorController>();
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
  return (
    <section className="mx-auto w-full max-w-6xl overflow-auto p-5">
      <div className="mb-5 flex justify-end">
        <Control
          select
          input={form.input.window}
          label={tr("uptime.windowLabel")}
          items={["24h", "7d", "30d"].map((value) => ({
            value,
            label: tr(`uptime.window.${value}` as never),
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
    </section>
  );
};
export default ProjectMonitor;
