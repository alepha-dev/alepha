import { $inject } from "alepha";
import { FileAccessProvider, type FileEntity } from "alepha/api/files";
import { RankService } from "alepha/api/organizations";
import { $repository, DatabaseProvider } from "alepha/orm";
import type { UserAccountToken } from "alepha/security";
import { ForbiddenError } from "alepha/server";

import { projects } from "../entities/projects.ts";
import { FileAccessRegistry } from "../services/FileAccessRegistry.ts";
import { ProjectSecurityService } from "../services/ProjectSecurityService.ts";

/**
 * Per-bucket file access policy for Lore.
 *
 * Files are tenant-scoped through the entities that reference them
 * (projects.icon here; quest, feedback and folio attachments through the
 * modules' `FileAccessRegistry` rules). We locate the owning entity by id,
 * then delegate to the same project gate used by HTTP controllers. The default framework policy is
 * creator-only — this widens it for the well-known buckets.
 */
export class LoreFileAccessProvider extends FileAccessProvider {
  protected readonly ranks = $inject(RankService);
  protected readonly projectSecurity = $inject(ProjectSecurityService);
  protected readonly database = $inject(DatabaseProvider);
  protected readonly projects = $repository(projects);
  protected readonly fileAccess = $inject(FileAccessRegistry);

  // Bucket value stays "campaign-icons" — see the note on `iconBucket`
  // in `ProjectController.ts`.
  protected static readonly PROJECT_ICON_BUCKET = "campaign-icons";
  protected static readonly AVATAR_BUCKET = "avatars";

  /**
   * ⚠️ **ranks: imperative.** This is a `$secure` guard on a file route, and
   * which project it asks about is decided per BUCKET, several branches into
   * the function. No `use:` entry can express that, so these four calls ask
   * the ranks module directly - each naming the permission its bucket needs,
   * which is more than the membership check they replaced could say.
   */
  async assertReadable(
    file: FileEntity,
    user: UserAccountToken | undefined,
  ): Promise<void> {
    if (!user) {
      throw new ForbiddenError("File access requires authentication");
    }

    // Privileged identities pass through (admin tooling).
    if (user.ownership === false) {
      return;
    }

    // Uploader is always allowed.
    if (file.creator && file.creator === user.id) {
      return;
    }

    // Avatars are profile pictures rendered across the UI — any
    // authenticated user can fetch them.
    if (file.bucket === LoreFileAccessProvider.AVATAR_BUCKET) {
      return;
    }

    // Project icons: anyone who can see the project can render its icon.
    if (file.bucket === LoreFileAccessProvider.PROJECT_ICON_BUCKET) {
      const project = await this.projects.findOne({
        where: { icon: { eq: file.id } },
      });
      if (project) {
        await this.ranks.assert(project.organizationId!, "project:read", user);
        return;
      }
      // Orphan icon (uploaded but never assigned) stays creator-only.
      throw new ForbiddenError("File access denied");
    }

    // Every other well-known bucket belongs to a feature module: quest and
    // feedback attachments (Work), folio attachments (Knowledge). The module
    // says which project the file belongs to and which permission reads it
    // (`FileAccessRegistry`, #E75 #Q2623); core asserts it.
    const rule = this.fileAccess.rule(file.bucket);
    if (rule) {
      const owner = await rule(file.id);
      if (owner) {
        await this.ranks.assert(
          await this.projectSecurity.organizationIdOf(owner.projectId),
          owner.permission,
          user,
        );
        return;
      }
      throw new ForbiddenError("File access denied");
    }

    // Unknown bucket: fall back to creator-only (already failed above).
    throw new ForbiddenError("File access denied");
  }

  /**
   * Avatars and project icons are served anonymously through the
   * `/public/files/:id` route (edge-cacheable). They're low-sensitivity,
   * rendered in unauthenticated contexts, and addressed by opaque uuid —
   * so they opt out of the default deny-all. Everything else stays private
   * (base `assertPublic` throws NotFoundError).
   */
  async assertPublic(file: FileEntity): Promise<void> {
    if (
      file.bucket === LoreFileAccessProvider.AVATAR_BUCKET ||
      file.bucket === LoreFileAccessProvider.PROJECT_ICON_BUCKET
    ) {
      return;
    }
    return super.assertPublic(file);
  }
}
