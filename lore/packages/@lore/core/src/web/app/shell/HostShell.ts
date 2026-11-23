import { $inject } from "alepha";

import { currentHostAtom } from "../atoms/currentHostAtom.ts";
import { ROUTES_HOST } from "../components/project/projectViewRoutes.ts";
import { useHomeHostsBlocker } from "../components/project/settings/useHomeHostsBlocker.ts";
import { ProjectBlockerRegistry } from "../registries/ProjectBlockerRegistry.ts";
import { ProjectShellRegistry } from "../registries/ProjectShellRegistry.ts";

/**
 * The generic host's part of the project shell (#E166): the host crumb at
 * the end of a console's trail, and the line that warns before deleting a
 * project that is a host's home. Ship's `DeployShell` registered both before
 * hosts were core's. Injected from `LoreCoreWeb`'s `register()`.
 */
export class HostShell {
  protected readonly shell = $inject(ProjectShellRegistry);
  protected readonly blockers = $inject(ProjectBlockerRegistry);

  constructor() {
    // A host's console ends its trail with the host (#Q3408): "Project >
    // Hosts > ovh", "Hosts" climbing back to the project's hosts list.
    // The console's tabs stay on its plate, not on this bar. It replaced an
    // "All hosts" link in the plate, which said what the crumb already did.
    this.shell.registerCrumb({
      order: 15,
      reads: [currentHostAtom],
      crumb: (ctx) => {
        const host = ctx.get(currentHostAtom);
        return ROUTES_HOST.includes(ctx.routeName) && host
          ? {
              label: host.slug,
              href: ctx.path("bayOverview", {
                projectSlug: ctx.projectSlug,
                hostSlug: host.slug,
              }),
            }
          : undefined;
      },
    });

    // A project that is the home of a host is not deleted (#Q3280); the
    // page says so before the click (#Q3281).
    this.blockers.register({
      key: "home-hosts",
      order: 20,
      useLine: useHomeHostsBlocker,
    });
  }
}
