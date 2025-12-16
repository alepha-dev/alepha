import { $inject, t } from "alepha";
import { pg } from "alepha/orm";
import { $action, okSchema } from "alepha/server";
import { sessionQuerySchema } from "../schemas/sessionQuerySchema.ts";
import { sessionResourceSchema } from "../schemas/sessionResourceSchema.ts";
import { SessionCrudService } from "../services/SessionCrudService.ts";

export class SessionController {
  protected readonly url = "/sessions";
  protected readonly group = "sessions";
  protected readonly sessionService = $inject(SessionCrudService);

  /**
   * Find sessions with pagination and filtering.
   */
  public readonly findSessions = $action({
    path: this.url,
    group: this.group,
    description: "Find sessions with pagination and filtering",
    schema: {
      query: t.extend(sessionQuerySchema, {
        userRealmName: t.optional(t.string()),
      }),
      response: pg.page(sessionResourceSchema),
    },
    handler: ({ query }) => {
      const { userRealmName, ...q } = query;
      return this.sessionService.findSessions(q, userRealmName);
    },
  });

  /**
   * Get a session by ID.
   */
  public readonly getSession = $action({
    path: `${this.url}/:id`,
    group: this.group,
    description: "Get a session by ID",
    schema: {
      params: t.object({
        id: t.uuid(),
      }),
      query: t.object({
        userRealmName: t.optional(t.string()),
      }),
      response: sessionResourceSchema,
    },
    handler: ({ params, query }) =>
      this.sessionService.getSessionById(params.id, query.userRealmName),
  });

  /**
   * Delete a session.
   */
  public readonly deleteSession = $action({
    method: "DELETE",
    path: `${this.url}/:id`,
    group: this.group,
    description: "Delete a session",
    schema: {
      params: t.object({
        id: t.uuid(),
      }),
      query: t.object({
        userRealmName: t.optional(t.string()),
      }),
      response: okSchema,
    },
    handler: async ({ params, query }) => {
      await this.sessionService.deleteSession(params.id, query.userRealmName);
      return { ok: true, id: params.id };
    },
  });
}
