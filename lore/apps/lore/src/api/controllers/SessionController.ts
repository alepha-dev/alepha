import { type Static, t } from "alepha";
import { oauthClientEntity } from "alepha/api/oauth";
import { sessions } from "alepha/api/users";
import { $repository } from "alepha/orm";
import { $secure } from "alepha/security";
import { $action } from "alepha/server";

export const userSession = t.extend(sessions.schema, {
  current: t.boolean(),
});

export type UserSession = Static<typeof userSession>;

/**
 * An OAuth "connection": a session that was minted for an OAuth client
 * (an MCP client such as Claude), with the client name resolved and the
 * refresh token deliberately omitted.
 */
export const oauthConnection = t.object({
  id: t.string(),
  clientId: t.string(),
  clientName: t.string(),
  createdAt: t.datetime(),
  lastUsedAt: t.optional(t.datetime()),
  expiresAt: t.datetime(),
  ip: t.optional(t.string()),
  userAgent: t.optional(
    t.object({
      os: t.string(),
      browser: t.string(),
      device: t.enum(["MOBILE", "DESKTOP", "TABLET"]),
    }),
  ),
  current: t.boolean(),
});

export type OAuthConnection = Static<typeof oauthConnection>;

export class SessionController {
  sessions = $repository(sessions);
  oauthClients = $repository(oauthClientEntity);

  /**
   * List the caller's OAuth "connected apps" — sessions tagged with an
   * OAuth client id, enriched with the client's display name. Revoke a
   * connection with `revokeSession` (a connection IS a session).
   */
  getMyConnections = $action({
    use: [$secure({ permissions: ["session:read"] })],
    schema: {
      response: t.array(oauthConnection),
    },
    handler: async ({ user }) => {
      const rows = await this.sessions.findMany({
        where: {
          userId: { eq: user.id },
          clientId: { isNotNull: true },
        },
      });
      if (rows.length === 0) {
        return [];
      }

      const clientIds = [
        ...new Set(
          rows
            .map((s) => s.clientId)
            .filter((id): id is string => typeof id === "string"),
        ),
      ];
      const clients = await this.oauthClients.findMany({
        where: { clientId: { inArray: clientIds } },
      });
      const nameByClientId = new Map(
        clients.map((c) => [c.clientId, c.clientName]),
      );

      return rows.map((s) => {
        const clientId = s.clientId as string;
        return {
          id: s.id,
          clientId,
          clientName: nameByClientId.get(clientId) ?? clientId,
          createdAt: s.createdAt,
          lastUsedAt: s.lastUsedAt,
          expiresAt: s.expiresAt,
          ip: s.ip,
          userAgent: s.userAgent,
          current: s.id === user.sessionId,
        };
      });
    },
  });

  getMySessions = $action({
    use: [$secure({ permissions: ["session:read"] })],
    schema: {
      response: t.array(userSession),
    },
    handler: async ({ user }) => {
      const userSessions = await this.sessions.findMany({
        where: {
          userId: { eq: user.id },
        },
      });

      return userSessions.map((session) => {
        return {
          ...session,
          current: session.id === user.sessionId,
        };
      });
    },
  });

  revokeSession = $action({
    use: [$secure({ permissions: ["session:delete"] })],
    schema: {
      params: t.object({
        sessionId: t.string(),
      }),
      response: t.void(),
    },
    handler: async ({ params, user }) => {
      const session = await this.sessions.getOne({
        where: {
          id: { eq: params.sessionId },
          userId: { eq: user.id },
        },
      });

      await this.sessions.deleteById(session.id);
    },
  });

  revokeAllSessions = $action({
    use: [$secure({ permissions: ["session:delete"] })],
    schema: {
      response: t.void(),
    },
    handler: async ({ user }) => {
      await this.sessions.deleteMany({
        userId: user.id,
      });
    },
  });
}
