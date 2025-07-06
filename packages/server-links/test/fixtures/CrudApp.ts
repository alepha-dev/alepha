import { type Static, t } from "@alepha/core";
import { $action, NotFoundError } from "@alepha/server";

export const userSchema = t.object({
	id: t.int(),
	name: t.string(),
});

export type User = Static<typeof userSchema>;

export class CrudApp {
	seq = 1;
	users: User[] = [];

	clear() {
		this.seq = 1;
		this.users = [];
	}

	findById = $action({
		path: "/users/:id",
		schema: {
			headers: t.object({
				uppercase: t.optional(t.boolean()),
			}),
			params: t.object({
				id: t.int(),
			}),
			response: userSchema,
		},
		handler: ({ params, headers }) => {
			const user = this.users.find((u) => u.id === params.id);
			if (!user) {
				throw new NotFoundError("User not found");
			}
			if (headers.uppercase) {
				user.name = user.name.toUpperCase();
			}
			return user;
		},
	});

	findAll = $action({
		path: "/users",
		schema: {
			query: t.object({
				name: t.optional(t.string()),
			}),
			response: t.array(userSchema),
		},
		handler: ({ query }) => {
			const name = query.name;
			if (name) {
				return this.users.filter((u) => u.name.includes(name));
			}
			return this.users;
		},
	});

	delete = $action({
		method: "DELETE",
		path: "/users/:id",
		schema: {
			params: t.object({
				id: t.int(),
			}),
			response: t.void(),
		},
		handler: async ({ params }) => {
			const user = await this.findById({ params });
			this.users = this.users.filter((u) => u.id !== user.id);
		},
	});

	update = $action({
		method: "PUT",
		path: "/users/:id",
		schema: {
			params: t.object({
				id: t.int(),
			}),
			body: t.object({
				name: t.string(),
			}),
			response: userSchema,
		},
		handler: async ({ params, body }) => {
			const user = await this.findById({ params });
			user.name = body.name;
			this.users = this.users.map((u) => (u.id === user.id ? user : u));
			return user;
		},
	});

	create = $action({
		path: "/users",
		schema: {
			body: t.object({
				name: t.string(),
			}),
			response: userSchema,
		},
		handler: ({ body }) => {
			const id = this.seq++;
			const user = {
				id,
				name: body.name,
			};
			this.users.push(user);
			return user;
		},
	});

	internalError = $action({
		schema: {
			response: t.void(),
		},
		handler: () => {
			throw new Error("Oops");
		},
	});
}
