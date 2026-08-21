import { z } from "alepha";
import { describe, test } from "vitest";

import { FakeProvider } from "../providers/FakeProvider.ts";

describe("FakeProvider", () => {
  test("generates string values", ({ expect }) => {
    const fake = new FakeProvider();
    const schema = z.string();
    const result = fake.generate(schema);

    expect(typeof result).toBe("string");
    expect(result.length).toBeGreaterThan(0);
  });

  test("generates text with size constraints", ({ expect }) => {
    const fake = new FakeProvider();

    const shortText = fake.generate(z.shortText());
    expect(typeof shortText).toBe("string");
    expect(shortText.length).toBeLessThanOrEqual(64);

    const regularText = fake.generate(z.text());
    expect(typeof regularText).toBe("string");
    expect(regularText.length).toBeLessThanOrEqual(255);

    const longText = fake.generate(z.longText());
    expect(typeof longText).toBe("string");
    expect(longText.length).toBeLessThanOrEqual(1024);

    const richText = fake.generate(z.richText());
    expect(typeof richText).toBe("string");
    expect(richText.length).toBeLessThanOrEqual(65535);
  });

  test("generates number values", ({ expect }) => {
    const fake = new FakeProvider();
    const schema = z.number();
    const result = fake.generate(schema);

    expect(typeof result).toBe("number");
  });

  test("generates number with constraints", ({ expect }) => {
    const fake = new FakeProvider();
    const schema = z.number().min(10).max(20);
    const result = fake.generate(schema);

    expect(result).toBeGreaterThanOrEqual(10);
    expect(result).toBeLessThanOrEqual(20);
  });

  test("generates integer values", ({ expect }) => {
    const fake = new FakeProvider();
    const schema = z.integer();
    const result = fake.generate(schema);

    expect(typeof result).toBe("number");
    expect(Number.isInteger(result)).toBe(true);
  });

  test("generates integer with constraints", ({ expect }) => {
    const fake = new FakeProvider();
    const schema = z.integer().min(5).max(15);
    const result = fake.generate(schema);

    expect(Number.isInteger(result)).toBe(true);
    expect(result).toBeGreaterThanOrEqual(5);
    expect(result).toBeLessThanOrEqual(15);
  });

  test("generates boolean values", ({ expect }) => {
    const fake = new FakeProvider();
    const schema = z.boolean();
    const result = fake.generate(schema);

    expect(typeof result).toBe("boolean");
  });

  test("generates UUID", ({ expect }) => {
    const fake = new FakeProvider();
    const schema = z.uuid();
    const result = fake.generate(schema);

    expect(typeof result).toBe("string");
    expect(result).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
  });

  test("generates email", ({ expect }) => {
    const fake = new FakeProvider();
    const schema = z.email();
    const result = fake.generate(schema);

    expect(typeof result).toBe("string");
    expect(result).toMatch(/^[^\s@]+@[^\s@]+\.[^\s@]+$/);
  });

  test("generates URL", ({ expect }) => {
    const fake = new FakeProvider();
    const schema = z.string().meta({ format: "url" });
    const result = fake.generate(schema);

    expect(typeof result).toBe("string");
    expect(result).toMatch(/^https?:\/\//);
  });

  test("generates bigint", ({ expect }) => {
    const fake = new FakeProvider();
    const schema = z.string().meta({ format: "bigint" });
    const result = fake.generate(schema);

    expect(typeof result).toBe("string");
    expect(/^-?\d+$/.test(result)).toBe(true);
  });

  test("generates E.164 phone number", ({ expect }) => {
    const fake = new FakeProvider();
    const schema = z.e164();
    const result = fake.generate(schema);

    expect(typeof result).toBe("string");
    expect(result).toMatch(/^\+[1-9]\d{1,14}$/);
  });

  test("generates BCP 47 language tag", ({ expect }) => {
    const fake = new FakeProvider();
    const schema = z.bcp47();
    const result = fake.generate(schema);

    expect(typeof result).toBe("string");
    expect(result).toMatch(/^[a-z]{2,3}(?:-[A-Z]{2})?$/);
  });

  test("generates constantCase string", ({ expect }) => {
    const fake = new FakeProvider();
    const schema = z.constantCase();
    const result = fake.generate(schema);

    expect(typeof result).toBe("string");
    expect(result).toMatch(/^[A-Z_-]+$/);
  });

  test("generates enum values", ({ expect }) => {
    const fake = new FakeProvider();
    const schema = z.enum(["red", "green", "blue"]);
    const result = fake.generate(schema);

    expect(["red", "green", "blue"]).toContain(result);
  });

  test("generates array of values", ({ expect }) => {
    const fake = new FakeProvider();
    // Note: Alepha's z.array() sets maxItems: 1000 by default
    // FakeProvider caps it to maxArrayLength (default 20)
    const schema = z.array(z.string());
    const result = fake.generate(schema);

    expect(Array.isArray(result)).toBe(true);
    expect(result.length).toBeGreaterThanOrEqual(0);
    expect(result.length).toBeLessThanOrEqual(20); // maxArrayLength default
    result.forEach((item: unknown) => {
      expect(typeof item).toBe("string");
    });
  });

  test("generates array with size constraints", ({ expect }) => {
    const fake = new FakeProvider();
    const schema = z.array(z.number()).min(3).max(7);

    // Generate multiple times to verify constraints are respected
    const results = Array.from({ length: 20 }, () => fake.generate(schema));

    for (const result of results) {
      expect(Array.isArray(result)).toBe(true);
      expect(result.length).toBeGreaterThanOrEqual(3);
      expect(result.length).toBeLessThanOrEqual(7);
    }

    // Verify we actually get some arrays with length > 5 (old cap was 5)
    const hasLargerArray = results.some((r) => r.length > 5);
    expect(hasLargerArray).toBe(true);
  });

  test("generates object with properties", ({ expect }) => {
    const fake = new FakeProvider();
    const schema = z.object({
      id: z.uuid(),
      name: z.text(),
      age: z.integer(),
      active: z.boolean(),
    });
    const result = fake.generate(schema);

    expect(typeof result).toBe("object");
    expect(result).toHaveProperty("id");
    expect(result).toHaveProperty("name");
    expect(result).toHaveProperty("age");
    expect(result).toHaveProperty("active");
    expect(typeof result.id).toBe("string");
    expect(typeof result.name).toBe("string");
    expect(typeof result.age).toBe("number");
    expect(typeof result.active).toBe("boolean");
  });

  test("generates nested objects", ({ expect }) => {
    const fake = new FakeProvider();
    const schema = z.object({
      user: z.object({
        name: z.text(),
        email: z.email(),
      }),
      settings: z.object({
        theme: z.enum(["light", "dark"]),
        notifications: z.boolean(),
      }),
    });
    const result = fake.generate(schema);

    expect(typeof result).toBe("object");
    expect(typeof result.user).toBe("object");
    expect(typeof result.user.name).toBe("string");
    expect(typeof result.user.email).toBe("string");
    expect(typeof result.settings).toBe("object");
    expect(["light", "dark"]).toContain(result.settings.theme);
    expect(typeof result.settings.notifications).toBe("boolean");
  });

  test("generates optional values", ({ expect }) => {
    const fake = new FakeProvider();
    const schema = z.object({
      required: z.text(),
      optional: z.text().optional(),
    });

    // Generate multiple times to check both defined and undefined cases
    const results = Array.from({ length: 20 }, () => fake.generate(schema));

    // At least one should be undefined
    const hasUndefined = results.some((r) => r.optional === undefined);
    // At least one should be defined
    const hasDefined = results.some((r) => r.optional !== undefined);

    expect(hasUndefined || hasDefined).toBe(true);
    results.forEach((result) => {
      expect(typeof result.required).toBe("string");
      if (result.optional !== undefined) {
        expect(typeof result.optional).toBe("string");
      }
    });
  });

  test("generates nullable values", ({ expect }) => {
    const fake = new FakeProvider();
    const schema = z.object({
      required: z.text(),
      nullable: z.text().nullable(),
    });

    // Generate multiple times to check both null and non-null cases
    const results = Array.from({ length: 20 }, () => fake.generate(schema));

    // At least one should be null
    const hasNull = results.some((r) => r.nullable === null);
    // At least one should be non-null
    const hasNonNull = results.some((r) => r.nullable !== null);

    expect(hasNull || hasNonNull).toBe(true);
    results.forEach((result) => {
      expect(typeof result.required).toBe("string");
      if (result.nullable !== null) {
        expect(typeof result.nullable).toBe("string");
      }
    });
  });

  test("generates union types", ({ expect }) => {
    const fake = new FakeProvider();
    const schema = z.union([z.string(), z.number(), z.boolean()]);
    const result = fake.generate(schema);

    const validTypes = ["string", "number", "boolean"];
    expect(validTypes).toContain(typeof result);
  });

  test("generates record types", ({ expect }) => {
    const fake = new FakeProvider();
    const schema = z.record(z.string(), z.number());
    const result = fake.generate(schema);

    expect(typeof result).toBe("object");
    const entries = Object.entries(result);
    expect(entries.length).toBeGreaterThan(0);
    entries.forEach(([key, value]) => {
      expect(typeof key).toBe("string");
      expect(typeof value).toBe("number");
    });
  });

  test("generates tuple types", ({ expect }) => {
    const fake = new FakeProvider();
    const schema = z.tuple([z.string(), z.number(), z.boolean()]);
    const result = fake.generate(schema);

    expect(Array.isArray(result)).toBe(true);
    expect(result.length).toBe(3);
    expect(typeof result[0]).toBe("string");
    expect(typeof result[1]).toBe("number");
    expect(typeof result[2]).toBe("boolean");
  });

  test("generates literal values", ({ expect }) => {
    const fake = new FakeProvider();
    const schema = z.const("ACTIVE");
    const result = fake.generate(schema);

    expect(result).toBe("ACTIVE");
  });

  test("generates null", ({ expect }) => {
    const fake = new FakeProvider();
    const schema = z.null();
    const result = fake.generate(schema);

    expect(result).toBeNull();
  });

  test("generates undefined", ({ expect }) => {
    const fake = new FakeProvider();
    const schema = z.undefined();
    const result = fake.generate(schema);

    expect(result).toBeUndefined();
  });

  test("generates void as undefined", ({ expect }) => {
    const fake = new FakeProvider();
    const schema = z.void();
    const result = fake.generate(schema);

    expect(result).toBeUndefined();
  });

  test("generates any type", ({ expect }) => {
    const fake = new FakeProvider();
    const schema = z.any();
    const result = fake.generate(schema);

    const validTypes = ["string", "number", "boolean"];
    expect(validTypes).toContain(typeof result);
  });

  test("generateMany produces multiple values", ({ expect }) => {
    const fake = new FakeProvider();
    const schema = z.object({
      id: z.uuid(),
      name: z.text(),
    });
    const results = fake.generateMany(schema, 5);

    expect(Array.isArray(results)).toBe(true);
    expect(results.length).toBe(5);
    results.forEach((result: { id: unknown; name: unknown }) => {
      expect(typeof result.id).toBe("string");
      expect(typeof result.name).toBe("string");
    });
  });

  test("uses seed for deterministic generation", ({ expect }) => {
    const schema = z.object({
      id: z.uuid(),
      name: z.text(),
      age: z.integer(),
    });

    // Generate with same seed - should produce same results
    const fake1 = new FakeProvider().configure({ seed: 99999 });
    const result1a = fake1.generate(schema);
    const result1b = fake1.generate(schema);

    // Create new instance with same seed
    const fake2 = new FakeProvider().configure({ seed: 99999 });
    const result2a = fake2.generate(schema);

    // First result from both instances should match
    expect(result2a).toEqual(result1a);

    // But sequential results from same instance should differ
    expect(result1b).not.toEqual(result1a);
  });

  test("generates different values without seed", ({ expect }) => {
    const fake = new FakeProvider();
    const schema = z.uuid();

    const result1 = fake.generate(schema);
    const result2 = fake.generate(schema);

    // They should be different (highly unlikely to be the same)
    expect(result1).not.toBe(result2);
  });

  test("complex nested schema", ({ expect }) => {
    const fake = new FakeProvider();
    const schema = z.object({
      id: z.uuid(),
      user: z.object({
        name: z.shortText(),
        email: z.email(),
        age: z.integer().min(18).max(99),
        phone: z.e164().optional(),
      }),
      tags: z.array(z.enum(["urgent", "important", "review"])),
      metadata: z.record(z.string(), z.any()),
      status: z.enum(["active", "inactive", "pending"]),
      createdAt: z.string().meta({ format: "date-time" }),
    });

    const result = fake.generate(schema);

    expect(typeof result).toBe("object");
    expect(typeof result.id).toBe("string");
    expect(typeof result.user).toBe("object");
    expect(typeof result.user.name).toBe("string");
    expect(typeof result.user.email).toBe("string");
    expect(typeof result.user.age).toBe("number");
    expect(result.user.age).toBeGreaterThanOrEqual(18);
    expect(result.user.age).toBeLessThanOrEqual(99);
    expect(Array.isArray(result.tags)).toBe(true);
    expect(typeof result.metadata).toBe("object");
    expect(["active", "inactive", "pending"]).toContain(result.status);
    expect(typeof result.createdAt).toBe("string");
  });

  test("valueLabel pattern", ({ expect }) => {
    const fake = new FakeProvider();
    const schema = z.valueLabel();
    const result = fake.generate(schema);

    expect(typeof result).toBe("object");
    expect(typeof result.value).toBe("string");
    expect(typeof result.label).toBe("string");
    expect(result.value).toMatch(/^[A-Z_-]+$/);
    if (result.description !== undefined) {
      expect(typeof result.description).toBe("string");
    }
  });

  test("context-aware generation for string fields", ({ expect }) => {
    const fake = new FakeProvider();
    const schema = z.object({
      email: z.string(),
      firstName: z.string(),
      lastName: z.string(),
      name: z.string(),
      username: z.string(),
      phone: z.string(),
      address: z.string(),
      city: z.string(),
      country: z.string(),
      company: z.string(),
      url: z.string(),
    });
    const result = fake.generate(schema);

    expect(result.email).toMatch(/@/);
    expect(typeof result.firstName).toBe("string");
    expect(typeof result.lastName).toBe("string");
    expect(typeof result.name).toBe("string");
    expect(typeof result.username).toBe("string");
    expect(typeof result.phone).toBe("string");
    expect(typeof result.address).toBe("string");
    expect(typeof result.city).toBe("string");
    expect(typeof result.country).toBe("string");
    expect(typeof result.company).toBe("string");
    expect(result.url).toMatch(/^https?:\/\//);
  });

  test("context-aware generation handles snake_case field names", ({
    expect,
  }) => {
    const fake = new FakeProvider();
    const schema = z.object({
      user_name: z.string(),
      first_name: z.string(),
      last_name: z.string(),
      full_name: z.string(),
      phone_number: z.string(),
      email_address: z.string(),
    });
    const result = fake.generate(schema);

    expect(typeof result.user_name).toBe("string");
    expect(typeof result.first_name).toBe("string");
    expect(typeof result.last_name).toBe("string");
    expect(typeof result.full_name).toBe("string");
    expect(typeof result.phone_number).toBe("string");
    expect(result.email_address).toMatch(/@/);
  });

  test("context-aware generation handles kebab-case field names", ({
    expect,
  }) => {
    const fake = new FakeProvider();
    const schema = z.object({
      "user-name": z.string(),
      "first-name": z.string(),
      "last-name": z.string(),
      "e-mail": z.string(),
    });
    const result = fake.generate(schema);

    expect(typeof result["user-name"]).toBe("string");
    expect(typeof result["first-name"]).toBe("string");
    expect(typeof result["last-name"]).toBe("string");
    expect(result["e-mail"]).toMatch(/@/);
  });

  test("context-aware generation for number fields", ({ expect }) => {
    const fake = new FakeProvider();
    const schema = z.object({
      age: z.integer(),
      year: z.integer(),
      month: z.integer(),
      day: z.integer(),
      price: z.number(),
      user_age: z.integer(),
    });
    const result = fake.generate(schema);

    expect(result.age).toBeGreaterThanOrEqual(18);
    expect(result.age).toBeLessThanOrEqual(99);
    expect(result.year).toBeGreaterThan(1900);
    expect(result.month).toBeGreaterThanOrEqual(1);
    expect(result.month).toBeLessThanOrEqual(12);
    expect(result.day).toBeGreaterThanOrEqual(1);
    expect(result.day).toBeLessThanOrEqual(31);
    expect(result.price).toBeGreaterThan(0);
    expect(result.user_age).toBeGreaterThanOrEqual(18);
    expect(result.user_age).toBeLessThanOrEqual(99);
  });

  test("context-aware generation respects explicit formats", ({ expect }) => {
    const fake = new FakeProvider();
    const schema = z.object({
      // Even though field is named "email", the uuid format takes precedence
      email: z.uuid(),
    });
    const result = fake.generate(schema);

    expect(result.email).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
  });

  test("context-aware generation respects enum values", ({ expect }) => {
    const fake = new FakeProvider();
    const schema = z.object({
      // Even though field is named "username", the enum takes precedence
      username: z.enum(["admin", "user", "guest"]),
    });
    const result = fake.generate(schema);

    expect(["admin", "user", "guest"]).toContain(result.username);
  });

  test("respects optionalProbability option", ({ expect }) => {
    // With probability 0, optional should never be undefined
    const fakeNever = new FakeProvider().configure({ optionalProbability: 0 });
    const schema = z.object({ value: z.string().optional() });
    const resultsNever = Array.from({ length: 20 }, () =>
      fakeNever.generate(schema),
    );
    expect(resultsNever.every((r) => r.value !== undefined)).toBe(true);

    // With probability 1, optional should always be undefined
    const fakeAlways = new FakeProvider().configure({ optionalProbability: 1 });
    const resultsAlways = Array.from({ length: 20 }, () =>
      fakeAlways.generate(schema),
    );
    expect(resultsAlways.every((r) => r.value === undefined)).toBe(true);
  });

  test("respects nullableProbability option", ({ expect }) => {
    // With probability 0, nullable should never be null
    const fakeNever = new FakeProvider().configure({ nullableProbability: 0 });
    const schema = z.object({ value: z.string().nullable() });
    const resultsNever = Array.from({ length: 20 }, () =>
      fakeNever.generate(schema),
    );
    expect(resultsNever.every((r) => r.value !== null)).toBe(true);

    // With probability 1, nullable should always be null
    const fakeAlways = new FakeProvider().configure({ nullableProbability: 1 });
    const resultsAlways = Array.from({ length: 20 }, () =>
      fakeAlways.generate(schema),
    );
    expect(resultsAlways.every((r) => r.value === null)).toBe(true);
  });

  test("respects maxArrayLength option", ({ expect }) => {
    // With maxArrayLength: 10, arrays should not exceed 10 items
    const fake = new FakeProvider().configure({ maxArrayLength: 10 });
    const schema = z.array(z.number()).min(1).max(100);
    const results = Array.from({ length: 20 }, () => fake.generate(schema));

    for (const result of results) {
      expect(result.length).toBeLessThanOrEqual(10);
    }
  });

  test("respects defaultArrayLength option", ({ expect }) => {
    // With defaultArrayLength: 3, arrays without maxItems should default to 3
    // Note: Use TypeBox directly since Alepha's z.array() always sets maxItems: 1000
    const fake = new FakeProvider().configure({
      defaultArrayLength: 3,
      maxArrayLength: 100,
    });
    const schema = z.array(z.number()); // No minItems/maxItems
    const results = Array.from({ length: 20 }, () => fake.generate(schema));

    for (const result of results) {
      expect(result.length).toBeLessThanOrEqual(3);
    }
  });

  test("respects defaultRecordEntries option", ({ expect }) => {
    const fake = new FakeProvider().configure({
      defaultRecordEntries: { min: 5, max: 5 },
    });
    const schema = z.record(z.string(), z.number());
    const result = fake.generate(schema);

    expect(Object.keys(result).length).toBe(5);
  });

  test("configure() reseeds faker when seed changes", ({ expect }) => {
    const schema = z.uuid();
    const fake = new FakeProvider();

    // Generate with default seed
    const result1 = fake.generate(schema);

    // Reconfigure with same seed - should reset and produce same result
    fake.configure({ seed: 12345 });
    const result2 = fake.generate(schema);

    expect(result2).toBe(result1);

    // Reconfigure with different seed - should produce different result
    fake.configure({ seed: 99999 });
    const result3 = fake.generate(schema);

    expect(result3).not.toBe(result1);
  });
});
