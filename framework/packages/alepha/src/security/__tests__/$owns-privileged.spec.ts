import { Alepha, z } from "alepha";
import { $entity, $repository, db } from "alepha/orm";
import { $action, ForbiddenError } from "alepha/server";
import { describe, it } from "vitest";

import { AlephaSecurity } from "../index.ts";
import type { UserAccountToken } from "../interfaces/UserAccountToken.ts";
import { $owns } from "../primitives/$owns.ts";
import { $role } from "../primitives/$role.ts";

const projects = $entity({
  name: "priv_projects",
  schema: z.object({
    id: db.primaryKey(z.text()),
    createdBy: z.text(),
    title: z.text(),
  }),
});

const members = $entity({
  name: "priv_members",
  schema: z.object({
    id: db.primaryKey(z.text()),
    projectId: z.text(),
    userId: z.text(),
  }),
});

/**
 * `admin` holds `*` unrestricted, which a permission check answers with
 * `ownership: false`: the role-derived privilege `privileged: "identity"`
 * stops honouring. `member` is an ordinary signed-in user.
 */
class Roles {
  admin = $role({ name: "admin", permissions: [{ name: "*" }] });
  member = $role({
    name: "member",
    permissions: [{ name: "*", ownership: true }],
  });
}

const createApp = () => {
  const alepha = Alepha.create({
    env: { DATABASE_URL: "sqlite://:memory:" },
  }).with(AlephaSecurity);

  class App {
    projects = $repository(projects);
    members = $repository(members);

    protected gate(privileged?: "any" | "identity") {
      return $owns({
        repository: () => this.projects,
        param: "id",
        owner: "createdBy",
        requires: "project:read",
        privileged,
        via: {
          repository: () => this.members,
          resource: "projectId",
          user: "userId",
        },
      });
    }

    readAny = this.read("/readAny/:id", this.gate());
    readIdentity = this.read("/readIdentity/:id", this.gate("identity"));

    /**
     * What the handler is handed: the decision a rank check further on
     * would read.
     */
    whoIdentity = $action({
      method: "GET",
      path: "/whoIdentity/:id",
      schema: {
        params: z.object({ id: z.text() }),
        response: z.text(),
      },
      use: [this.gate("identity")],
      handler: ({ user }) => String(user?.ownership),
    });

    protected read(path: string, gate: ReturnType<typeof $owns>) {
      return $action({
        method: "GET",
        path,
        schema: {
          params: z.object({ id: z.text() }),
          response: z.text(),
        },
        use: [gate],
        handler: ({ params }) => params.id,
      });
    }
  }

  alepha.inject(Roles);
  return { alepha, app: alepha.inject(App) };
};

const admin: UserAccountToken = {
  id: "admin-1",
  realm: "default",
  roles: ["admin"],
};

/**
 * An identity BUILT unrestricted, the way a system user is.
 */
const system: UserAccountToken = {
  id: "system",
  realm: "default",
  roles: ["admin"],
  ownership: false,
};

const seed = async (app: { projects: any }) => {
  await app.projects.create({ id: "p1", createdBy: "u1", title: "Alpha" });
};

describe("$owns privileged", () => {
  it("lets an admin role through by default", async ({ expect }) => {
    const { alepha, app } = createApp();
    await alepha.start();
    await seed(app);

    expect(
      await app.readAny.run({ params: { id: "p1" } }, { user: admin }),
    ).toBe("p1");
  });

  it("refuses an admin role that is not a member with privileged: identity", async ({
    expect,
  }) => {
    const { alepha, app } = createApp();
    await alepha.start();
    await seed(app);

    await expect(
      app.readIdentity.run({ params: { id: "p1" } }, { user: admin }),
    ).rejects.toThrow(ForbiddenError);
  });

  it("lets the same admin through once it is a member", async ({ expect }) => {
    const { alepha, app } = createApp();
    await alepha.start();
    await seed(app);
    await app.members.create({ id: "m1", projectId: "p1", userId: admin.id });

    expect(
      await app.readIdentity.run({ params: { id: "p1" } }, { user: admin }),
    ).toBe("p1");
  });

  it("hands the handler no unrestricted decision for a role, and keeps the system user's", async ({
    expect,
  }) => {
    const { alepha, app } = createApp();
    await alepha.start();
    await seed(app);
    await app.members.create({ id: "m1", projectId: "p1", userId: admin.id });

    expect(
      await app.whoIdentity.run({ params: { id: "p1" } }, { user: admin }),
    ).not.toBe("false");
    expect(
      await app.whoIdentity.run({ params: { id: "p1" } }, { user: system }),
    ).toBe("false");
  });

  it("still lets an identity built with ownership: false through", async ({
    expect,
  }) => {
    const { alepha, app } = createApp();
    await alepha.start();
    await seed(app);

    expect(
      await app.readIdentity.run({ params: { id: "p1" } }, { user: system }),
    ).toBe("p1");
  });
});
