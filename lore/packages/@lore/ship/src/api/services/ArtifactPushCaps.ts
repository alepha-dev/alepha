import { $hook, $inject } from "alepha";
import type { ServerRoute } from "alepha/server";
import {
  type MultipartCap,
  MultipartCapProvider,
} from "alepha/server/multipart";

/**
 * How many parts an artifact push may carry (#E154).
 *
 * The framework's default is 10 parts per message, fields included. A push
 * from a current CLI sends `app`, `tag`, `commitSha`, `force`, `manifest`,
 * `quests` and `dirty` as fields, then `file`, `assets`, `schema` and
 * `commits`: eleven, so a push carrying its quests was refused with a 413
 * "Too many files" before the gate ran.
 *
 * ⚠️ Only the part count, and only for this route: the byte budget stays
 * the one its `z.file({ maxBytes })` fields declare. Keyed on the route, never
 * on anything the caller sends (`MultipartCapProvider` says why).
 */
export class ArtifactPushCaps {
  protected readonly caps = $inject(MultipartCapProvider);

  /**
   * Every part `ArtifactController.pushArtifact` declares (13 today) with
   * room for a few more: a part the route does not declare is walked past.
   */
  public static readonly MAX_PARTS = 20;

  protected readonly register = $hook({
    on: "configure",
    handler: () => {
      this.caps.use((_request, route) => this.resolve(route));
    },
  });

  public resolve(route: ServerRoute): MultipartCap | undefined {
    return route.method === "POST" &&
      route.path.endsWith("/projects/:projectId/artifacts")
      ? { maxParts: ArtifactPushCaps.MAX_PARTS }
      : undefined;
  }
}
