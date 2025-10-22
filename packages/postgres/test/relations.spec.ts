import { Alepha, t } from "@alepha/core";
import { sql } from "drizzle-orm";
import { describe, test } from "vitest";
import { $entity, $repository, pg } from "../src";

describe("Relations", () => {
  const users = $entity({
    name: "users",
    schema: t.object({
      id: pg.primaryKey(),
      name: t.text(),
      parentId: pg.ref(t.optional(t.int()), () => users.id),
    }),
  });

  const profiles = $entity({
    name: "profiles",
    schema: t.object({
      id: pg.primaryKey(),
      userId: pg.ref(t.int(), () => users.id),
      bio: t.text(),
    }),
  });

  const posts = $entity({
    name: "posts",
    schema: t.object({
      id: pg.primaryKey(),
      authorId: pg.ref(t.int(), () => users.id),
      title: t.text(),
      content: t.text(),
    }),
  });

  test("one-to-one relation - user has one profile", async () => {
    class App {
      users = $repository(users);
      profiles = $repository(profiles);
    }

    const alepha = Alepha.create();
    const app = alepha.inject(App);
    await alepha.start();

    const bob = await app.users.create({ name: "Bob" });
    const alice = await app.users.create({ name: "Alice", parentId: bob.id });
    await app.profiles.create({ userId: alice.id, bio: "Hello, I'm Alice!" });
    await app.profiles.create({ userId: bob.id, bio: "Hey, I'm Bob!" });

    try {
      const parent = users.alias("parent");
      const owner = users.alias("owner");
      const parent_profile = profiles.alias("parent_profile");

      const userWithRelations = t.interface([users.$schema], {
        profile: profiles.$schema,
        parent: t.optional(users.$schema),
      });

      const item = await app.users.one({
        with: {
          profile: {
            join: profiles,
            on: ["id", profiles.userId],
          },
          parent: {
            join: parent,
            on: ["parentId", parent.id],
            with: {
              profile: {
                join: parent_profile,
                on: sql`${parent.id} = ${parent_profile.userId}`,
                with: {
                  owner: {
                    join: owner,
                    on: sql`${parent_profile.userId} = ${owner.id}`,
                  },
                },
              },
            },
          },
        },
        where: {
          parent: {
            name: { eq: "Bob" },
          },
        },
      });
      console.log(item);
      console.log(item.parent);
    } catch (error) {
      console.error(error);
    }
  });
});
