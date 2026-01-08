import { Alepha, t } from "alepha";
import { describe, expect, it } from "vitest";
import { $entity, $repository, DatabaseProvider, pg } from "../index.ts";
import {
  NodeSqliteProvider,
  nodeSqliteOptions,
} from "../providers/drivers/NodeSqliteProvider.ts";

describe("sqlite", () => {
  it("should create and query entities using SQLite", async () => {
    const users = $entity({
      name: "users",
      schema: t.object({
        id: pg.primaryKey(t.integer()),
        name: t.text(),
      }),
    });

    const alepha = Alepha.create().with({
      provide: DatabaseProvider,
      use: NodeSqliteProvider,
    });

    alepha.store.mut(nodeSqliteOptions, (old) => ({
      ...old,
      path: "sqlite://:memory:",
    }));

    class TestApp {
      userRepository = $repository(users);
    }

    const repository = alepha.inject(TestApp).userRepository;

    await alepha.start();

    await repository.create({
      name: "John Doe",
    });

    const user = await repository.findOne({
      where: {
        name: { eq: "John Doe" },
      },
    });

    expect(user).toStrictEqual({
      id: 1,
      name: "John Doe",
    });
  });

  it("should create and query entities with bigint primary key", async () => {
    const posts = $entity({
      name: "posts",
      schema: t.object({
        id: pg.primaryKey(t.bigint()),
        title: t.text(),
      }),
    });

    const alepha = Alepha.create().with({
      provide: DatabaseProvider,
      use: NodeSqliteProvider,
    });

    alepha.store.mut(nodeSqliteOptions, (old) => ({
      ...old,
      path: "sqlite://:memory:",
    }));

    class TestApp {
      postRepository = $repository(posts);
    }

    const repository = alepha.inject(TestApp).postRepository;

    await alepha.start();

    await repository.create({
      title: "Hello World",
    });

    await repository.create({
      title: "Second Post",
    });

    const post = await repository.findOne({
      where: {
        title: { eq: "Hello World" },
      },
    });

    // bigint returns as string (for int64 safety)
    expect(post).toStrictEqual({
      id: "1",
      title: "Hello World",
    });

    const secondPost = await repository.findOne({
      where: {
        title: { eq: "Second Post" },
      },
    });

    expect(secondPost).toStrictEqual({
      id: "2",
      title: "Second Post",
    });
  });
});
