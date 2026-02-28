import { type Static, t } from "alepha";
import { sessions } from "alepha/api/users";
import { $repository } from "alepha/orm";
import { $secure } from "alepha/security";
import { $action } from "alepha/server";

export const userSession = t.extend(sessions.schema, {
  current: t.boolean(),
});

export type UserSession = Static<typeof userSession>;

export class SessionController {
  sessions = $repository(sessions);

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
