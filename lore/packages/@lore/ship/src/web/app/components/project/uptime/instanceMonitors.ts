import type { AppInstanceResource } from "../../../../../api/schemas/appInstanceResourceSchema.ts";
import type { MonitorResource } from "../../../../../api/schemas/monitorResourceSchema.ts";
import { appUrl } from "../apps/appUrl.ts";

/**
 * What the Add monitor dialog starts from: the app copy the monitor will
 * belong to, and the copy's own name and address (#Q2680, #Q3657).
 */
export interface MonitorPrefill {
  appInstanceId: string;
  name: string;
  target: string;
}

/**
 * The monitor this app copy owns, if any.
 *
 * The link is `monitors.appInstanceId` (#Q3657), stored, not an address
 * comparison: two copies at one address each own their own check, and a copy
 * whose address changes keeps its monitor.
 */
export const monitorOfInstance = <T extends MonitorResource>(
  instance: AppInstanceResource,
  monitors: T[],
): T | undefined =>
  monitors.find((monitor) => monitor.appInstanceId === instance.id);

/**
 * The dialog's starting values for a monitor on this copy. The target is the
 * copy's address when it has one, and empty otherwise: a copy with no
 * address can still own a push or a TCP check.
 */
export const monitorPrefill = (
  instance: AppInstanceResource,
): MonitorPrefill => ({
  appInstanceId: instance.id,
  name: `${instance.app} ${instance.env}`,
  target: appUrl(instance) ?? "",
});
