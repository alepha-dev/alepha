import { type Infer, z } from "alepha";
import { $action, NotFoundError } from "alepha/server";

export const userSchema = z.object({
  id: z.integer(),
  name: z.text(),
});

export type User = Infer<typeof userSchema>;

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
      headers: z.object({
        uppercase: z.boolean().optional(),
      }),
      params: z.object({
        id: z.integer(),
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
      query: z.object({
        name: z.text().optional(),
      }),
      response: z.array(userSchema),
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
      params: z.object({
        id: z.integer(),
      }),
      response: z.void(),
    },
    handler: async ({ params }) => {
      const user = await this.findById.run({ params });
      this.users = this.users.filter((u) => u.id !== user.id);
    },
  });

  update = $action({
    method: "PUT",
    path: "/users/:id",
    schema: {
      params: z.object({
        id: z.integer(),
      }),
      body: z.object({
        name: z.text(),
      }),
      response: userSchema,
    },
    handler: async ({ params, body }) => {
      const user = await this.findById.run({ params });
      user.name = body.name;
      this.users = this.users.map((u) => (u.id === user.id ? user : u));
      return user;
    },
  });

  create = $action({
    path: "/users",
    schema: {
      body: z.object({
        name: z.text(),
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
      response: z.void(),
    },
    handler: () => {
      throw new Error("Oops");
    },
  });
}
