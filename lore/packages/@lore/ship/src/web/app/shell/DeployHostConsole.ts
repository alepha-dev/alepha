import {
  hasCapability,
  HostConsoleRegistry,
  HostTypeUiRegistry,
} from "@lore/core/web";
import { $inject } from "alepha";
import { Cloud, Layers } from "lucide-react";

import BayStacksSection from "../components/bay/BayStacksSection.tsx";
import CloudflareHostCreateFields from "../components/hosts/CloudflareHostCreateFields.tsx";
import CloudflareHostDrawerSection from "../components/hosts/CloudflareHostDrawerSection.tsx";

/**
 * Ship's part of core's host console and host types (#E166): the Processes
 * tab (the apps on the machine, whose instance page keeps it lit) and the
 * stacks on the Overview, both shown while the console's project has Ship
 * on, and the `cloudflare` type, offered everywhere. Injected
 * from `LoreShipWeb`'s `register()`.
 */
export class DeployHostConsole {
  protected readonly console = $inject(HostConsoleRegistry);
  protected readonly types = $inject(HostTypeUiRegistry);

  constructor() {
    // The `cloudflare` type (#E166): offered in every project, Ship on or
    // off, with its create fields and its drawer's credential section.
    this.types.register({
      type: "cloudflare",
      order: 20,
      labelKey: "hosts.type.cloudflare",
      descriptionKey: "hosts.type.cloudflare.description",
      icon: Cloud,
      CreateFields: CloudflareHostCreateFields,
      DrawerSection: CloudflareHostDrawerSection,
    });
    this.console.registerTab({
      route: "bayApps",
      labelKey: "bay.nav.apps",
      icon: Layers,
      order: 20,
      activeOn: (routeName) => routeName === "bayApp",
      visible: (project) => hasCapability(project, "ship"),
    });
    this.console.registerSection({
      key: "stacks",
      order: 10,
      Component: BayStacksSection,
      visible: (project) => hasCapability(project, "ship"),
    });
  }
}
