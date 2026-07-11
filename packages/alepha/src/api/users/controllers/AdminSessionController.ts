import { $inject, z } from "alepha";
import { $secure, SecurityProvider } from "alepha/security";
import { $action, okSchema } from "alepha/server";
import { sessionQuerySchema } from "../schemas/sessionQuerySchema.ts";
import { sessionResourceSchema } from "../schemas/sessionResourceSchema.ts";
import { SessionCrudService } from "../services/SessionCrudService.ts";

export class AdminSessionController {
  protected readonly url = "/sessions";
  protected readonly group = "admin:sessions";
  protected readonly sessionService = $inject(SessionCrudService);
  protected readonly securityProvider = $inject(SecurityProvider);

  /**
   * Find sessions with pagination and filtering.
   */
  public readonly findSessions = $action({
    path: this.url,
    group: this.group,
    use: [$secure({ permissions: ["admin:session:read"] })],
    description: "Find sessions with pagination and filtering",
    schema: {
      query: sessionQuerySchema.extend({
        userRealmName: z.string().optional(),
      }),
      response: z.page(sessionResourceSchema),
    },
    handler: ({ query, user }) => {
      const { userRealmName, ...q } = query;
      return this.sessionService.findSessions(
        q,
        this.securityProvider.assertRealmScope(user, userRealmName),
      );
    },
  });

  /**
   * Get a session by ID.
   */
  public readonly getSession = $action({
    path: `${this.url}/:id`,
    group: this.group,
    use: [$secure({ permissions: ["admin:session:read"] })],
    description: "Get a session by ID",
    schema: {
      params: z.object({
        id: z.uuid(),
      }),
      query: z.object({
        userRealmName: z.string().optional(),
      }),
      response: sessionResourceSchema,
    },
    handler: ({ params, query, user }) =>
      this.sessionService.getSessionById(
        params.id,
        this.securityProvider.assertRealmScope(user, query.userRealmName),
      ),
  });

  /**
   * Delete a session.
   */
  public readonly deleteSession = $action({
    method: "DELETE",
    path: `${this.url}/:id`,
    group: this.group,
    use: [$secure({ permissions: ["admin:session:delete"] })],
    description: "Delete a session",
    schema: {
      params: z.object({
        id: z.uuid(),
      }),
      query: z.object({
        userRealmName: z.string().optional(),
      }),
      response: okSchema,
    },
    handler: async ({ params, query, user }) => {
      await this.sessionService.deleteSession(
        params.id,
        this.securityProvider.assertRealmScope(user, query.userRealmName),
      );
      return { ok: true, id: params.id };
    },
  });

  /**
   * Delete many sessions in one repository call.
   */
  public readonly deleteSessions = $action({
    method: "POST",
    path: `${this.url}/delete`,
    group: this.group,
    use: [$secure({ permissions: ["admin:session:delete"] })],
    description: "Delete many sessions",
    schema: {
      query: z.object({
        userRealmName: z.string().optional(),
      }),
      body: z.object({
        ids: z.array(z.uuid()).min(1).max(1000),
      }),
      response: z.object({
        deleted: z.array(z.string()),
      }),
    },
    handler: async ({ body, query, user }) => {
      const deleted = await this.sessionService.deleteSessions(
        body.ids,
        this.securityProvider.assertRealmScope(user, query.userRealmName),
      );
      return { deleted };
    },
  });
}
