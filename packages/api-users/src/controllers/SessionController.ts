import { $inject, t } from "@alepha/core";
import { pg } from "@alepha/postgres";
import { $action, okSchema } from "@alepha/server";
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
      query: sessionQuerySchema,
      response: pg.page(sessionResourceSchema),
    },
    handler: ({ query }) => this.sessionService.findSessions(query),
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
      response: sessionResourceSchema,
    },
    handler: ({ params }) => this.sessionService.getSessionById(params.id),
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
      response: okSchema,
    },
    handler: async ({ params }) => {
      await this.sessionService.deleteSession(params.id);
      return { ok: true, id: params.id };
    },
  });
}
