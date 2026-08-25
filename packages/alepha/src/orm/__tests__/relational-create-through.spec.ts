import { Alepha, z } from "alepha";
import { describe, expect, it } from "vitest";

import { $entity, $relations, $repository, db } from "../core/index.ts";
import { AlephaOrmPostgres } from "../postgres/index.ts";

const users = $entity({
  name: "test_m2m_users",
  schema: z.object({
    id: db.primaryKey(z.integer(), {}, { mode: "byDefault" }),
    name: z.text(),
  }),
});

const groups = $entity({
  name: "test_m2m_groups",
  schema: z.object({
    id: db.primaryKey(z.integer(), {}, { mode: "byDefault" }),
    label: z.text(),
  }),
});

const usersToGroups = $entity({
  name: "test_m2m_users_groups",
  schema: z.object({
    id: db.primaryKey(z.integer(), {}, { mode: "byDefault" }),
    userId: db.ref(z.integer(), () => users.cols.id),
    groupId: db.ref(z.integer(), () => groups.cols.id),
  }),
});

const relations = $relations({ users, groups, usersToGroups }, (r) => ({
  users: {
    groups: r.many.groups({
      from: r.users.id.through(r.usersToGroups.userId),
      to: r.groups.id.through(r.usersToGroups.groupId),
    }),
  },
}));

class App {
  users = $repository(relations, "users");
  groups = $repository(relations, "groups");
  links = $repository(usersToGroups);
}

const boot = async (alepha: Alepha) => {
  const app = alepha.inject(App);
  await alepha.start();
  return app;
};

const sqlite = () =>
  Alepha.create({ env: { DATABASE_URL: "sqlite://:memory:" } });
const postgres = () => Alepha.create().with(AlephaOrmPostgres);

/**
 * A nested create through a junction table.
 *
 * `createDeep` used to ignore `relation.through` entirely and take the
 * one-to-many branch: it stamped the child's `relation.to` column — which for
 * a many-to-many is the child's own PRIMARY KEY — with the parent's id, and
 * wrote no junction row. The graph came out wrong, with nothing raised.
 */
const testCreateThroughJunction = async (alepha: Alepha) => {
  const app = await boot(alepha);

  const user = await app.users.create({
    data: { name: "ann", groups: { create: [{ label: "admins" }] } },
  });

  const created = await app.groups.findMany({ where: { label: "admins" } });
  expect(created).toHaveLength(1);

  // The child owns its own key. The old code assigned it the parent's.
  const group = created[0];
  expect(group.label).toBe("admins");

  const links = await app.links.findMany();
  expect(links).toHaveLength(1);
  expect(links[0].userId).toBe(user.id);
  expect(links[0].groupId).toBe(group.id);

  // And the link is what a read actually follows.
  const [read] = await app.users.findMany({
    where: { id: { eq: user.id } },
    include: { groups: true },
  });
  expect(read.groups?.map((g: any) => g.label)).toEqual(["admins"]);
};

const testCreateManyThroughJunction = async (alepha: Alepha) => {
  const app = await boot(alepha);

  const user = await app.users.create({
    data: {
      name: "bob",
      groups: { create: [{ label: "a" }, { label: "b" }] },
    },
  });

  const links = await app.links.findMany();
  expect(links).toHaveLength(2);
  expect(links.every((l) => l.userId === user.id)).toBe(true);
  expect(new Set(links.map((l) => l.groupId)).size).toBe(2);
};

describe("nested create through a many-to-many", () => {
  it("links the child through the junction (sqlite)", async () => {
    await testCreateThroughJunction(sqlite());
  });

  it("links the child through the junction (postgres)", async () => {
    await testCreateThroughJunction(postgres());
  });

  it("links every child of a batch (sqlite)", async () => {
    await testCreateManyThroughJunction(sqlite());
  });

  it("links every child of a batch (postgres)", async () => {
    await testCreateManyThroughJunction(postgres());
  });
});
