import { Alepha, t } from "alepha";
import { describe, expect, it } from "vitest";
import { $entity, $repository, db } from "../core/index.ts";
import { AlephaOrmPostgres } from "../postgres/index.ts";

const users = $entity({
  name: "users",
  schema: t.object({
    id: db.identityPrimaryKey(),
    __v: db.version(),
    name: t.text(),
    currentPostId: db.ref(t.optional(t.integer()), () => posts.cols.id, {
      onDelete: "set null",
    }),
  }),
});

const posts = $entity({
  name: "posts",
  schema: t.object({
    id: db.identityPrimaryKey(),
    __v: db.version(),
    userId: db.ref(t.integer(), () => users.cols.id, {
      onDelete: "cascade",
    }),
    postParentId: db.ref(t.optional(t.integer()), () => posts.cols.id, {
      onDelete: "cascade",
    }),
  }),
});

class App {
  users = $repository(users);
  posts = $repository(posts);
}

describe("references", () => {
  it("should handle delete cascade", async () => {
    const alepha = Alepha.create().with(AlephaOrmPostgres);
    const app = alepha.inject(App);
    await alepha.start();

    const user = await app.users.create({ name: "John" });
    const post1 = await app.posts.create({ userId: user.id });
    const post2 = await app.posts.create({
      userId: user.id,
      postParentId: post1.id,
    });

    expect(await app.users.findMany()).toEqual([
      { id: user.id, name: "John", __v: 0 },
    ]);
    expect(await app.posts.findMany()).toEqual([
      { id: post1.id, userId: user.id, __v: 0 },
      { id: post2.id, userId: user.id, postParentId: post1.id, __v: 0 },
    ]);

    await app.users.deleteById(user.id);

    expect(await app.users.findMany()).toEqual([]);
    expect(await app.posts.findMany()).toEqual([]);
  });

  it("should handle delete null", async () => {
    const alepha = Alepha.create().with(AlephaOrmPostgres);
    const app = alepha.inject(App);
    await alepha.start();

    const user = await app.users.create({ name: "John" });
    const post1 = await app.posts.create({ userId: user.id });
    const post2 = await app.posts.create({
      userId: user.id,
      postParentId: post1.id,
    });
    const post3 = await app.posts.create({
      userId: user.id,
    });

    user.currentPostId = post2.id;

    await app.users.save(user);

    expect(await app.users.findMany()).toEqual([
      { id: user.id, name: "John", __v: 1, currentPostId: post2.id },
    ]);

    expect(await app.posts.findMany()).toEqual([
      { id: post1.id, userId: user.id, __v: 0 },
      { id: post2.id, userId: user.id, postParentId: post1.id, __v: 0 },
      { id: post3.id, userId: user.id, __v: 0 },
    ]);

    await app.posts.deleteById(post1.id);

    expect(await app.users.findMany()).toEqual([
      { id: user.id, name: "John", __v: 1 },
    ]);

    expect(await app.posts.findMany()).toEqual([
      { id: post3.id, userId: user.id, __v: 0 },
    ]);
  });
});
