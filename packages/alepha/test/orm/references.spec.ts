import { Alepha, t } from "alepha/core";
import { describe, expect, it } from "vitest";
import { $entity, $repository, pg } from "../../src/orm";

const users = $entity({
  name: "users",
  schema: t.object({
    id: pg.identityPrimaryKey(),
    __v: pg.version(),
    name: t.text(),
    currentPostId: pg.ref(t.optional(t.int()), () => posts.cols.id, {
      onDelete: "set null",
    }),
  }),
});

const posts = $entity({
  name: "posts",
  schema: t.object({
    id: pg.identityPrimaryKey(),
    __v: pg.version(),
    userId: pg.ref(t.int(), () => users.cols.id, {
      onDelete: "cascade",
    }),
    postParentId: pg.ref(t.optional(t.int()), () => posts.cols.id, {
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
    const alepha = Alepha.create();
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
    const alepha = Alepha.create();
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
