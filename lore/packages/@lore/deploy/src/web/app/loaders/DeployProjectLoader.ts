import { ProjectLoaderRegistry, hasCapability } from "@lore/core/web";
import { $inject, Alepha } from "alepha";
import { $client } from "alepha/server/links";

import type { AppController } from "../../../api/controllers/AppController.ts";
import type { ProjectErrorController } from "../../../api/controllers/ProjectErrorController.ts";
import { currentErrorCountAtom } from "../atoms/currentErrorCountAtom.ts";
import { currentInstancesAtom } from "../atoms/currentInstancesAtom.ts";

/**
 * What Deploy reads when a project opens, registered on core's
 * `ProjectLoaderRegistry` (#E75, #Q2624): the deployed copies and the open
 * errors count.
 */
export class DeployProjectLoader {
  protected readonly alepha = $inject(Alepha);
  protected readonly loaders = $inject(ProjectLoaderRegistry);
  protected readonly appApi = $client<AppController>();
  protected readonly projectErrorApi = $client<ProjectErrorController>();

  constructor() {
    this.loaders.register({
      key: "deploy",
      order: 30,
      load: async (project) => {
        const projectId = project.id;
        const apps = hasCapability(project, "apps");
        const [instances, openErrors] = await Promise.all([
          // The project's app instances. Member-readable (`listApps` is
          // gated on `project:read`, unlike every mutation) but `.catch`
          // keeps a transient failure from taking the whole project down
          // with it. `undefined` on failure, NOT `[]`: the sidebar entry,
          // Spotlight and the Errors derivation all need to tell "no apps"
          // apart from "could not read the apps": see `currentInstancesAtom`.
          apps
            ? this.appApi
                .listApps({ params: { projectId } })
                .then((r) => r.items)
                .catch(() => undefined)
            : Promise.resolve([]),
          // Open-error count for the sidebar badge, under the module's
          // master switch alone, deliberately *not* narrowed to "some
          // enrolled app still carries the `projectErrors` kind". An error
          // outlives the credential that filed it (`projectErrors.sigilId` is
          // `ON DELETE SET NULL` and rows survive for `retentionDays`), and
          // `ProjectView` reads this count to keep the inbox entry reachable.
          apps
            ? this.projectErrorApi
                .countOpenProjectErrors({ params: { projectId } })
                .then((r) => r.count)
                .catch(() => 0)
            : Promise.resolve(0),
        ]);
        return () => {
          this.alepha.store.set(currentInstancesAtom, instances);
          this.alepha.store.set(currentErrorCountAtom, {
            count: openErrors,
          });
        };
      },
      leave: () => {
        this.alepha.store.set(currentInstancesAtom, undefined);
        this.alepha.store.set(currentErrorCountAtom, { count: 0 });
      },
    });
  }
}
