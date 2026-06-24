import { type Alepha, z } from "alepha";
import { expect } from "vitest";
import { $entity, $repository, db } from "../core/index.ts";

const User = $entity({
  name: "users",
  schema: z.object({
    id: db.primaryKey(),
    createdAt: db.createdAt(),
    updatedAt: db.updatedAt(),
    name: z.text(),
    email: z.text(),
    bio: z.text().optional(),
  }),
});

class App {
  users = $repository(User);
}

// ============================================================================
// testContainsOperator
// ============================================================================

export const testContainsOperator = async (alepha: Alepha) => {
  const app = alepha.inject(App);
  await alepha.start();

  const repository = app.users;

  await repository.create({ name: "Alice Smith", email: "alice@example.com" });
  await repository.create({ name: "Bob Johnson", email: "bob@test.com" });
  await repository.create({
    name: "Charlie Brown",
    email: "charlie@example.com",
  });
  await repository.create({ name: "David Wilson", email: "david@sample.org" });

  // Exact case
  const result1 = await repository.findMany({
    where: { name: { contains: "Smith" } },
  });
  expect(result1).toHaveLength(1);
  expect(result1[0].name).toBe("Alice Smith");

  // Different case (case insensitive)
  const result2 = await repository.findMany({
    where: { name: { contains: "smith" } },
  });
  expect(result2).toHaveLength(1);
  expect(result2[0].name).toBe("Alice Smith");

  // In email
  const result3 = await repository.findMany({
    where: { email: { contains: "example" } },
  });
  expect(result3).toHaveLength(2);
  expect(result3.map((u: any) => u.name).sort()).toEqual([
    "Alice Smith",
    "Charlie Brown",
  ]);

  // No matches
  const result4 = await repository.findMany({
    where: { name: { contains: "XYZ" } },
  });
  expect(result4).toHaveLength(0);
};

// ============================================================================
// testStartsWithOperator
// ============================================================================

export const testStartsWithOperator = async (alepha: Alepha) => {
  const app = alepha.inject(App);
  await alepha.start();

  const repository = app.users;

  await repository.create({ name: "Alice Smith", email: "alice@example.com" });
  await repository.create({ name: "Bob Johnson", email: "bob@test.com" });
  await repository.create({
    name: "Charlie Brown",
    email: "charlie@example.com",
  });
  await repository.create({ name: "Alan Turing", email: "alan@sample.org" });

  // Exact case
  const result1 = await repository.findMany({
    where: { name: { startsWith: "Alice" } },
  });
  expect(result1).toHaveLength(1);
  expect(result1[0].name).toBe("Alice Smith");

  // Different case (case insensitive)
  const result2 = await repository.findMany({
    where: { name: { startsWith: "alice" } },
  });
  expect(result2).toHaveLength(1);
  expect(result2[0].name).toBe("Alice Smith");

  // Multiple matches
  const result3 = await repository.findMany({
    where: { name: { startsWith: "A" } },
    orderBy: { column: "name", direction: "asc" },
  });
  expect(result3).toHaveLength(2);
  expect(result3.map((u: any) => u.name)).toEqual([
    "Alan Turing",
    "Alice Smith",
  ]);

  // Email
  const result4 = await repository.findMany({
    where: { email: { startsWith: "bob" } },
  });
  expect(result4).toHaveLength(1);
  expect(result4[0].email).toBe("bob@test.com");

  // No matches
  const result5 = await repository.findMany({
    where: { name: { startsWith: "XYZ" } },
  });
  expect(result5).toHaveLength(0);
};

// ============================================================================
// testEndsWithOperator
// ============================================================================

export const testEndsWithOperator = async (alepha: Alepha) => {
  const app = alepha.inject(App);
  await alepha.start();

  const repository = app.users;

  await repository.create({ name: "Alice Smith", email: "alice@example.com" });
  await repository.create({ name: "Bob Johnson", email: "bob@example.com" });
  await repository.create({ name: "Charlie Brown", email: "charlie@test.com" });
  await repository.create({ name: "David Wilson", email: "david@example.org" });

  // Exact case
  const result1 = await repository.findMany({
    where: { name: { endsWith: "Smith" } },
  });
  expect(result1).toHaveLength(1);
  expect(result1[0].name).toBe("Alice Smith");

  // Different case (case insensitive)
  const result2 = await repository.findMany({
    where: { name: { endsWith: "smith" } },
  });
  expect(result2).toHaveLength(1);
  expect(result2[0].name).toBe("Alice Smith");

  // Multiple matches
  const result3 = await repository.findMany({
    where: { name: { endsWith: "son" } },
    orderBy: { column: "name", direction: "asc" },
  });
  expect(result3).toHaveLength(2);
  expect(result3.map((u: any) => u.name)).toEqual([
    "Bob Johnson",
    "David Wilson",
  ]);

  // Email domain
  const result4 = await repository.findMany({
    where: { email: { endsWith: "example.com" } },
    orderBy: { column: "name", direction: "asc" },
  });
  expect(result4).toHaveLength(2);
  expect(result4.map((u) => u.name)).toEqual(["Alice Smith", "Bob Johnson"]);

  // No matches
  const result5 = await repository.findMany({
    where: { name: { endsWith: "XYZ" } },
  });
  expect(result5).toHaveLength(0);
};

