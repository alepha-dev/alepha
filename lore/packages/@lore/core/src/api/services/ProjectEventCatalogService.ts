import { $inject } from "alepha";

import type { ProjectEventCatalogEntry } from "../schemas/projectEventCatalogEntrySchema.ts";
import { ProjectEventCatalog } from "./ProjectEventCatalog.ts";
import { ProjectSecurityService } from "./ProjectSecurityService.ts";

/**
 * The catalog as one project sees it (#Q3892): every event, and whether the
 * project's capabilities give it, with the reason when they do not.
 */
export class ProjectEventCatalogService {
  protected readonly catalog = $inject(ProjectEventCatalog);
  protected readonly security = $inject(ProjectSecurityService);

  public async describe(
    projectId: number,
  ): Promise<ProjectEventCatalogEntry[]> {
    const capabilities = await this.security.capabilitiesOf(projectId);
    return this.catalog.all().map((event) => {
      const options = capabilities[event.needs.capability];
      const available =
        !!options &&
        (!event.needs.option || options[event.needs.option] === true);
      return {
        name: event.name,
        label: event.label,
        resource: event.resource,
        fields: { ...event.fields },
        permission: event.permission,
        needs: { ...event.needs },
        ...(event.filter ? { filter: { ...event.filter } } : {}),
        available,
        ...(available
          ? {}
          : {
              reason: event.needs.option
                ? `Needs the ${event.needs.option} option of ${event.needs.capability}`
                : `Needs ${event.needs.capability}`,
            }),
      };
    });
  }
}
