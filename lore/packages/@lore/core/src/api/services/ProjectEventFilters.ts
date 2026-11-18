import { AlephaError } from "alepha";

/**
 * Where a subscription's filter values come from (#Q3892): the package that
 * owns a resource registers how to list a project's own (Ship: hosts, apps,
 * monitors), so the Notifications page offers them in a picker.
 */
export class ProjectEventFilters {
  protected readonly sources = new Map<string, ProjectEventFilterSource>();

  public register(resource: string, source: ProjectEventFilterSource): void {
    if (this.sources.has(resource))
      throw new AlephaError(
        `Project event filter '${resource}' is registered twice`,
      );
    this.sources.set(resource, source);
  }

  public async options(
    projectId: number,
    resource: string,
  ): Promise<Array<{ value: string; label: string }>> {
    const source = this.sources.get(resource);
    return source ? (await source(projectId)).slice(0, 500) : [];
  }
}

export type ProjectEventFilterSource = (
  projectId: number,
) => Promise<Array<{ value: string; label: string }>>;
