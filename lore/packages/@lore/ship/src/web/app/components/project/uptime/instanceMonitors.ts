import type { AppInstanceResource } from "../../../../../api/schemas/appInstanceResourceSchema.ts";
import type { MonitorResource } from "../../../../../api/schemas/monitorResourceSchema.ts";

/**
 * The monitor this app copy owns, if any: its HTTP check when it has one,
 * which is the one the app settings' Monitor switch manages (#Q3684), else
 * whichever it owns.
 *
 * The link is `monitors.appInstanceId` (#Q3657), stored, not an address
 * comparison: two copies at one address each own their own check, and a copy
 * whose address changes keeps its monitor.
 */
export const monitorOfInstance = <T extends MonitorResource>(
  instance: AppInstanceResource,
  monitors: T[],
): T | undefined => {
  const owned = monitors.filter(
    (monitor) => monitor.appInstanceId === instance.id,
  );
  return owned.find((monitor) => monitor.kind === "http") ?? owned[0];
};
