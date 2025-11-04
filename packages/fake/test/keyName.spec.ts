import { t } from "@alepha/core";
import { describe, test } from "vitest";
import { FakeProvider } from "../src/providers/FakeProvider.ts";

describe("FakeProvider - Key Name Intelligence", () => {
  test("generates contextual data based on key names", ({ expect }) => {
    const fake = new FakeProvider({ seed: 12345 });
    const schema = t.object({
      firstName: t.text(),
      lastName: t.text(),
      email: t.text(),
      age: t.int(),
      phone: t.text(),
      address: t.text(),
      city: t.text(),
      company: t.text(),
      username: t.text(),
    });

    const result = fake.generate(schema);

    // Verify types
    expect(typeof result.firstName).toBe("string");
    expect(typeof result.lastName).toBe("string");
    expect(typeof result.email).toBe("string");
    expect(typeof result.age).toBe("number");
    expect(typeof result.phone).toBe("string");
    expect(typeof result.address).toBe("string");
    expect(typeof result.city).toBe("string");
    expect(typeof result.company).toBe("string");
    expect(typeof result.username).toBe("string");

    // Verify email format (basic check)
    expect(result.email).toMatch(/@/);

    // Verify age is in expected range for context-aware generation
    expect(result.age).toBeGreaterThanOrEqual(18);
    expect(result.age).toBeLessThanOrEqual(99);
  });

  test("format takes precedence over key name", ({ expect }) => {
    const fake = new FakeProvider({ seed: 12345 });
    const schema = t.object({
      // Even though key is "email", format: uuid should generate UUID
      email: t.uuid(),
      // Even though key is "id", format: email should generate email
      id: t.email(),
    });

    const result = fake.generate(schema);

    // email field should be UUID format
    expect(result.email).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );

    // id field should be email format
    expect(result.id).toMatch(/@/);
  });

  test("enum values ignore key name context", ({ expect }) => {
    const fake = new FakeProvider({ seed: 12345 });
    const schema = t.object({
      // Even though key is "email", enum should pick from values
      email: t.enum(["user1", "user2", "user3"]),
    });

    const result = fake.generate(schema);

    expect(["user1", "user2", "user3"]).toContain(result.email);
    // Should NOT be an email format
    expect(result.email).not.toMatch(/@/);
  });

  test("generates realistic user profiles", ({ expect }) => {
    const fake = new FakeProvider({ seed: 67890 });
    const userSchema = t.object({
      firstName: t.shortText(),
      lastName: t.shortText(),
      fullName: t.text(),
      email: t.text(),
      username: t.text(),
      age: t.int(),
      bio: t.longText(),
      avatar: t.text(),
      website: t.text(),
      jobTitle: t.text(),
      company: t.text(),
      address: t.text(),
      city: t.text(),
      state: t.text(),
      country: t.text(),
      zipCode: t.text(),
      phone: t.text(),
    });

    const user = fake.generate(userSchema);

    // Verify structure
    expect(typeof user.firstName).toBe("string");
    expect(typeof user.lastName).toBe("string");
    expect(typeof user.fullName).toBe("string");
    expect(typeof user.email).toBe("string");
    expect(typeof user.username).toBe("string");
    expect(typeof user.age).toBe("number");
    expect(typeof user.bio).toBe("string");
    expect(typeof user.avatar).toBe("string");
    expect(typeof user.website).toBe("string");
    expect(typeof user.jobTitle).toBe("string");
    expect(typeof user.company).toBe("string");
    expect(typeof user.address).toBe("string");
    expect(typeof user.city).toBe("string");
    expect(typeof user.state).toBe("string");
    expect(typeof user.country).toBe("string");
    expect(typeof user.zipCode).toBe("string");
    expect(typeof user.phone).toBe("string");

    // Check some specific patterns
    expect(user.email).toMatch(/@/);
    expect(user.website).toMatch(/^https?:\/\//);
  });

  test("numeric key names influence generation", ({ expect }) => {
    const fake = new FakeProvider({ seed: 12345 });
    const schema = t.object({
      age: t.int(),
      year: t.int(),
      month: t.int(),
      day: t.int(),
      price: t.number(),
      amount: t.number(),
    });

    const result = fake.generate(schema);

    // Age should be in realistic range
    expect(result.age).toBeGreaterThanOrEqual(18);
    expect(result.age).toBeLessThanOrEqual(99);

    // Month should be 1-12
    expect(result.month).toBeGreaterThanOrEqual(1);
    expect(result.month).toBeLessThanOrEqual(12);

    // Day should be 1-31
    expect(result.day).toBeGreaterThanOrEqual(1);
    expect(result.day).toBeLessThanOrEqual(31);

    // Price/amount should be positive
    expect(result.price).toBeGreaterThan(0);
    expect(result.amount).toBeGreaterThan(0);
  });
});
