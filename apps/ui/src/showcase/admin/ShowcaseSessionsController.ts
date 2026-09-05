import { $inject, z } from "alepha";
import { sessionQuerySchema, sessionResourceSchema } from "alepha/api/users";
import { $action } from "alepha/server";

import { ShowcaseSessions } from "./ShowcaseSessions.ts";

/**
 * Stands in for `AdminSessionController` so `<AdminSessions />` renders.
 *
 * ⚠️ Property names ARE action names and must match the real controller.
 *
 * Revoking accepts the call and changes nothing: the showcase is one shared
 * page, so a real revoke would let a visitor empty the table for everyone
 * after them.
 */
export class ShowcaseSessionsController {
  protected readonly sessions = $inject(ShowcaseSessions);

  public readonly findSessions = $action({
    path: "/admin/sessions",
    schema: {
      query: sessionQuerySchema.extend({
        userRealmName: z.string().optional(),
      }),
      response: z.page(sessionResourceSchema),
    },
    handler: ({ query }) => this.sessions.paginate(query as any),
  });

  /**
   * Feeds the country filter. Declared even though the component may not call
   * it directly, because the real controller has it and an absent action shows
   * up as an empty dropdown rather than an error.
   */
  public readonly getSessionCountries = $action({
    path: "/admin/sessions/countries",
    schema: {
      query: z.object({ userRealmName: z.string().optional() }),
      response: z.array(z.text()),
    },
    handler: () => this.sessions.countries(),
  });

  public readonly deleteSession = $action({
    method: "DELETE",
    path: "/admin/sessions/:id",
    schema: {
      params: z.object({ id: z.text() }),
      query: z.object({ userRealmName: z.string().optional() }),
      response: z.object({ ok: z.boolean() }),
    },
    handler: () => ({ ok: true }),
  });

  public readonly deleteSessions = $action({
    method: "DELETE",
    path: "/admin/sessions",
    schema: {
      query: z.object({ userRealmName: z.string().optional() }),
      body: z.object({ ids: z.array(z.text()) }),
      response: z.object({ deleted: z.integer() }),
    },
    handler: ({ body }) => ({ deleted: body.ids.length }),
  });
}
