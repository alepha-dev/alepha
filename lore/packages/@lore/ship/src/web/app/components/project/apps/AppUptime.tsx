import { Control } from "@alepha/ui/form";
import type { I18n } from "@lore/core/web";
import { useClient, useQuery, useStore } from "alepha/react";
import { useForm, useFormValues } from "alepha/react/form";
import { useI18n } from "alepha/react/i18n";

import type { MonitorController } from "../../../../../api/controllers/MonitorController.ts";
import { monitorListQuerySchema } from "../../../../../api/schemas/monitorListQuerySchema.ts";
import type { MonitorWindow } from "../../../../../api/schemas/monitorWindowSchema.ts";
import { currentInstanceAtom } from "../../../atoms/currentInstanceAtom.ts";
import MonitorDetailBody from "../uptime/MonitorDetailBody.tsx";
import AppUptimeSkeleton from "./AppUptimeSkeleton.tsx";

/**
 * The app's Uptime tab (#Q3677): its monitor read and watched, over a window
 * of 24 hours, 7 or 30 days. Nothing here changes the check: the Monitor
 * switch and the check's settings are in the copy's Settings (#Q3684), and
 * the tab exists only while that switch is on.
 */
const AppUptime = () => {
  const { tr } = useI18n<I18n, "en">();
  const api = useClient<MonitorController>();
  const [instance] = useStore(currentInstanceAtom);
  const monitorId = instance?.monitor?.id;
  const form = useForm({
    schema: monitorListQuerySchema,
    initialValues: { window: "24h" },
    handler: () => {},
  });
  const window = (useFormValues(form).window ?? "24h") as MonitorWindow;
  const query = useQuery(
    {
      enabled: Boolean(monitorId),
      key: ["uptime-monitor", monitorId, window],
      runEvery: [60, "seconds"],
      handler: async () =>
        monitorId
          ? api.getMonitorDetail({
              params: { monitorId },
              query: { window },
            })
          : undefined,
      onError: () => {},
    },
    [api, monitorId, window],
  );

  if (!monitorId) {
    return null;
  }

  return (
    <section className="mx-auto w-full max-w-6xl overflow-auto p-5">
      {query.error && (
        <p role="alert" className="text-danger-text">
          {query.error.message}
        </p>
      )}
      {query.data ? (
        <MonitorDetailBody
          data={query.data}
          // On the title row, beside the bell (#Q3696): no visible label,
          // the select keeps "Window" as its accessible name.
          actions={
            <Control
              select
              input={form.input.window}
              label=""
              inputProps={{ "aria-label": tr("uptime.windowLabel") }}
              items={["24h", "7d", "30d"].map((value) => ({
                value,
                label: tr(`uptime.window.${value}`),
              }))}
            />
          }
        />
      ) : (
        !query.error && <AppUptimeSkeleton />
      )}
    </section>
  );
};

export default AppUptime;
