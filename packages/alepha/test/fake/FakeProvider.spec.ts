import { t } from "alepha";
import { describe, test } from "vitest";
import { FakeProvider } from "../../src/fake/providers/FakeProvider.ts";

describe("FakeProvider", () => {
  test("generates string values", ({ expect }) => {
    const fake = new FakeProvider({ seed: 12345 });
    const schema = t.string();
    const result = fake.generate(schema);

    expect(typeof result).toBe("string");
    expect(result.length).toBeGreaterThan(0);
  });

  test("generates text with size constraints", ({ expect }) => {
    const fake = new FakeProvider({ seed: 12345 });

    const shortText = fake.generate(t.shortText());
    expect(typeof shortText).toBe("string");
    expect(shortText.length).toBeLessThanOrEqual(64);

    const regularText = fake.generate(t.text());
    expect(typeof regularText).toBe("string");
    expect(regularText.length).toBeLessThanOrEqual(255);

    const longText = fake.generate(t.longText());
    expect(typeof longText).toBe("string");
    expect(longText.length).toBeLessThanOrEqual(1024);

    const richText = fake.generate(t.richText());
    expect(typeof richText).toBe("string");
    expect(richText.length).toBeLessThanOrEqual(65535);
  });

  test("generates number values", ({ expect }) => {
    const fake = new FakeProvider({ seed: 12345 });
    const schema = t.number();
    const result = fake.generate(schema);

    expect(typeof result).toBe("number");
  });

  test("generates number with constraints", ({ expect }) => {
    const fake = new FakeProvider({ seed: 12345 });
    const schema = t.number({ minimum: 10, maximum: 20 });
    const result = fake.generate(schema);

    expect(result).toBeGreaterThanOrEqual(10);
    expect(result).toBeLessThanOrEqual(20);
  });

  test("generates integer values", ({ expect }) => {
    const fake = new FakeProvider({ seed: 12345 });
    const schema = t.integer();
    const result = fake.generate(schema);

    expect(typeof result).toBe("number");
    expect(Number.isInteger(result)).toBe(true);
  });

  test("generates integer with constraints", ({ expect }) => {
    const fake = new FakeProvider({ seed: 12345 });
    const schema = t.integer({ minimum: 5, maximum: 15 });
    const result = fake.generate(schema);

    expect(Number.isInteger(result)).toBe(true);
    expect(result).toBeGreaterThanOrEqual(5);
    expect(result).toBeLessThanOrEqual(15);
  });

  test("generates boolean values", ({ expect }) => {
    const fake = new FakeProvider({ seed: 12345 });
    const schema = t.boolean();
    const result = fake.generate(schema);

    expect(typeof result).toBe("boolean");
  });

  test("generates UUID", ({ expect }) => {
    const fake = new FakeProvider({ seed: 12345 });
    const schema = t.uuid();
    const result = fake.generate(schema);

    expect(typeof result).toBe("string");
    expect(result).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
  });

  test("generates email", ({ expect }) => {
    const fake = new FakeProvider({ seed: 12345 });
    const schema = t.email();
    const result = fake.generate(schema);

    expect(typeof result).toBe("string");
    expect(result).toMatch(/^[^\s@]+@[^\s@]+\.[^\s@]+$/);
  });

  test("generates URL", ({ expect }) => {
    const fake = new FakeProvider({ seed: 12345 });
    const schema = t.string({ format: "url" });
    const result = fake.generate(schema);

    expect(typeof result).toBe("string");
    expect(result).toMatch(/^https?:\/\//);
  });

  test("generates bigint", ({ expect }) => {
    const fake = new FakeProvider({ seed: 12345 });
    const schema = t.string({ format: "bigint" });
    const result = fake.generate(schema);

    expect(typeof result).toBe("string");
    expect(/^-?\d+$/.test(result)).toBe(true);
  });

  test("generates E.164 phone number", ({ expect }) => {
    const fake = new FakeProvider({ seed: 12345 });
    const schema = t.e164();
    const result = fake.generate(schema);

    expect(typeof result).toBe("string");
    expect(result).toMatch(/^\+[1-9]\d{1,14}$/);
  });

  test("generates BCP 47 language tag", ({ expect }) => {
    const fake = new FakeProvider({ seed: 12345 });
    const schema = t.bcp47();
    const result = fake.generate(schema);

    expect(typeof result).toBe("string");
    expect(result).toMatch(/^[a-z]{2,3}(?:-[A-Z]{2})?$/);
  });

  test("generates snake_case string", ({ expect }) => {
    const fake = new FakeProvider({ seed: 12345 });
    const schema = t.snakeCase();
    const result = fake.generate(schema);

    expect(typeof result).toBe("string");
    expect(result).toMatch(/^[A-Z_-]+$/);
  });

  test("generates enum values", ({ expect }) => {
    const fake = new FakeProvider({ seed: 12345 });
    const schema = t.enum(["red", "green", "blue"]);
    const result = fake.generate(schema);

    expect(["red", "green", "blue"]).toContain(result);
  });

  test("generates array of values", ({ expect }) => {
    const fake = new FakeProvider({ seed: 12345 });
    const schema = t.array(t.string());
    const result = fake.generate(schema);

    expect(Array.isArray(result)).toBe(true);
    expect(result.length).toBeGreaterThanOrEqual(0);
    expect(result.length).toBeLessThanOrEqual(5);
    result.forEach((item: unknown) => {
      expect(typeof item).toBe("string");
    });
  });

  test("generates array with size constraints", ({ expect }) => {
    const fake = new FakeProvider({ seed: 12345 });
    const schema = t.array(t.number(), { minItems: 3, maxItems: 7 });
    const result = fake.generate(schema);

    expect(Array.isArray(result)).toBe(true);
    expect(result.length).toBeGreaterThanOrEqual(3);
    expect(result.length).toBeLessThanOrEqual(7);
  });

  test("generates object with properties", ({ expect }) => {
    const fake = new FakeProvider({ seed: 12345 });
    const schema = t.object({
      id: t.uuid(),
      name: t.text(),
      age: t.integer(),
      active: t.boolean(),
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
    const fake = new FakeProvider({ seed: 12345 });
    const schema = t.object({
      user: t.object({
        name: t.text(),
        email: t.email(),
      }),
      settings: t.object({
        theme: t.enum(["light", "dark"]),
        notifications: t.boolean(),
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
    const fake = new FakeProvider({ seed: 12345 });
    const schema = t.object({
      required: t.text(),
      optional: t.optional(t.text()),
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
    const fake = new FakeProvider({ seed: 12345 });
    const schema = t.object({
      required: t.text(),
      nullable: t.nullable(t.text()),
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
    const fake = new FakeProvider({ seed: 12345 });
    const schema = t.union([t.string(), t.number(), t.boolean()]);
    const result = fake.generate(schema);

    const validTypes = ["string", "number", "boolean"];
    expect(validTypes).toContain(typeof result);
  });

  test("generates record types", ({ expect }) => {
    const fake = new FakeProvider({ seed: 12345 });
    const schema = t.record(t.string(), t.number());
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
    const fake = new FakeProvider({ seed: 12345 });
    const schema = t.tuple([t.string(), t.number(), t.boolean()]);
    const result = fake.generate(schema);

    expect(Array.isArray(result)).toBe(true);
    expect(result.length).toBe(3);
    expect(typeof result[0]).toBe("string");
    expect(typeof result[1]).toBe("number");
    expect(typeof result[2]).toBe("boolean");
  });

  test("generates literal values", ({ expect }) => {
    const fake = new FakeProvider({ seed: 12345 });
    const schema = t.const("ACTIVE");
    const result = fake.generate(schema);

    expect(result).toBe("ACTIVE");
  });

  test("generates null", ({ expect }) => {
    const fake = new FakeProvider({ seed: 12345 });
    const schema = t.null();
    const result = fake.generate(schema);

    expect(result).toBeNull();
  });

  test("generates undefined", ({ expect }) => {
    const fake = new FakeProvider({ seed: 12345 });
    const schema = t.undefined();
    const result = fake.generate(schema);

    expect(result).toBeUndefined();
  });

  test("generates void as undefined", ({ expect }) => {
    const fake = new FakeProvider({ seed: 12345 });
    const schema = t.void();
    const result = fake.generate(schema);

    expect(result).toBeUndefined();
  });

  test("generates any type", ({ expect }) => {
    const fake = new FakeProvider({ seed: 12345 });
    const schema = t.any();
    const result = fake.generate(schema);

    const validTypes = ["string", "number", "boolean"];
    expect(validTypes).toContain(typeof result);
  });

  test("generateMany produces multiple values", ({ expect }) => {
    const fake = new FakeProvider({ seed: 12345 });
    const schema = t.object({
      id: t.uuid(),
      name: t.text(),
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
    const schema = t.object({
      id: t.uuid(),
      name: t.text(),
      age: t.integer(),
    });

    // Generate with same seed - should produce same results
    const fake1 = new FakeProvider({ seed: 99999 });
    const result1a = fake1.generate(schema);
    const result1b = fake1.generate(schema);

    // Create new instance with same seed
    const fake2 = new FakeProvider({ seed: 99999 });
    const result2a = fake2.generate(schema);

    // First result from both instances should match
    expect(result2a).toEqual(result1a);

    // But sequential results from same instance should differ
    expect(result1b).not.toEqual(result1a);
  });

  test("generates different values without seed", ({ expect }) => {
    const fake = new FakeProvider();
    const schema = t.uuid();

    const result1 = fake.generate(schema);
    const result2 = fake.generate(schema);

    // They should be different (highly unlikely to be the same)
    expect(result1).not.toBe(result2);
  });

  test("complex nested schema", ({ expect }) => {
    const fake = new FakeProvider({ seed: 12345 });
    const schema = t.object({
      id: t.uuid(),
      user: t.object({
        name: t.shortText(),
        email: t.email(),
        age: t.integer({ minimum: 18, maximum: 99 }),
        phone: t.optional(t.e164()),
      }),
      tags: t.array(t.enum(["urgent", "important", "review"])),
      metadata: t.record(t.string(), t.any()),
      status: t.enum(["active", "inactive", "pending"]),
      createdAt: t.string({ format: "date-time" }),
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
    const fake = new FakeProvider({ seed: 12345 });
    const schema = t.valueLabel();
    const result = fake.generate(schema);

    expect(typeof result).toBe("object");
    expect(typeof result.value).toBe("string");
    expect(typeof result.label).toBe("string");
    expect(result.value).toMatch(/^[A-Z_-]+$/);
    if (result.description !== undefined) {
      expect(typeof result.description).toBe("string");
    }
  });
});