// ============================================================================
// testCombiningStringOperators
// ============================================================================

export const testCombiningStringOperators = async (alepha: Alepha) => {
  const app = alepha.inject(App);
  await alepha.start();

  const repository = app.users;

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
};

// ============================================================================
// testStringOperatorsSpecialChars
// ============================================================================

export const testStringOperatorsSpecialChars = async (alepha: Alepha) => {
  const app = alepha.inject(App);
  await alepha.start();

  const repository = app.users;

  await repository.create({ name: "O'Brien", email: "obrien@example.com" });
  await repository.create({
    name: "Smith & Jones",
    email: "smith-jones@test.com",
  });
  await repository.create({ name: "50% Off", email: "discount@shop.com" });

  // Apostrophe
  const result1 = await repository.findMany({
    where: { name: { contains: "O'Brien" } },
  });
  expect(result1).toHaveLength(1);
  expect(result1[0].name).toBe("O'Brien");

  // Ampersand
  const result2 = await repository.findMany({
    where: { name: { contains: "&" } },
  });
  expect(result2).toHaveLength(1);
  expect(result2[0].name).toBe("Smith & Jones");

  // Percent sign
  const result3 = await repository.findMany({
    where: { name: { startsWith: "50%" } },
  });
  expect(result3).toHaveLength(1);
  expect(result3[0].name).toBe("50% Off");
};

// ============================================================================
// testStringOperatorsOptionalFields
// ============================================================================

export const testStringOperatorsOptionalFields = async (alepha: Alepha) => {
  const app = alepha.inject(App);
  await alepha.start();

  const repository = app.users;

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

  // Contains on optional field
  const result1 = await repository.findMany({
    where: { bio: { contains: "Engineer" } },
  });
  expect(result1).toHaveLength(1);
  expect(result1[0].name).toBe("Alice");

  // Null values don't match
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
};

// ============================================================================
// testStringOperatorsEscapeWildcards
// ============================================================================

export const testStringOperatorsEscapeWildcards = async (alepha: Alepha) => {
  const app = alepha.inject(App);
  await alepha.start();

  const repository = app.users;

  await repository.create({ name: "admin", email: "admin@example.com" });
  await repository.create({ name: "user123", email: "user@example.com" });
  await repository.create({ name: "test_admin", email: "test@example.com" });
  await repository.create({ name: "superuser", email: "super@example.com" });
  await repository.create({ name: "%special%", email: "special@example.com" });
  await repository.create({ name: "under_score", email: "under@example.com" });

  // Percent sign as literal
  const result1 = await repository.findMany({
    where: { name: { contains: "%special%" } },
  });
  expect(result1).toHaveLength(1);
  expect(result1[0].name).toBe("%special%");

  // Underscore as literal
  const result2 = await repository.findMany({
    where: { name: { contains: "_" } },
  });
  expect(result2).toHaveLength(2);
  expect(result2.map((u: any) => u.name).sort()).toEqual([
    "test_admin",
    "under_score",
  ]);

  // startsWith with underscore
  const result3 = await repository.findMany({
    where: { name: { startsWith: "test_" } },
  });
  expect(result3).toHaveLength(1);
  expect(result3[0].name).toBe("test_admin");

  // endsWith with percent
  const result4 = await repository.findMany({
    where: { name: { endsWith: "%" } },
  });
  expect(result4).toHaveLength(1);
  expect(result4[0].name).toBe("%special%");

  // Multiple wildcards escaped
  const result5 = await repository.findMany({
    where: { name: { contains: "%spe" } },
  });
  expect(result5).toHaveLength(1);
  expect(result5[0].name).toBe("%special%");

  // Backslash escaping
  await repository.create({ name: "back\\slash", email: "back@example.com" });
  const result6 = await repository.findMany({
    where: { name: { contains: "back\\" } },
  });
  expect(result6).toHaveLength(1);
  expect(result6[0].name).toBe("back\\slash");
};

// ============================================================================
// testWildcardInjectionPrevention
// ============================================================================

export const testWildcardInjectionPrevention = async (alepha: Alepha) => {
  const app = alepha.inject(App);
  await alepha.start();

  const repository = app.users;

  await repository.create({ name: "admin", email: "admin@example.com" });
  await repository.create({ name: "user123", email: "user@example.com" });
  await repository.create({ name: "superuser", email: "super@example.com" });

  // Wildcard injection with %
  const result1 = await repository.findMany({
    where: { name: { contains: "%user%" } },
  });
  expect(result1).toHaveLength(0);

  // Wildcard injection with _
  const result2 = await repository.findMany({
    where: { name: { contains: "user_" } },
  });
  expect(result2).toHaveLength(0);

  // Normal search still works
  const result3 = await repository.findMany({
    where: { name: { contains: "user" } },
  });
  expect(result3).toHaveLength(2);
  expect(result3.map((u: any) => u.name).sort()).toEqual([
    "superuser",
    "user123",
  ]);
};
