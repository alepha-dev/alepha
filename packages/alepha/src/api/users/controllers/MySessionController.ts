import { $inject, type Infer, z } from "alepha";
import { $secure } from "alepha/security";
import { $action, NotFoundError } from "alepha/server";

import { RealmProvider } from "../providers/RealmProvider.ts";

/**
 * A session as exposed to ITS OWNER — `refreshToken` is deliberately
 * omitted (returning it would let any XSS exfiltrate a long-lived
 * credential); `current` flags the session backing the calling request.
 */
export const mySessionSchema = z.object({
  id: z.uuid(),
  createdAt: z.datetime(),
  expiresAt: z.datetime(),
  lastUsedAt: z.datetime().optional(),
  ip: z.string().optional(),
  country: z.string().optional(),
  userAgent: z
    .object({
      os: z.string(),
      browser: z.string(),
      device: z.enum(["MOBILE", "DESKTOP", "TABLET"]),
    })
    .optional(),
  current: z.boolean(),
});

export type MySession = Infer<typeof mySessionSchema>;

/**
 * Self-service session management — the "where am I signed in?" page of an
 * account area. Counterpart of {@link AdminSessionController}, scoped to the
 * CALLER's own sessions: list them, revoke one (a stolen laptop), or revoke
 * everything except the current one.
 */
export class MySessionController {
  protected readonly realmProvider = $inject(RealmProvider);

  protected sessions(realm?: string) {
    return this.realmProvider.sessionRepository(realm);
  }

  protected toMySession(
    session: {
      id: string;
      createdAt: string;
      expiresAt: string;
      lastUsedAt?: string;
      ip?: string;
      country?: string;
      userAgent?: { os: string; browser: string; device: string };
    },
    currentSessionId: string | undefined,
  ): MySession {
    return {
      id: session.id,
      createdAt: session.createdAt,
      expiresAt: session.expiresAt,
      lastUsedAt: session.lastUsedAt,
      ip: session.ip,
      country: session.country,
      userAgent: session.userAgent as MySession["userAgent"],
      current: session.id === currentSessionId,
    };
  }

  listMySessions = $action({
    method: "GET",
    path: "/users/me/sessions",
    use: [$secure()],
    description: "List the caller's active sessions",
    schema: {
      response: z.array(mySessionSchema),
    },
    handler: async ({ user }) => {
      const rows = await this.sessions(user.realm).findMany({
        where: { userId: { eq: user.id } },
        orderBy: [{ column: "createdAt", direction: "desc" }],
      });
      return rows.map((s) => this.toMySession(s, user.sessionId));
    },
  });

  deleteMySession = $action({
    method: "DELETE",
    path: "/users/me/sessions/:id",
    use: [$secure()],
    description: "Revoke one of the caller's sessions",
    schema: {
      params: z.object({ id: z.uuid() }),
      response: z.object({ ok: z.boolean() }),
    },
    handler: async ({ params, user }) => {
      const repo = this.sessions(user.realm);
      // Owner-scoped lookup: someone else's session id reads as missing.
      const session = await repo.findOne({
        where: { id: { eq: params.id }, userId: { eq: user.id } },
      });
      if (!session) throw new NotFoundError("Session not found");
      await repo.deleteById(session.id);
      return { ok: true };
    },
  });

  deleteMyOtherSessions = $action({
    method: "POST",
    path: "/users/me/sessions/revoke-others",
    use: [$secure()],
    description: "Revoke every caller session except the current one",
    schema: {
      response: z.object({ revoked: z.integer() }),
    },
    handler: async ({ user }) => {
      const repo = this.sessions(user.realm);
      const rows = await repo.findMany({
        where: { userId: { eq: user.id } },
      });
      const others = rows.filter((s) => s.id !== user.sessionId);
      for (const s of others) {
        await repo.deleteById(s.id);
      }
      return { revoked: others.length };
    },
  });
}
