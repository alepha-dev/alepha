import { $inject, z } from "alepha";
import { $storage } from "alepha/api/files";
import { $secure } from "alepha/security";
import { $action } from "alepha/server";

import type { Artifact } from "../entities/artifacts.ts";
import { appNameSchema } from "../schemas/appNameSchema.ts";
import { artifactListSchema } from "../schemas/artifactListSchema.ts";
import { artifactPushResultSchema } from "../schemas/artifactPushResultSchema.ts";
import { releaseTagSchema } from "../schemas/releaseTagSchema.ts";
import { $ownsProject } from "../security/$ownsProject.ts";
import { ArtifactService } from "../services/ArtifactService.ts";

/**
 * The endpoint CI pushes a build into.
 *
 * ## ⚠️ Action names are the wire contract here
 *
 * `@alepha/lore/cli` reaches this endpoint by path rather than through
 * `$client`, but the path is the same kind of promise: a deployed Lore answers
 * whatever it was deployed with, and a renamed route answers an older CLI with
 * a 404. Rename it only on purpose.
 *
 * ## The gate is membership, not ownership
 *
 * `$ownsProject({ param: "projectId" })` with no `owner: true`, matching
 * `QualityController`: pushing a build is the work, not the project's
 * configuration.
 *
 * There is no `features` check either, and for the same reason the quality
 * push has none. A flag gates a TAB. A push refused because someone flipped a
 * switch in the UI turns a build red for a reason that has nothing to do with
 * the build, and the person who flipped it would never connect the two.
 */
export class ArtifactController {
  protected readonly artifacts = $inject(ArtifactService);

  /**
   * Declared above the actions on purpose: a `use: [...]` entry reading
   * another field is a field initializer, so a gate declared below its first
   * use is `undefined` at construction time.
   */
  protected ownsProject = () => $ownsProject({ param: "projectId" });

  /**
   * Where the tarballs live.
   *
   * ## ⚠️ The ceiling, and what it is really bounding
   *
   * 20 MB. A packed Alepha app is a few megabytes gzipped - Cloudflare's own
   * Worker script limit is 10 MB compressed - so this is generous for the
   * thing it is for and deliberately not open-ended.
   *
   * It is not only a storage quota. `z.file()` materialises the part before
   * `$secure` runs, so this number is also how much an UNAUTHENTICATED request
   * can make a Worker isolate hold. That isolate has around 128 MB in total,
   * which is the reason this is 20 and not 200.
   *
   * The MIME list is the gzip family plus the catch-all every `curl -F` sends.
   * It is a usability guard rather than a security control - the type is
   * client-supplied - and the real check on the content is that the bytes have
   * to gunzip into a tar carrying a readable `dist/manifest.json`.
   */
  artifactBucket = $storage({
    name: ArtifactService.BUCKET,
    description: "Build artifacts pushed by CI",
    maxSize: 20,
    mimeTypes: [
      "application/gzip",
      "application/x-gzip",
      "application/x-compressed-tar",
      "application/octet-stream",
    ],
  });

  /**
   * Store a build under `(app, tag, runtime)`.
   *
   * ⚠️ **There is no `runtime` field, and there must never be one.** The
   * runtime is read from the artifact's own `dist/manifest.json`, because a
   * flag and a manifest eventually disagree and the manifest is the artifact's
   * own claim about itself. Two builds of `1.2.3` for different runtimes are
   * one release with two variants, not two releases.
   *
   * `latest` is the one tag that moves on its own; every other one is
   * write-once and needs `force`. See {@link ArtifactService.push}.
   */
  pushArtifact = $action({
    use: [$secure(), this.ownsProject()],
    method: "POST",
    path: "/projects/:projectId/artifacts",
    description: "Push a packed build into the project's artifact registry.",
    schema: {
      params: z.object({ projectId: z.integer() }),
      body: z.object({
        app: appNameSchema,
        tag: releaseTagSchema,
        /**
         * What CI built from, when it knows. Optional: a push from a laptop
         * has no commit to name, and an artifact is not a git object.
         */
        commitSha: z.string().max(40).optional(),
        /**
         * Move a pinned tag onto new bytes. For "tagged the wrong commit",
         * which happens; not for a pipeline that pushes the same version
         * twice, which is what `latest` is for.
         */
        force: z.boolean().optional(),
        file: z.file({ maxBytes: 20 * 1024 * 1024 }),
      }),
      response: artifactPushResultSchema,
    },
    handler: async ({ params, body }) => {
      const { artifact, stored } = await this.artifacts.push({
        projectId: params.projectId,
        app: body.app,
        tag: body.tag,
        commitSha: body.commitSha,
        force: body.force,
        file: body.file,
      });

      return { artifact: this.resource(artifact), stored };
    },
  });

  /**
   * What this project has built, newest first, with every runtime of a tag in
   * one entry.
   *
   * ⚠️ **Grouped, never flat.** `(app, tag, runtime)` is the unique key
   * precisely so `1.2.3` names one release that may carry two builds; a flat
   * list of rows contradicts that on the first screen anyone sees. Three
   * surfaces read this - the app page, the release page and MCP - and the
   * grouping is done once, here, rather than three times.
   *
   * Member-gated like every other project read, with no feature check of its
   * own. `features.sigils` hides the app page and `features.milestones` the
   * release page; the endpoint under both is the same one, and gating it a
   * third time would only mean a 404 in a place the router already handles.
   */
  listArtifacts = $action({
    use: [$secure(), this.ownsProject()],
    method: "GET",
    path: "/projects/:projectId/artifacts",
    description: "What this project has built, grouped by tag.",
    schema: {
      params: z.object({ projectId: z.integer() }),
      query: z.object({
        /**
         * Narrow to one app. The app page passes this; the release page does
         * not, because a release spans every app that tagged a build with it.
         */
        app: appNameSchema.optional(),
        /**
         * Narrow to one tag. This is the release page's whole query: the join
         * to a release is tag equality, with no join table and no foreign key.
         */
        tag: releaseTagSchema.optional(),
      }),
      response: artifactListSchema,
    },
    handler: async ({ params, query }) => {
      const listing = await this.artifacts.listGrouped({
        projectId: params.projectId,
        app: query.app,
        tag: query.tag,
      });

      return {
        groups: listing.groups.map((group) => ({
          app: group.app,
          tag: group.tag,
          pushedAt: group.pushedAt,
          commitSha: group.commitSha,
          variants: group.variants.map((variant) => this.resource(variant)),
        })),
        truncated: listing.truncated,
      };
    },
  });

  /**
   * The row, flattened to what the API returns. `fileId` deliberately stays
   * behind: it is how Lore stores the bytes, not how a caller addresses them.
   */
  protected resource(artifact: Artifact) {
    return {
      id: artifact.id,
      projectId: artifact.projectId,
      app: artifact.app,
      tag: artifact.tag,
      runtime: artifact.runtime,
      sha256: artifact.sha256,
      size: artifact.size,
      commitSha: artifact.commitSha,
      createdAt: artifact.createdAt,
      updatedAt: artifact.updatedAt,
    };
  }
}
