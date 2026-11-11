import { $inject, z } from "alepha";
import { $secure } from "alepha/security";
import { $action } from "alepha/server";

import { userDockSchema } from "../schemas/userDockSchema.ts";
import { UserDockService } from "../services/UserDockService.ts";

/**
 * The caller's own dock of pinned projects (#E139, #Q3434).
 *
 * Behind a bare `$secure()`, like the notification preferences: no user id
 * travels in any path here, so the session decides the row. The writes refuse
 * a machine credential (`sessionOnly`), as every non-GET under `/users/me`
 * does: a pin is a person's preference, not an agent's.
 *
 * Every action answers the dock as it now stands, so the client sets its atom
 * from the response rather than refetching.
 */
export class UserDockController {
  protected readonly dock = $inject(UserDockService);

  getMyDock = $action({
    method: "GET",
    path: "/users/me/dock",
    use: [$secure()],
    description: "Read the caller's dock of pinned projects",
    schema: {
      response: userDockSchema,
    },
    handler: async ({ user }) => ({
      projectIds: await this.dock.read(user.id),
    }),
  });

  /**
   * Pin at the end of the dock. Refused with `DOCK_FULL` (409) when the dock
   * already holds the cap.
   */
  pinProject = $action({
    method: "POST",
    path: "/users/me/dock/:projectId",
    use: [$secure({ sessionOnly: true })],
    description: "Pin a project at the end of the caller's dock",
    schema: {
      params: z.object({ projectId: z.integer() }),
      response: userDockSchema,
    },
    handler: async ({ params, user }) => {
      await this.dock.pin(user.id, params.projectId, { strict: true });
      return { projectIds: await this.dock.read(user.id) };
    },
  });

  unpinProject = $action({
    method: "DELETE",
    path: "/users/me/dock/:projectId",
    use: [$secure({ sessionOnly: true })],
    description: "Take a project off the caller's dock",
    schema: {
      params: z.object({ projectId: z.integer() }),
      response: userDockSchema,
    },
    handler: async ({ params, user }) => {
      await this.dock.unpin(user.id, params.projectId);
      return { projectIds: await this.dock.read(user.id) };
    },
  });

  /**
   * Replace the order with the full ordered list of pinned ids.
   */
  reorderDock = $action({
    method: "PUT",
    path: "/users/me/dock",
    use: [$secure({ sessionOnly: true })],
    description: "Reorder the caller's dock",
    schema: {
      body: userDockSchema,
      response: userDockSchema,
    },
    handler: async ({ body, user }) => ({
      projectIds: await this.dock.reorder(user.id, body.projectIds),
    }),
  });
}
