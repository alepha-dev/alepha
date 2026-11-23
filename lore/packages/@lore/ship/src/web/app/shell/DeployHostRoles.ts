import { HostRoleRegistry } from "@lore/core/web";
import { $inject } from "alepha";
import { Rocket } from "lucide-react";

/**
 * Ship's host role, `deploy` (#E166, #Q4098), beside core's stats and agent:
 * a host that takes deploys from where it is shown. Injected from
 * `LoreShipWeb`'s `register()`, and by a spec rendering the pills.
 */
export class DeployHostRoles {
  protected readonly roles = $inject(HostRoleRegistry);

  constructor() {
    this.roles.register({
      key: "deploy",
      order: 20,
      icon: Rocket,
      applies: (host) => host.deployAllowed === true,
      label: () => "deploy",
    });
  }
}
