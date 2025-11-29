import { Alepha } from "alepha";
import { $repository } from "alepha/orm";
import { describe, expect, it } from "vitest";
import type { InsertUserEntity } from "./fixtures/userEntitySchema.ts";
import { userEntity } from "./fixtures/userEntitySchema.ts";

class App {
  users = $repository(userEntity);
}

const testPaginationSort = async (alepha: Alepha) => {
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

  // Test 1: Single column ASC (no prefix)
  const result1 = await app.users.paginate({ sort: "name" });

  expect(result1.content.length).toBe(4);
  expect(result1.content[0].name).toBe("Alice");
  expect(result1.content[1].name).toBe("Bob");
  expect(result1.content[2].name).toBe("Charlie");
  expect(result1.content[3].name).toBe("David");

  // Test 2: Single column DESC (with - prefix)
  const result2 = await app.users.paginate({ sort: "-name" });

  expect(result2.content.length).toBe(4);
  expect(result2.content[0].name).toBe("David");
  expect(result2.content[1].name).toBe("Charlie");
  expect(result2.content[2].name).toBe("Bob");
  expect(result2.content[3].name).toBe("Alice");

  // Test 3: Multiple columns - role ASC, name DESC
  const result3 = await app.users.paginate({ sort: "role,-name" });

  expect(result3.content.length).toBe(4);
  // First by role ASC (admin, admin, user, user)
  // Then by name DESC within each role
  expect(result3.content[0].role).toBe("admin");
  expect(result3.content[0].name).toBe("Charlie"); // admin, Charlie
  expect(result3.content[1].role).toBe("admin");
  expect(result3.content[1].name).toBe("Bob"); // admin, Bob
  expect(result3.content[2].role).toBe("user");
  expect(result3.content[2].name).toBe("David"); // user, David
  expect(result3.content[3].role).toBe("user");
  expect(result3.content[3].name).toBe("Alice"); // user, Alice

  // Test 4: Multiple columns - both ASC
  const result4 = await app.users.paginate({ sort: "role,name" });

  expect(result4.content.length).toBe(4);
  // Both ASC
  expect(result4.content[0].role).toBe("admin");
  expect(result4.content[0].name).toBe("Bob"); // admin, Bob
  expect(result4.content[1].role).toBe("admin");
  expect(result4.content[1].name).toBe("Charlie"); // admin, Charlie
  expect(result4.content[2].role).toBe("user");
  expect(result4.content[2].name).toBe("Alice"); // user, Alice
  expect(result4.content[3].role).toBe("user");
  expect(result4.content[3].name).toBe("David"); // user, David

  // Test 5: Multiple columns - both DESC
  const result5 = await app.users.paginate({ sort: "-role,-name" });

  expect(result5.content.length).toBe(4);
  // Both DESC
  expect(result5.content[0].role).toBe("user");
  expect(result5.content[0].name).toBe("David"); // user, David
  expect(result5.content[1].role).toBe("user");
  expect(result5.content[1].name).toBe("Alice"); // user, Alice
  expect(result5.content[2].role).toBe("admin");
  expect(result5.content[2].name).toBe("Charlie"); // admin, Charlie
  expect(result5.content[3].role).toBe("admin");
  expect(result5.content[3].name).toBe("Bob"); // admin, Bob

  // Test 6: Pagination with sorting and page size
  const result6 = await app.users.paginate(
    { sort: "name", size: 2, page: 0 },
    {},
    { count: true },
  );

  expect(result6.content.length).toBe(2);
  expect(result6.content[0].name).toBe("Alice");
  expect(result6.content[1].name).toBe("Bob");
  expect(result6.page.totalElements).toBe(4);
  expect(result6.page.totalPages).toBe(2);
  expect(result6.page.isFirst).toBe(true);
  expect(result6.page.isLast).toBe(false);
  expect(result6.page.sort?.sorted).toBe(true);
  expect(result6.page.sort?.fields).toEqual([
    { field: "name", direction: "asc" },
  ]);

  // Test 7: Second page
  const result7 = await app.users.paginate(
    { sort: "name", size: 2, page: 1 },
    {},
    { count: true },
  );

  expect(result7.content.length).toBe(2);
  expect(result7.content[0].name).toBe("Charlie");
  expect(result7.content[1].name).toBe("David");
  expect(result7.page.isFirst).toBe(false);
  expect(result7.page.isLast).toBe(true);
  expect(result7.page.sort?.sorted).toBe(true);
  expect(result7.page.sort?.fields).toEqual([
    { field: "name", direction: "asc" },
  ]);

  // Test 8: Sort with spaces (should be trimmed)
  const result8 = await app.users.paginate({ sort: " role , -name " });

  expect(result8.content.length).toBe(4);
  expect(result8.content[0].role).toBe("admin");
  expect(result8.content[0].name).toBe("Charlie");

  // Clean up
  await app.users.clear({ force: true });
};

describe("$repository - pagination sort", () => {
  it("should support pagination with new sort format", async () => {
    await testPaginationSort(Alepha.create());
  });

  it("should support pagination with new sort format (sqlite)", async () => {
    await testPaginationSort(
      Alepha.create({
        env: {
          DATABASE_URL: "sqlite://:memory:",
        },
      }),
    );
  });
});
