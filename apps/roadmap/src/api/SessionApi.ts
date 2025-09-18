import { $inject, type Static, t } from "@alepha/core";
import { DateTimeProvider } from "@alepha/datetime";
import { $action, $route } from "@alepha/server";
import { Db, sessions } from "../providers/Db.ts";

export const userSession = t.interface([sessions.$schema], {
	current: t.boolean(),
});

export type UserSession = Static<typeof userSession>;

export class SessionApi {
	db = $inject(Db);
	dt = $inject(DateTimeProvider);

	cleanup = $route({
		path: "/session/cleanup",
		schema: {
			response: t.string(),
		},
		handler: async () => {
			await this.db.sessions.deleteMany({
				expiresAt: { lt: this.dt.nowISOString() },
			});

			return "OK";
		},
	});

	getMySessions = $action({
		schema: {
			response: t.array(userSession),
		},
		handler: async ({ user }) => {
			const sessions = await this.db.sessions.find({
				where: {
					userId: user.id,
				},
			});

			return sessions.map((session) => {
				return {
					...session,
					current: session.id === user.sessionId,
				};
			});
		},
	});

	revokeSession = $action({
		schema: {
			params: t.object({
				sessionId: t.string(),
			}),
			response: t.void(),
		},
		handler: async ({ params, user }) => {
			const session = await this.db.sessions.findOne({
				id: params.sessionId,
				userId: user.id,
			});

			await this.db.sessions.deleteById(session.id);
		},
	});

	revokeAllSessions = $action({
		schema: {
			response: t.void(),
		},
		handler: async ({ user }) => {
			await this.db.sessions.deleteMany({
				userId: user.id,
			});
		},
	});
}
