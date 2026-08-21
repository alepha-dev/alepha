import { $inject } from "alepha";

import type { Project } from "../entities/projects.ts";
import { ProjectSlugService } from "./ProjectSlugService.ts";

/**
 * Turns a `projects` row into the shape the API promises.
 *
 * The one thing it does is guarantee `slug`. The physical column is nullable
 * and has to stay that way (see `projectResourceSchema` for why), so the row
 * type is `string | undefined` — while every consumer builds a URL from it and
 * needs a plain `string`. Rather than scatter `?? ""` across ~25 call sites in
 * the web app, which would silently render links to `/`, the guarantee is made
 * once here.
 *
 * The fallback is the same `project-<id>` the create path uses, so a row that
 * somehow escaped the backfill still produces a URL shaped like every other
 * one instead of a broken link.
 */
export class ProjectResourceMapper {
  protected slugs = $inject(ProjectSlugService);

  public toResource<T extends Project>(project: T): T & { slug: string } {
    return {
      ...project,
      slug: project.slug ?? this.slugs.fallbackSlug(project.id),
    };
  }
}
