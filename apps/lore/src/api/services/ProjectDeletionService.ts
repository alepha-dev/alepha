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
    await this.projects.deleteById(projectId);
    await this.members.deleteMany({ projectId: { eq: projectId } });
    await this.quests.deleteMany({ projectId: { eq: projectId } });
  }
}
