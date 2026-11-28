import { $inject } from "alepha";

import type { ProjectEventCatalogEntry } from "../schemas/projectEventCatalogEntrySchema.ts";
import { ProjectEventCatalog } from "./ProjectEventCatalog.ts";
import { ProjectRepositoryService } from "./ProjectRepositoryService.ts";
import { ProjectSecurityService } from "./ProjectSecurityService.ts";

/**
 * The catalog as one project sees it (#Q3892): every event, and whether the
 * project's capabilities give it, with the reason when they do not.
 */
export class ProjectEventCatalogService {
  protected readonly catalog = $inject(ProjectEventCatalog);
  protected readonly security = $inject(ProjectSecurityService);
  protected readonly repositories = $inject(ProjectRepositoryService);

  public async describe(
    projectId: number,
  ): Promise<ProjectEventCatalogEntry[]> {
    const capabilities = await this.security.capabilitiesOf(projectId);
    // Read only when an event needs it: most catalogs have none.
    const all = this.catalog.all();
    const connected = all.some((event) => event.requires === "github")
      ? (await this.repositories.connectionOf(projectId)) !== undefined
      : false;
    return all
      .filter((event) => event.requires !== "github" || connected)
      .map((event) => {
        const needs = event.needs;
        // A Core event (no `needs`) exists in every project.
        const options = needs ? capabilities[needs.capability] : undefined;
        const available =
          !needs ||
          (!!options && (!needs.option || options[needs.option] === true));
        return {
          name: event.name,
          label: event.label,
          resource: event.resource,
          fields: { ...event.fields },
          permission: event.permission,
          ...(needs ? { needs: { ...needs } } : {}),
          ...(event.filter ? { filter: { ...event.filter } } : {}),
          available,
          ...(available || !needs
            ? {}
            : {
                reason: needs.option
                  ? `Needs the ${needs.option} option of ${needs.capability}`
                  : `Needs ${needs.capability}`,
              }),
        };
      });
  }
}
