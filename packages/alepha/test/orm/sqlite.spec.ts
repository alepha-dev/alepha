import { Alepha, t } from "alepha";
import { describe, expect, it } from "vitest";
import { $entity, $repository, DatabaseProvider, pg } from "../../src/orm";
import {
  NodeSqliteProvider,
  nodeSqliteOptions,
} from "../../src/orm/providers/drivers/NodeSqliteProvider.ts";

describe("sqlite", () => {
  it("should create and query entities using SQLite", async () => {
    const users = $entity({
      name: "users",
      schema: t.object({
        id: pg.primaryKey(t.int()),
        name: t.text(),
      }),
    });

    const alepha = Alepha.create().with({
      provide: DatabaseProvider,
      use: NodeSqliteProvider,
    });

    alepha.state.mut(nodeSqliteOptions, (old) => ({
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
});
