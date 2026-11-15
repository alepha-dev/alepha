import {
  canInProject,
  capabilityOption,
  currentProjectAtom,
} from "@lore/core/web";
import { useClient, useQuery, useStore } from "alepha/react";
import { useState } from "react";

import type { MonitorController } from "../../../../../api/controllers/MonitorController.ts";
import type { AppInstanceResource } from "../../../../../api/schemas/appInstanceResourceSchema.ts";
import {
  monitorOfInstance,
  monitorPrefill,
} from "../uptime/instanceMonitors.ts";
import MonitorFormDialog from "../uptime/MonitorFormDialog.tsx";
import AppUptimeCard from "./AppUptimeCard.tsx";

export interface AppDashboardUptimeProps {
  instance: AppInstanceResource;
}

/**
 * Loads the project's monitors and shows this instance's one, or offers to add
 * it prefilled (#Q2680).
 *
 * ⚠️ Rendered only when the Apps `uptime` option is on, like every other
 * uptime surface; the query is not even issued otherwise. Its key is the one
 * `/uptime` uses for the same window, so a monitor added from either page
 * shows on both.
 */
const AppDashboardUptime = (props: AppDashboardUptimeProps) => {
  const [project] = useStore(currentProjectAtom);
  const api = useClient<MonitorController>();
  const [adding, setAdding] = useState(false);
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

  if (!project || !enabled) {
    return null;
  }

  // ⚠️ The dialog renders whether or not the list has loaded: creating a
  // monitor invalidates that list, and a dialog inside the loaded branch
  // would unmount during the refetch, losing a push monitor's one-time
  // token and reopening empty.
  const monitor = query.data
    ? monitorOfInstance(props.instance, query.data.items ?? [])
    : undefined;

  return (
    <>
      {query.data && (
        <AppUptimeCard
          monitor={monitor}
          href={monitor ? `/${project.slug}/uptime/${monitor.id}` : undefined}
          canAdd={canInProject(project, "app:manage")}
          busy={adding}
          onAdd={() => setAdding(true)}
        />
      )}
      {adding && (
        <MonitorFormDialog
          projectId={project.id}
          prefill={monitorPrefill(props.instance)}
          onClose={() => setAdding(false)}
        />
      )}
    </>
  );
};

export default AppDashboardUptime;
