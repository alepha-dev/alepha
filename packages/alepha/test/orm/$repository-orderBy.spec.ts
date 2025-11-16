import { Alepha } from "alepha/core";
import { describe, expect, it } from "vitest";
import { $repository } from "../../src/orm";
import type { InsertUserEntity } from "./fixtures/userEntitySchema.ts";
import { userEntity } from "./fixtures/userEntitySchema.ts";

class App {
  users = $repository(userEntity);
}

const testOrderByModes = async (alepha: Alepha) => {
  const app = alepha.inject(App);
  await alepha.start();

  // Create test users with different names and roles
  const users: InsertUserEntity[] = [
    { name: "Charlie", profile: { age: 25 }, role: "admin" },
    { name: "Alice", profile: { age: 30 }, role: "user" },
    { name: "Bob", profile: { age: 20 }, role: "admin" },
    { name: "David", profile: { age: 35 }, role: "user" },
  ];

  for (const user of users) {
    await app.users.create(user);
  }

  // MODE 1: String (defaults to ASC)
  const usersMode1 = await app.users.findMany({
    orderBy: "name",
  });

  expect(usersMode1.length).toBe(4);
  expect(usersMode1[0].name).toBe("Alice");
  expect(usersMode1[1].name).toBe("Bob");
  expect(usersMode1[2].name).toBe("Charlie");
  expect(usersMode1[3].name).toBe("David");

  // MODE 2: Single object with direction ASC
  const usersMode2Asc = await app.users.findMany({
    orderBy: { column: "name", direction: "asc" },
  });

  expect(usersMode2Asc.length).toBe(4);
  expect(usersMode2Asc[0].name).toBe("Alice");
  expect(usersMode2Asc[1].name).toBe("Bob");
  expect(usersMode2Asc[2].name).toBe("Charlie");
  expect(usersMode2Asc[3].name).toBe("David");

  // MODE 2: Single object with direction DESC
  const usersMode2Desc = await app.users.findMany({
    orderBy: { column: "name", direction: "desc" },
  });

  expect(usersMode2Desc.length).toBe(4);
  expect(usersMode2Desc[0].name).toBe("David");
  expect(usersMode2Desc[1].name).toBe("Charlie");
  expect(usersMode2Desc[2].name).toBe("Bob");
  expect(usersMode2Desc[3].name).toBe("Alice");

  // MODE 2: Single object without direction (defaults to ASC)
  const usersMode2Default = await app.users.findMany({
    orderBy: { column: "name" },
  });

  expect(usersMode2Default.length).toBe(4);
  expect(usersMode2Default[0].name).toBe("Alice");
  expect(usersMode2Default[3].name).toBe("David");

  // MODE 3: Array with multiple columns
  const usersMode3Multi = await app.users.findMany({
    orderBy: [
      { column: "role", direction: "asc" },
      { column: "name", direction: "desc" },
    ],
  });

  expect(usersMode3Multi.length).toBe(4);
  // First by role ASC (admin, admin, user, user)
  // Then by name DESC within each role
  expect(usersMode3Multi[0].role).toBe("admin");
  expect(usersMode3Multi[0].name).toBe("Charlie"); // admin, Charlie
  expect(usersMode3Multi[1].role).toBe("admin");
  expect(usersMode3Multi[1].name).toBe("Bob"); // admin, Bob
  expect(usersMode3Multi[2].role).toBe("user");
  expect(usersMode3Multi[2].name).toBe("David"); // user, David
  expect(usersMode3Multi[3].role).toBe("user");
  expect(usersMode3Multi[3].name).toBe("Alice"); // user, Alice

  // MODE 3: Array with default direction
  const usersMode3Default = await app.users.findMany({
    orderBy: [{ column: "role" }, { column: "name" }],
  });

  expect(usersMode3Default.length).toBe(4);
  // Both ASC by default
  expect(usersMode3Default[0].role).toBe("admin");
  expect(usersMode3Default[0].name).toBe("Bob"); // admin, Bob
  expect(usersMode3Default[1].role).toBe("admin");
  expect(usersMode3Default[1].name).toBe("Charlie"); // admin, Charlie

  // MODE 3: Array with single column
  const usersMode3Single = await app.users.findMany({
    orderBy: [{ column: "name", direction: "desc" }],
  });

  expect(usersMode3Single.length).toBe(4);
  expect(usersMode3Single[0].name).toBe("David");
  expect(usersMode3Single[3].name).toBe("Alice");

  // Clean up
  await app.users.clear({ force: true });
};

describe("$repository - orderBy", () => {
  it("should support all 3 orderBy modes", async () => {
    await testOrderByModes(Alepha.create());
  });

  it("should support all 3 orderBy modes (sqlite)", async () => {
    await testOrderByModes(
      Alepha.create({
        env: {
          DATABASE_URL: "sqlite://:memory:",
        },
      }),
    );
  });
});
