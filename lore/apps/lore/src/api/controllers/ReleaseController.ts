import { $inject, z } from "alepha";
import { $storage } from "alepha/api/files";
import { $secure } from "alepha/security";
import { $action, NotFoundError } from "alepha/server";
import type { Release } from "../entities/releases.ts";
import { releaseResourceSchema } from "../schemas/releaseResource.ts";
import { ProjectSecurityService } from "../services/ProjectSecurityService.ts";
import { ReleaseService } from "../services/ReleaseService.ts";

/**
 * The registry, as `alepha platform up` talks to it.
 *
 * **Member-gated, not owner-gated**, which is the one place this diverges from
 * the sigil surface next door. Enrolling a machine stays owner-only, so the
 * owner still decides what infrastructure exists; a member can only ship to
 * machines the owner already admitted. That is GitHub's split — push access is
 * not admin access — and it is what makes the CI credential safe to mint under
 * a robot user instead of the owner's own account, which would hand a runner
 * everything the owner can do in Lore.
 *
 * Uploading the bytes is not here: `alepha/api/files` owns that flow, and this
 * controller registers a release on top of a file that already exists. One
 * upload path for folios, feedback and releases alike.
 */
export class ReleaseController {
  protected readonly releases = $inject(ReleaseService);
  protected readonly security = $inject(ProjectSecurityService);

  /**
   * Deployable artifacts.
   *
   * `alepha/api/files` owns the bytes and the provider behind them, which is
   * the whole point: Lore will leave Cloudflare one day, and a registry that
   * names R2 is the piece that would not follow.
   *
   * 100 MB because a Worker refuses a larger body anyway. A typical artifact is
   * around 10 MB; lindocara, a game shipping its own assets, is 33 MB and is
   * the outlier. Past this ceiling the answer is a presigned multipart upload,
   * not a bigger number here.
   */
  releaseBucket = $storage({
    name: "releases",
    description: "Deployable artifacts",
    maxSize: 100,
    mimeTypes: ["application/gzip"],
  });

  /**
   * Registers an artifact and puts it in the queue for whichever machine hosts
   * this app.
   *
   * Answers with the row in `pending`. Nothing has been deployed yet — the
   * caller is expected to watch {@link getRelease} until it settles, and that
   * wait is what makes a green build mean "it serves" rather than "it
   * uploaded".
   */
  createRelease = $action({
    use: [$secure({ permissions: ["project:update"] })],
    method: "POST",
    path: "/projects/:projectId/releases",
    schema: {
      params: z.object({ projectId: z.integer() }),
      body: z.object({
        app: z.string().min(1).max(100),
        environment: z.string().min(1).max(50),
        version: z.string().min(1).max(100),
        /** Digest of the artifact. 64 lowercase hex characters. */
        sha256: z.string().min(64).max(64),
        /** The `alepha/api/files` id returned by the upload. */
        fileId: z.uuid(),
        sizeBytes: z.integer().min(0).optional(),
      }),
      response: releaseResourceSchema,
    },
    handler: async ({ params, body, user }) => {
      await this.security.assertMember(params.projectId, user);

      const release = await this.releases.register({
        projectId: params.projectId,
        app: body.app,
        environment: body.environment,
        version: body.version,
        sha256: body.sha256,
        fileId: body.fileId,
        sizeBytes: body.sizeBytes,
        userId: user?.id,
      });

      return this.toResource(release);
    },
  });

  /**
   * One release, for a client waiting on it.
   *
   * The only endpoint `platform up` polls, so it stays cheap: one row by id,
   * scoped to the project in the path.
   */
  getRelease = $action({
    use: [$secure({ permissions: ["project:read"] })],
    method: "GET",
    path: "/projects/:projectId/releases/:releaseId",
    schema: {
      params: z.object({ projectId: z.integer(), releaseId: z.uuid() }),
      response: releaseResourceSchema,
    },
    handler: async ({ params, user }) => {
      await this.security.assertMember(params.projectId, user);

      const release = await this.releases.get(params.releaseId);
      // The project check is not redundant with the membership gate above:
      // without it, a member of any project could read any release by id, and
      // a release names the app and environment it ships to.
      if (!release || release.projectId !== params.projectId) {
        throw new NotFoundError("Release not found");
      }

      return this.toResource(release);
    },
  });

  /**
   * The project's recent releases.
   *
   * Serves three callers at once: the authentication pre-check `platform up`
   * runs before spending two minutes on a build, its `inspect`, and the UI the
   * day it exists.
   */
  listReleases = $action({
    use: [$secure({ permissions: ["project:read"] })],
    method: "GET",
    path: "/projects/:projectId/releases",
    schema: {
      params: z.object({ projectId: z.integer() }),
      response: z.object({ items: z.array(releaseResourceSchema) }),
    },
    handler: async ({ params, user }) => {
      await this.security.assertMember(params.projectId, user);

      const items = await this.releases.listByProject(params.projectId);
      return { items: items.map((release) => this.toResource(release)) };
    },
  });

  /**
   * Drops `fileId` on the way out.
   *
   * `schema.response` would strip it anyway; doing it here as well means the
   * omission is visible at the place someone would otherwise add the field back
   * without thinking about who is asking.
   */
  protected toResource(release: Release) {
    return {
      id: release.id,
      projectId: release.projectId,
      app: release.app,
      environment: release.environment,
      version: release.version,
      sha256: release.sha256,
      sizeBytes: release.sizeBytes,
      status: release.status,
      failureReason: release.failureReason,
      outpostId: release.outpostId,
      claimedAt: release.claimedAt,
      createdAt: release.createdAt,
      updatedAt: release.updatedAt,
    };
  }
}
