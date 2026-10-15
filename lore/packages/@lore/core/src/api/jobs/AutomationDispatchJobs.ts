import { $inject } from "alepha";
import { $job } from "alepha/api/jobs";

import { AutomationClaims } from "../services/AutomationClaims.ts";
import { AutomationDispatchRegistry } from "../services/AutomationDispatchRegistry.ts";
import { AutomationEvents } from "../services/AutomationEvents.ts";
import { AutomationHealth } from "../services/AutomationHealth.ts";

export class AutomationDispatchJobs {
  protected readonly health = $inject(AutomationHealth);
  protected readonly registry = $inject(AutomationDispatchRegistry);
  protected readonly events = $inject(AutomationEvents);
  protected readonly claims = $inject(AutomationClaims);
  constructor() {
    this.registry.register("recovery", (limit) =>
      this.claims.sweepRecovery(limit),
    );
    this.registry.register("events", (limit) => this.events.sweep(limit));
  }
  public readonly tick = $job({
    name: "automations.dispatch",
    description:
      "Claims at most 50 recoveries, events and due schedules every five minutes in UTC.",
    cron: "*/5 * * * *",
    timeout: [2, "minutes"],
    handler: async () => {
      await this.health.sweep();
      await this.registry.tick();
    },
  });
}
