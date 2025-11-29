import { Alepha, t } from "alepha";
import { $entity, $repository, pg } from "alepha/orm";
import { test } from "vitest";

const User = $entity({
  name: "users",
  schema: t.object({
    id: pg.primaryKey(),
    createdAt: pg.createdAt(),
    updatedAt: pg.updatedAt(),
    name: t.text(),
    email: t.text(),
    bio: t.optional(t.text()),
  }),
});

class App {
  users = $repository(User);
}

test("contains operator - case insensitive substring matching", async ({
  expect,
}) => {
  const alepha = Alepha.create();
  const app = alepha.inject(App);
  await alepha.start();

  const repository = app.users;

  // Insert test data
  await repository.create({ name: "Alice Smith", email: "alice@example.com" });
  await repository.create({ name: "Bob Johnson", email: "bob@test.com" });
  await repository.create({
    name: "Charlie Brown",
    email: "charlie@example.com",
  });
  await repository.create({ name: "David Wilson", email: "david@sample.org" });

  // Test contains with exact case
  const result1 = await repository.findMany({
    where: { name: { contains: "Smith" } },
  });
  expect(result1).toHaveLength(1);
  expect(result1[0].name).toBe("Alice Smith");

  // Test contains with different case (should be case insensitive)
  const result2 = await repository.findMany({
    where: { name: { contains: "smith" } },
  });
  expect(result2).toHaveLength(1);
  expect(result2[0].name).toBe("Alice Smith");

  // Test contains in email
  const result3 = await repository.findMany({
    where: { email: { contains: "example" } },
  });
  expect(result3).toHaveLength(2);
  expect(result3.map((u: any) => u.name).sort()).toEqual([
    "Alice Smith",
    "Charlie Brown",
  ]);

  // Test contains with no matches
  const result4 = await repository.findMany({
    where: { name: { contains: "XYZ" } },
  });
  expect(result4).toHaveLength(0);
});

test("startsWith operator - case insensitive prefix matching", async ({
  expect,
}) => {
  const alepha = Alepha.create();
  const app = alepha.inject(App);
  await alepha.start();

  const repository = app.users;

  // Insert test data
  await repository.create({ name: "Alice Smith", email: "alice@example.com" });
  await repository.create({ name: "Bob Johnson", email: "bob@test.com" });
  await repository.create({
    name: "Charlie Brown",
    email: "charlie@example.com",
  });
  await repository.create({ name: "Alan Turing", email: "alan@sample.org" });

  // Test startsWith with exact case
  const result1 = await repository.findMany({
    where: { name: { startsWith: "Alice" } },
  });
  expect(result1).toHaveLength(1);
  expect(result1[0].name).toBe("Alice Smith");

  // Test startsWith with different case (should be case insensitive)
  const result2 = await repository.findMany({
    where: { name: { startsWith: "alice" } },
  });
  expect(result2).toHaveLength(1);
  expect(result2[0].name).toBe("Alice Smith");

  // Test startsWith matching multiple records
  const result3 = await repository.findMany({
    where: { name: { startsWith: "A" } },
    orderBy: { column: "name", direction: "asc" },
  });
  expect(result3).toHaveLength(2);
  expect(result3.map((u: any) => u.name)).toEqual([
    "Alan Turing",
    "Alice Smith",
  ]);

  // Test startsWith with email
  const result4 = await repository.findMany({
    where: { email: { startsWith: "bob" } },
  });
  expect(result4).toHaveLength(1);
  expect(result4[0].email).toBe("bob@test.com");

  // Test startsWith with no matches
  const result5 = await repository.findMany({
    where: { name: { startsWith: "XYZ" } },
  });
  expect(result5).toHaveLength(0);
});

