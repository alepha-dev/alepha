import { $error } from "alepha";

/**
 * Control flow, not a failure: a legacy automation job already dealt with
 * its outcome, and the queue stops here without reporting an error.
 */
export const AutomationLegacyHandled = $error({
  name: "AUTOMATION_LEGACY_HANDLED",
  message: "The legacy automation job was handled",
});

export type AutomationLegacyHandled = InstanceType<
  typeof AutomationLegacyHandled
>;
