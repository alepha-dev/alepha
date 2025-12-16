import { $inject } from "alepha";
import { $logger } from "alepha/logger";
import { $scheduler } from "alepha/scheduler";
import { ConfigStore } from "../services/ConfigStore.ts";

/**
 * Scheduler that periodically checks for scheduled configurations
 * that should be activated.
 *
 * Runs every minute to check if any NEXT configurations have reached
 * their activation date and need to be promoted to CURRENT.
 */
export class ConfigActivationScheduler {
  protected readonly log = $logger();
  protected readonly store = $inject(ConfigStore);

  /**
   * Check for scheduled configurations every minute.
   */
  checkActivations = $scheduler({
    name: "config-activation-check",
    description: "Checks for scheduled configurations that should be activated",
    interval: [1, "minute"],
    lock: true,
    handler: async () => {
      this.log.debug("Checking for scheduled config activations");
      await this.store.activateScheduledConfigs();
    },
  });
}