test("endsWith operator - case insensitive suffix matching", async ({
  expect,
}) => {
  const alepha = Alepha.create();
  const app = alepha.inject(App);
  await alepha.start();

  const repository = app.users;

  // Insert test data
  await repository.create({ name: "Alice Smith", email: "alice@example.com" });
  await repository.create({ name: "Bob Johnson", email: "bob@example.com" });
  await repository.create({ name: "Charlie Brown", email: "charlie@test.com" });
  await repository.create({ name: "David Wilson", email: "david@example.org" });

  // Test endsWith with exact case
  const result1 = await repository.findMany({
    where: { name: { endsWith: "Smith" } },
  });
  expect(result1).toHaveLength(1);
  expect(result1[0].name).toBe("Alice Smith");

  // Test endsWith with different case (should be case insensitive)
  const result2 = await repository.findMany({
    where: { name: { endsWith: "smith" } },
  });
  expect(result2).toHaveLength(1);
  expect(result2[0].name).toBe("Alice Smith");

  // Test endsWith matching multiple records
  const result3 = await repository.findMany({
    where: { name: { endsWith: "son" } },
    orderBy: { column: "name", direction: "asc" },
  });
  expect(result3).toHaveLength(2);
  expect(result3.map((u: any) => u.name)).toEqual([
    "Bob Johnson",
    "David Wilson",
  ]);

  // Test endsWith with email domain
  const result4 = await repository.findMany({
    where: { email: { endsWith: "example.com" } },
    orderBy: { column: "name", direction: "asc" },
  });
  expect(result4).toHaveLength(2);
  expect(result4.map((u) => u.name)).toEqual(["Alice Smith", "Bob Johnson"]);

  // Test endsWith with no matches
  const result5 = await repository.findMany({
    where: { name: { endsWith: "XYZ" } },
  });
  expect(result5).toHaveLength(0);
});

test("combining string operators with other filters", async ({ expect }) => {
  const alepha = Alepha.create();
  const app = alepha.inject(App);
  await alepha.start();

  const repository = app.users;

  // Insert test data
  await repository.create({
    name: "Alice Smith",
    email: "alice@example.com",
    bio: "Software Engineer",
  });
  await repository.create({
    name: "Bob Johnson",
    email: "bob@example.com",
    bio: "Product Manager",
  });
  await repository.create({
    name: "Charlie Brown",
    email: "charlie@test.com",
    bio: "Software Developer",
  });
  await repository.create({
    name: "David Wilson",
    email: "david@example.org",
    bio: "Designer",
  });

  // Combine contains with other operators
  const result1 = await repository.findMany({
    where: {
      and: [
        { email: { contains: "example" } },
        { bio: { contains: "Software" } },
      ],
    },
  });
  expect(result1).toHaveLength(1);
  expect(result1[0].name).toBe("Alice Smith");

  // Combine startsWith and endsWith
  const result2 = await repository.findMany({
    where: {
      and: [{ name: { startsWith: "B" } }, { name: { endsWith: "son" } }],
    },
  });
  expect(result2).toHaveLength(1);
  expect(result2[0].name).toBe("Bob Johnson");

  // Combine with OR
  const result3 = await repository.findMany({
    where: {
      or: [
        { name: { contains: "Alice" } },
        { email: { endsWith: "test.com" } },
      ],
    },
    orderBy: { column: "name", direction: "asc" },
  });
  expect(result3).toHaveLength(2);
  expect(result3.map((u: any) => u.name)).toEqual([
    "Alice Smith",
    "Charlie Brown",
  ]);
});

test("string operators with special characters", async ({ expect }) => {
  const alepha = Alepha.create();
  const app = alepha.inject(App);
  await alepha.start();

  const repository = app.users;

  // Insert test data with special characters
  await repository.create({ name: "O'Brien", email: "obrien@example.com" });
  await repository.create({
    name: "Smith & Jones",
    email: "smith-jones@test.com",
  });
  await repository.create({ name: "50% Off", email: "discount@shop.com" });

  // Test contains with apostrophe
  const result1 = await repository.findMany({
    where: { name: { contains: "O'Brien" } },
  });
  expect(result1).toHaveLength(1);
  expect(result1[0].name).toBe("O'Brien");

  // Test contains with ampersand
  const result2 = await repository.findMany({
    where: { name: { contains: "&" } },
  });
  expect(result2).toHaveLength(1);
  expect(result2[0].name).toBe("Smith & Jones");

  // Test startsWith with percent sign
  const result3 = await repository.findMany({
    where: { name: { startsWith: "50%" } },
  });
  expect(result3).toHaveLength(1);
  expect(result3[0].name).toBe("50% Off");
});

