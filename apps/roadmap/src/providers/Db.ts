import { $hook, type Static, t } from "@alepha/core";
import { $entity, $repository, pg } from "@alepha/postgres";

export const projects = $entity({
	name: "projects",
	schema: t.object({
		id: pg.primaryKey(t.int()),
		createdAt: pg.createdAt(),
		updatedAt: pg.updatedAt(),
		title: t.string(),
		createdBy: t.uuid(),
		public: t.optional(t.boolean()),
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
		createdAt: pg.createdAt(),
		updatedAt: pg.updatedAt(),
		userId: pg.ref(t.uuid(), () => users.id, {
			onDelete: "cascade",
		}),
		expiresAt: t.datetime(),
	}),
});

export const tasks = $entity({
	name: "tasks",
	schema: t.object({
		id: pg.primaryKey(t.int()),
		createdAt: pg.createdAt(),
		updatedAt: pg.updatedAt(),

		title: t.string(),
		description: t.string({ size: "rich" }),

		package: t.string(),
		priority: t.enum(["optional", "low", "medium", "high"]),
		complexity: t.int({ minimum: 1, maximum: 5 }),
		completedAt: t.optional(t.datetime()),
		projectId: pg.ref(t.int(), () => projects.id, {
			onDelete: "cascade",
		}),
		createdBy: pg.ref(t.uuid(), () => users.id, {
			onDelete: "cascade",
		}),
		assignedTo: pg.ref(t.optional(t.uuid()), () => users.id, {
			onDelete: "set null",
		}),
		completedBy: pg.ref(t.optional(t.uuid()), () => users.id, {
			onDelete: "set null",
		}),
	}),
});

export type Task = Static<typeof tasks.$schema>;
export type Project = Static<typeof projects.$schema>;
export type TaskInsert = Static<typeof tasks.$insertSchema>;

export class Db {
	tasks = $repository(tasks);
	users = $repository(users);
	projects = $repository(projects);
	identities = $repository(identities);
	sessions = $repository(sessions);

	ready = $hook({
		on: "ready",
		handler: async () => {},
	});
}
