import { $inject } from "alepha";
import { $logger } from "alepha/logger";
import { $scheduler } from "alepha/scheduler";
import { ParameterStore } from "../services/ParameterStore.ts";

/**
 * Scheduler that periodically checks for scheduled parameters
 * that should be activated.
 *
 * Runs every minute to check if any NEXT parameters have reached
 * their activation date and need to be promoted to CURRENT.
 */
export class ParameterActivationScheduler {
  protected readonly log = $logger();
  protected readonly store = $inject(ParameterStore);

  /**
   * Check for scheduled parameters every minute.
   */
  checkActivations = $scheduler({
    name: "parameter-activation-check",
    description: "Checks for scheduled parameters that should be activated",
    interval: [1, "minute"],
    lock: true,
    handler: async () => {
      this.log.debug("Checking for scheduled parameter activations");
      await this.store.activateScheduledParameters();
    },
  });
}
