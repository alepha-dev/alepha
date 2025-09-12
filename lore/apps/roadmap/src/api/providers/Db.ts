import { $inject, type Static, t } from "@alepha/core";
import { $entity, $repository, PostgresProvider, pg } from "@alepha/postgres";

export const projects = $entity({
	name: "projects",
	schema: t.object({
		id: pg.primaryKey(t.int()),
		createdAt: pg.createdAt(),
		updatedAt: pg.updatedAt(),
		deletedAt: pg.deletedAt(),
		title: t.string({
			minLength: 3,
			maxLength: 24,
		}),
		createdBy: t.uuid(),
		public: t.optional(t.boolean()),
		packages: pg.default(t.array(t.string()), []),
	}),
});

export const users = $entity({
	name: "users",
	schema: t.object({
		id: pg.primaryKey(t.uuid()),
		createdAt: pg.createdAt(),
		updatedAt: pg.updatedAt(),
		email: t.string({ format: "email" }),
		roles: t.array(t.string(), { default: ["user"] }),
		name: t.optional(t.string()),
		picture: t.optional(t.string()),
	}),
});

export const identities = $entity({
	name: "identities",
	schema: t.object({
		id: pg.primaryKey(t.uuid()),
		userId: pg.ref(t.uuid(), () => users.id),
		createdAt: pg.createdAt(),
		updatedAt: pg.updatedAt(),
		provider: t.string(),
		providerUserId: t.string(),
		providerData: t.optional(t.json()),
	}),
	indexes: [
		{
			columns: ["providerUserId", "provider"],
			unique: true,
		},
	],
});

export const sessions = $entity({
	name: "sessions",
	schema: t.object({
		id: pg.primaryKey(t.uuid()),
		refreshToken: t.uuid(),
		createdAt: pg.createdAt(),
		updatedAt: pg.updatedAt(),
		userId: pg.ref(t.uuid(), () => users.id, {
			onDelete: "cascade",
		}),
		expiresAt: t.datetime(),
		ip: t.optional(t.string()),
		userAgent: t.optional(
			t.object({
				os: t.string(),
				browser: t.string(),
				device: t.enum(["Mobile", "Desktop", "Tablet"]),
			}),
		),
	}),
	indexes: ["refreshToken"],
});

export const tasks = $entity({
	name: "tasks",
	schema: t.object({
		id: pg.primaryKey(t.int()),
		createdAt: pg.createdAt(),
		updatedAt: pg.updatedAt(),
		deletedAt: pg.deletedAt(),
		title: t.string(),
		description: t.string({ size: "rich" }),
		package: t.string(),
		priority: t.enum(["optional", "low", "medium", "high"]),
		complexity: t.int({ minimum: 1, maximum: 5 }),
		acceptedAt: t.optional(t.datetime()),
		completedAt: t.optional(t.datetime()),
		objectives: pg.default(
			t.array(
				t.object({
					title: t.string(),
					completed: t.boolean(),
				}),
			),
			[],
		),
		projectId: pg.ref(t.int(), () => projects.id, {
			onDelete: "cascade",
		}),
		createdBy: pg.ref(t.uuid(), () => users.id, {
			onDelete: "cascade",
		}),
		assignedTo: pg.ref(t.optional(t.uuid()), () => users.id, {
			onDelete: "set null",
		}),
		acceptedBy: pg.ref(t.optional(t.uuid()), () => users.id, {
			onDelete: "set null",
		}),
		completedBy: pg.ref(t.optional(t.uuid()), () => users.id, {
			onDelete: "set null",
		}),
		history: t.array(
			t.object({
				at: t.datetime(),
				by: t.uuid(),
				action: t.enum([
					"updated",
					"assigned",
					"unassigned",
					"objective_completed",
				]),
			}),
			{ default: [] },
		),
	}),
	indexes: [
		{
			columns: ["projectId", "deletedAt"],
		},
	],
});

export const characters = $entity({
	name: "characters",
	schema: t.object({
		id: pg.primaryKey(t.int()),
		createdAt: pg.createdAt(),
		updatedAt: pg.updatedAt(),
		userId: pg.ref(t.uuid(), () => users.id, {
			onDelete: "cascade",
		}),
		projectId: pg.ref(t.int(), () => projects.id, {
			onDelete: "cascade",
		}),
		xp: t.int(),
		balance: pg.default(t.int(), 0),
		owner: pg.default(t.boolean(), true),
	}),
});

export const invitations = $entity({
	name: "invitations",
	schema: t.object({
		id: pg.primaryKey(t.uuid()),
		createdAt: pg.createdAt(),
		updatedAt: pg.updatedAt(),
		projectId: pg.ref(t.int(), () => projects.id, {
			onDelete: "cascade",
		}),
		invitedBy: pg.ref(t.uuid(), () => users.id, {
			onDelete: "cascade",
		}),
		invitedEmail: t.string({ format: "email" }),
		status: t.enum(["pending", "accepted", "rejected"], { default: "pending" }),
	}),
	indexes: [
		{
			columns: ["projectId", "invitedEmail"],
			unique: true,
		},
	],
});

export type Character = Static<typeof characters.$schema>;
export type User = Static<typeof users.$schema>;
export type Task = Static<typeof tasks.$schema>;
export type TaskUpdate = Static<typeof tasks.$updateSchema>;
export type Project = Static<typeof projects.$schema>;
export type TaskInsert = Static<typeof tasks.$insertSchema>;
export type Session = Static<typeof sessions.$schema>;
export type Invitation = Static<typeof invitations.$schema>;

export class Db {
	tasks = $repository(tasks);
	users = $repository(users);
	projects = $repository(projects);
	identities = $repository(identities);
	sessions = $repository(sessions);
	characters = $repository(characters);
	invitations = $repository(invitations);

	provider = $inject(PostgresProvider);
	query = this.provider.execute.bind(this.provider);
}
