import { capabilityOption, currentProjectAtom } from "@lore/core/web";
import { useClient, useQuery, useStore } from "alepha/react";

import type { MonitorController } from "../../../../../api/controllers/MonitorController.ts";
import type { AppInstanceResource } from "../../../../../api/schemas/appInstanceResourceSchema.ts";
import { monitorOfInstance } from "../uptime/instanceMonitors.ts";
import AppUptimeCard from "./AppUptimeCard.tsx";

export interface AppDashboardUptimeProps {
  instance: AppInstanceResource;
}

/**
 * Loads the project's monitors and summarises this copy's, while Monitor is on
 * in its settings (#Q3684). Turning it on happens there, not here.
 *
 * ⚠️ Rendered only when the Apps `uptime` option is on, like every other
 * uptime surface; the query is not even issued otherwise. Its key is the one
 * `/uptime` uses for the same window, so a monitor added from either page
 * shows on both.
 */
const AppDashboardUptime = (props: AppDashboardUptimeProps) => {
  const [project] = useStore(currentProjectAtom);
  const api = useClient<MonitorController>();
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

  if (!project || !enabled || !query.data) {
    return null;
  }

  // Only while Monitor is on in the app's settings (#Q3684): a paused
  // monitor keeps its history but leaves the Overview, and nothing here
  // offers to add one.
  const monitor = monitorOfInstance(props.instance, query.data.items ?? []);
  if (!monitor?.active) {
    return null;
  }

  return (
    <AppUptimeCard
      monitor={monitor}
      href={`/${project.slug}/uptime/${monitor.id}`}
    />
  );
};

export default AppDashboardUptime;
