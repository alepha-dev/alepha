import { $repository } from "alepha/orm";

import { members } from "../entities/members.ts";
import { projects } from "../entities/projects.ts";
import { quests } from "../entities/quests.ts";

/**
 * The one definition of "delete a project and its dependents".
 *
 * It exists because there are now two callers — the owner deleting their own
 * project (`ProjectController.deleteProjectById`) and an operator deleting one
 * from the admin shell — and a second hand-written copy of a cascade is how
 * the two drift. The failure mode is silent and permanent: add a child table
 * to one path, forget the other, and half the deletes leave orphans nobody
 * looks for.
 *
 * `projects` is also the `ON DELETE CASCADE` parent that wiped lore
 * production in 2026-05, so this is the most destructive path in the app and
 * the one least suited to being written twice.
 *
 * Deliberately not a permission check. Both callers gate first — the owner
 * path with `$owns`, the admin path with `admin:project:delete` — and putting
 * authorization here would give the impression the call is safe to make from
 * anywhere.
 */
export class ProjectDeletionService {
  protected readonly projects = $repository(projects);
  protected readonly members = $repository(members);
  protected readonly quests = $repository(quests);

  /**
   * Removes the project row, then the child rows the application deletes
   * explicitly rather than leaving to a database cascade.
   */
  public async deleteProject(projectId: number): Promise<void> {
    await this.freeSlug(projectId);
    await this.projects.deleteById(projectId);
    await this.members.deleteMany({ projectId: { eq: projectId } });
    await this.quests.deleteMany({ projectId: { eq: projectId } });
  }

  /**
   * Releases the project's URL slug so the name can be claimed again.
   *
   * Load-bearing, and not obviously so. `deleteById` on an entity with a
   * `deletedAt` column is a **soft** delete: the row survives, and it keeps
   * occupying `projects_slug_idx`. But every read path filters soft-deleted
   * rows out — so `ProjectController.assertSlugAvailable` cannot see the slug
   * while the UNIQUE index still rejects it. Creating a project with the freed
   * name would pass the check and then fail on the constraint, surfacing as a
   * 500 instead of either succeeding or returning a clean 409.
   *
   * Clearing it also matches the rename semantics the settings page warns
   * about: a name you give up is a name someone else can take.
   *
   * Runs before the delete rather than after, so `save` is not writing to a
   * row the repository now considers gone.
   */
  protected async freeSlug(projectId: number): Promise<void> {
    const project = await this.projects.findOne({
      where: { id: { eq: projectId } },
    });
    if (!project?.slug) {
      return;
    }
    project.slug = undefined;
    await this.projects.save(project);
  }
}
