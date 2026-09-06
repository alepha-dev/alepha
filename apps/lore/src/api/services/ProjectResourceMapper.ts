import { $inject } from "alepha";

import type { ProjectCapability } from "../entities/projectCapabilities.ts";
import type { Project } from "../entities/projects.ts";
import type { ProjectCapabilityResource } from "../schemas/projectCapabilityResourceSchema.ts";
import { CapabilityRegistry } from "./CapabilityRegistry.ts";
import { ProjectSlugService } from "./ProjectSlugService.ts";

/**
 * Turns a `projects` row into the shape the API promises.
 *
 * Two guarantees, and both exist because the alternative is the same mistake
 * repeated at every call site.
 *
 * `slug` is guaranteed present. The physical column is nullable and has to
 * stay that way (see `projectResourceSchema` for why), so the row type is
 * `string | undefined` while every consumer builds a URL from it and needs a
 * plain `string`. Rather than scatter `?? ""` across ~25 call sites in the web
 * app, which would silently render links to `/`, the guarantee is made once
 * here. The fallback is the same `project-<id>` the create path uses.
 *
 * `capabilities` is guaranteed complete: each entry's `options` come back with
 * every option the capability declares, defaulted to `false` where the stored
 * row said nothing. The browser therefore never applies a fallback of its own,
 * which is where "absent reads as false" would eventually be written backwards
 * and turn a switch on for everybody.
 *
 * ⚠️ The rows are a REQUIRED parameter, not an optional one. A call site that
 * has not fetched them is a type error rather than a project that silently
 * reports having no capabilities at all - which reads, everywhere downstream,
 * as a project with every surface turned off.
 */
export class ProjectResourceMapper {
  protected slugs = $inject(ProjectSlugService);
  protected registry = $inject(CapabilityRegistry);

  public toResource<T extends Project>(
    project: T,
    capabilities: ProjectCapability[],
  ): T & { slug: string; capabilities: ProjectCapabilityResource[] } {
    return {
      ...project,
      slug: project.slug ?? this.slugs.fallbackSlug(project.id),
      capabilities: this.toCapabilityResources(capabilities),
    };
  }

  /**
   * The rows as the API hands them out, defaults filled in.
   *
   * A row whose key this build has no descriptor for is dropped rather than
   * passed through: it would fail the response schema's closed enum, taking
   * the whole project read down. Skipping it degrades to "that capability is
   * off" for the length of a rollback, which is the recoverable half.
   */
  protected toCapabilityResources(
    rows: ProjectCapability[],
  ): ProjectCapabilityResource[] {
    const resources: ProjectCapabilityResource[] = [];
    for (const row of rows) {
      if (!this.registry.find(row.key)) continue;
      resources.push({
        key: row.key,
        enabledAt: row.enabledAt,
        options: this.registry.optionsOf(row.key, row.options),
      });
    }
    return resources;
  }
}
