import type { CapabilityKey } from "@/api/schemas/capabilityKeySchema.ts";
import type { ProjectResource } from "@/api/schemas/projectResourceSchema.ts";

/**
 * Reading a project's capabilities, web-side.
 *
 * Two rules, and both are the server's, restated here because the browser has
 * to apply them too:
 *
 * - **A key is present if and only if the capability is on.** There is no
 *   `enabled: false` entry, so this is a presence test and nothing more.
 * - **An option of a capability that is off is off**, whatever it says. That
 *   is the epic's one rule about capabilities reading each other: narrow,
 *   never widen.
 *
 * ⚠️ Module-level functions rather than a service, the precedent being
 * `defaultAppInstance`: these are read by `$page` LOADERS, which run in the
 * browser and cannot inject anything. A hook would work in a component and
 * not in a loader, and the two must not disagree about which pages exist.
 */
export const hasCapability = (
  project: Pick<ProjectResource, "capabilities"> | undefined,
  key: CapabilityKey,
): boolean => (project?.capabilities ?? []).some((it) => it.key === key);

export const capabilityOption = (
  project: Pick<ProjectResource, "capabilities"> | undefined,
  key: CapabilityKey,
  option: string,
): boolean =>
  (project?.capabilities ?? []).find((it) => it.key === key)?.options[
    option
  ] === true;
