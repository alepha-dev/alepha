import { $inject } from "alepha";
import { $tool } from "alepha/mcp";
import { NotFoundError } from "alepha/server";

import { ArtifactController } from "../../api/controllers/ArtifactController.ts";
import {
  artifactGetParamsSchema,
  artifactGetResultSchema,
  artifactListParamsSchema,
  artifactListResultSchema,
} from "../schemas/index.ts";
import { ProjectTools } from "./ProjectTools.ts";

/**
 * MCP tools for artifacts - what CI has built and kept.
 *
 * They answer two questions an agent otherwise needs a browser for: what has
 * this project shipped, and is the tag I am about to write down real. The
 * second matters more than it looks: a release and its builds are joined by
 * TAG EQUALITY, with no join table and no foreign key, so a typo does not fail
 * anywhere - it just produces a release that will never show a build, forever.
 *
 * ## ⚠️ Read-only, and there is no `artifact_push`
 *
 * Pushing is CI's job and the credential for it lives in CI. A tool that
 * uploaded a tarball out of an agent session would be a surface with no
 * caller, and one holding a project-wide credential at that. `lore artifacts
 * push` is the way in.
 *
 * ## ⚠️ Neither tool ever returns the body
 *
 * An MCP response is a token budget and an artifact is a multi-megabyte
 * tarball. These return metadata and a digest; the bytes come back through an
 * authenticated download, to a machine that is going to deploy them.
 */
export class ArtifactTools {
  protected readonly artifacts = $inject(ArtifactController);
  protected readonly projects = $inject(ProjectTools);

  artifact_list = $tool({
    title: "List artifacts",
    description:
      'What a project has built, newest push first, with every runtime of a tag folded into ONE entry - `1.2.3` names one release that may carry a node build and a workerd build, and they are variants rather than two releases. Narrow with `app` for one application, or with `tag` to answer "does a build for this release exist", which is the join a release page makes. `pushedAt` is when the bytes landed, not when the tag first appeared: `latest` is replaced in place, so its creation date would be misleading and is not what is returned. The tarball itself is never included.',
    annotations: { readOnlyHint: true, idempotentHint: true },
    schema: {
      params: artifactListParamsSchema,
      result: artifactListResultSchema,
    },
    handler: async ({ params }) => {
      const projectId = await this.projects.resolveProjectId(
        params.project,
        params.project_name,
      );

      const res = await this.artifacts.listArtifacts({
        params: { projectId },
        query: { app: params.app, tag: params.tag, limit: params.limit },
      });

      return { artifacts: res.groups, truncated: res.truncated };
    },
  });

  artifact_get = $tool({
    title: "Get an artifact",
    description:
      "One tag's builds: their runtimes, sizes, sha256 digests and the commit each was built from when CI named one. Reach for it to confirm a build exists before referencing its tag, or to read the digest a deploy should pin - a tag can be moved by whoever pushes next (`latest` always, any other tag under `--force`), and a digest cannot. `runtime` narrows to a single build; omit it for every variant, which is usually the useful answer. 404 when this project has no such tag for this app, which is a normal state rather than an error: an artifact with no release and a release with no artifact are both ordinary.",
    annotations: { readOnlyHint: true, idempotentHint: true },
    schema: {
      params: artifactGetParamsSchema,
      result: artifactGetResultSchema,
    },
    handler: async ({ params }) => {
      const projectId = await this.projects.resolveProjectId(
        params.project,
        params.project_name,
      );

      // The listing already groups, so `get` is a narrowed list rather than a
      // second read shape. One endpoint, one grouping, one place it can be
      // wrong.
      const res = await this.artifacts.listArtifacts({
        params: { projectId },
        query: { app: params.app, tag: params.tag },
      });

      const [group] = res.groups;
      if (!group) {
        throw new NotFoundError(
          `No artifact tagged "${params.tag}" for app "${params.app}" in this project.`,
        );
      }

      if (!params.runtime) {
        return { artifact: group };
      }

      const variants = group.variants.filter(
        (variant) => variant.runtime === params.runtime,
      );
      if (variants.length === 0) {
        // Naming what DOES exist, because the answer to "1.2.3 has no workerd
        // build" is almost always "it was built for something else", and a
        // bare 404 makes that a second round trip.
        throw new NotFoundError(
          `"${params.tag}" has no ${params.runtime} build of "${params.app}". It has: ${group.variants
            .map((variant) => variant.runtime)
            .join(", ")}.`,
        );
      }

      return { artifact: { ...group, variants } };
    },
  });
}
