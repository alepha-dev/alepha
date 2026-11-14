import type { AppInstanceResource } from "../../../../../api/schemas/appInstanceResourceSchema.ts";
import type { MonitorResource } from "../../../../../api/schemas/monitorResourceSchema.ts";
import { appUrl } from "../apps/appUrl.ts";

/**
 * What the Add monitor dialog starts from when it is opened for an app
 * instance rather than blank (#Q2680).
 */
export interface MonitorPrefill {
  name: string;
  target: string;
}

/**
 * A URL as two monitors would compare it: case-folded, with no trailing slash.
 *
 * ⚠️ The link between a monitor and an app instance is this comparison and
 * nothing stored. A monitor has no instance column, so a monitor added by hand
 * for the same address counts as the instance's monitor too, which is the
 * answer a reader expects: one address, one check.
 */
export const comparableUrl = (url: string): string =>
  url.trim().toLowerCase().replace(/\/+$/, "");

/**
 * The HTTP monitor watching this instance's address, if any.
 */
export const monitorOfInstance = <T extends MonitorResource>(
  instance: AppInstanceResource,
  monitors: T[],
): T | undefined => {
  const url = appUrl(instance);
  if (!url) {
    return undefined;
  }
  const wanted = comparableUrl(url);
  return monitors.find(
    (monitor) =>
      monitor.kind === "http" && comparableUrl(monitor.target) === wanted,
  );
};

/**
 * The dialog's starting values for this instance, or `undefined` when it has
 * no address to check.
 */
export const monitorPrefill = (
  instance: AppInstanceResource,
): MonitorPrefill | undefined => {
  const url = appUrl(instance);
  return url
    ? { name: `${instance.app} ${instance.env}`, target: url }
    : undefined;
};

/**
 * The instances worth offering as a one-click monitor: a durable copy with an
 * address and no monitor on it yet.
 *
 * Ephemeral copies are left out on purpose. A preview environment comes and
 * goes, and a monitor that outlives it pages somebody about a copy that was
 * meant to disappear.
 */
export const unmonitoredInstances = (
  instances: AppInstanceResource[],
  monitors: MonitorResource[],
): AppInstanceResource[] =>
  instances.filter(
    (instance) =>
      !instance.ephemeral &&
      appUrl(instance) !== undefined &&
      !monitorOfInstance(instance, monitors),
  );
