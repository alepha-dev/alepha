import { $inject, type Static, t } from "alepha";
import { sessions } from "alepha/api/users";
import { DateTimeProvider } from "alepha/datetime";
import { $repository } from "alepha/orm";
import { $action, $route } from "alepha/server";

export const userSession = t.extend(sessions.schema, {
  current: t.boolean(),
});

export type UserSession = Static<typeof userSession>;

export class SessionController {
  sessions = $repository(sessions);
  dt = $inject(DateTimeProvider);

  cleanup = $route({
    path: "/session/cleanup",
    schema: {
      response: t.string(),
    },
    handler: async () => {
      await this.sessions.deleteMany({
        expiresAt: { lt: this.dt.nowISOString() },
      });

      return "OK";
    },
  });

  getMySessions = $action({
    secure: true,
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
    secure: true,
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
    secure: true,
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