test("string operators on optional fields", async ({ expect }) => {
  const alepha = Alepha.create();
  const app = alepha.inject(App);
  await alepha.start();

  const repository = app.users;

  // Insert test data with some null bio fields
  await repository.create({
    name: "Alice",
    email: "alice@example.com",
    bio: "Engineer at Tech Co",
  });
  await repository.create({ name: "Bob", email: "bob@example.com" });
  await repository.create({
    name: "Charlie",
    email: "charlie@test.com",
    bio: "Designer",
  });

  // Test contains on optional field
  const result1 = await repository.findMany({
    where: { bio: { contains: "Engineer" } },
  });
  expect(result1).toHaveLength(1);
  expect(result1[0].name).toBe("Alice");

  // Test that null values don't match
  const result2 = await repository.findMany({
    where: { bio: { contains: "Bob" } },
  });
  expect(result2).toHaveLength(0);

  // Combine with isNotNull
  const result3 = await repository.findMany({
    where: {
      and: [{ bio: { isNotNull: true } }, { bio: { startsWith: "Des" } }],
    },
  });
  expect(result3).toHaveLength(1);
  expect(result3[0].name).toBe("Charlie");
});

test("string operators properly escape SQL wildcards", async ({ expect }) => {
  const alepha = Alepha.create();
  const app = alepha.inject(App);
  await alepha.start();

  const repository = app.users;

  // Insert test data with wildcard characters
  await repository.create({ name: "admin", email: "admin@example.com" });
  await repository.create({ name: "user123", email: "user@example.com" });
  await repository.create({ name: "test_admin", email: "test@example.com" });
  await repository.create({ name: "superuser", email: "super@example.com" });
  await repository.create({ name: "%special%", email: "special@example.com" });
  await repository.create({ name: "under_score", email: "under@example.com" });

  // Test 1: Percent sign should be treated as literal, not wildcard
  const result1 = await repository.findMany({
    where: { name: { contains: "%special%" } },
  });
  expect(result1).toHaveLength(1);
  expect(result1[0].name).toBe("%special%");

  // Test 2: Underscore should be treated as literal, not single-char wildcard
  const result2 = await repository.findMany({
    where: { name: { contains: "_" } },
  });
  // Should match "test_admin" and "under_score" only (literal underscore)
  expect(result2).toHaveLength(2);
  expect(result2.map((u: any) => u.name).sort()).toEqual([
    "test_admin",
    "under_score",
  ]);

  // Test 3: startsWith with underscore should match literal
  const result3 = await repository.findMany({
    where: { name: { startsWith: "test_" } },
  });
  expect(result3).toHaveLength(1);
  expect(result3[0].name).toBe("test_admin");

  // Test 4: endsWith with percent should match literal
  const result4 = await repository.findMany({
    where: { name: { endsWith: "%" } },
  });
  expect(result4).toHaveLength(1);
  expect(result4[0].name).toBe("%special%");

  // Test 5: Multiple wildcards should be escaped
  const result5 = await repository.findMany({
    where: { name: { contains: "%spe" } },
  });
  expect(result5).toHaveLength(1);
  expect(result5[0].name).toBe("%special%");

  // Test 6: Backslash escaping
  await repository.create({ name: "back\\slash", email: "back@example.com" });
  const result6 = await repository.findMany({
    where: { name: { contains: "back\\" } },
  });
  expect(result6).toHaveLength(1);
  expect(result6[0].name).toBe("back\\slash");
});

test("wildcard injection prevention", async ({ expect }) => {
  const alepha = Alepha.create();
  const app = alepha.inject(App);
  await alepha.start();

  const repository = app.users;

  // Insert test data
  await repository.create({ name: "admin", email: "admin@example.com" });
  await repository.create({ name: "user123", email: "user@example.com" });
  await repository.create({ name: "superuser", email: "super@example.com" });

  // Attempt wildcard injection with %
  // If not escaped, "%user%" would match "user123" and "superuser"
  // With proper escaping, it should match nothing (no literal "%user%" exists)
  const result1 = await repository.findMany({
    where: { name: { contains: "%user%" } },
  });
  expect(result1).toHaveLength(0);

  // Attempt wildcard injection with _
  // If not escaped, "user_" would match "user1", "user2", etc.
  // With proper escaping, it should match nothing
  const result2 = await repository.findMany({
    where: { name: { contains: "user_" } },
  });
  expect(result2).toHaveLength(0);

  // Verify normal search still works
  const result3 = await repository.findMany({
    where: { name: { contains: "user" } },
  });
  expect(result3).toHaveLength(2); // user123 and superuser
  expect(result3.map((u: any) => u.name).sort()).toEqual([
    "superuser",
    "user123",
  ]);
});
