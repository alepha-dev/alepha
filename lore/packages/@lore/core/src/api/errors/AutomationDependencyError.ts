import { $error } from "alepha";

/**
 * An automation refers to something that is not there, or not usable: a
 * missing row, an unavailable channel, a non-database 4xx. The automation is
 * marked broken rather than paused, and the failure is not retried.
 */
export const AutomationDependencyError = $error({
  name: "AUTOMATION_DEPENDENCY",
  message: "An automation dependency is unavailable",
});

export type AutomationDependencyError = InstanceType<
  typeof AutomationDependencyError
>;
