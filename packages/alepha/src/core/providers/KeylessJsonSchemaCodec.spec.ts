import { Alepha, t } from "alepha";
import { describe, test } from "vitest";

describe("KeylessJsonSchemaCodec", () => {
  describe("Basic types", () => {
    test("should encode and decode primitive types", async ({ expect }) => {
      const alepha = Alepha.create();

      const userSchema = t.object({
        name: t.text(),
        age: t.integer(),
        active: t.boolean(),
        score: t.number(),
      });

      const data = {
        name: "Alice",
        age: 30,
        active: true,
        score: 98.5,
      };

      const encoded = alepha.codec.encode(userSchema, data, {
        as: "string",
        encoder: "keyless",
      });

      // Keyless format is an array
      expect(encoded).toBe('["Alice",30,true,98.5]');

      const decoded = alepha.codec.decode(userSchema, encoded, {
        encoder: "keyless",
      });

      expect(decoded).toEqual(data);
    });

    test("should produce smaller output than JSON", async ({ expect }) => {
      const alepha = Alepha.create();

      const userSchema = t.object({
        username: t.text(),
        email: t.text(),
        age: t.integer(),
        isVerified: t.boolean(),
      });

      const data = {
        username: "john_doe",
        email: "john@example.com",
        age: 25,
        isVerified: true,
      };

      const jsonEncoded = alepha.codec.encode(userSchema, data, {
        as: "string",
        encoder: "json",
      });

      const keylessEncoded = alepha.codec.encode(userSchema, data, {
        as: "string",
        encoder: "keyless",
      });

      // Keyless should be smaller (no keys)
      expect(keylessEncoded.length).toBeLessThan(jsonEncoded.length);

      // Both should decode to same data
      const jsonDecoded = alepha.codec.decode(userSchema, jsonEncoded, {
        encoder: "json",
      });
      const keylessDecoded = alepha.codec.decode(userSchema, keylessEncoded, {
        encoder: "keyless",
      });

      expect(jsonDecoded).toEqual(data);
      expect(keylessDecoded).toEqual(data);
    });

    test("should handle bigint values as strings", async ({ expect }) => {
      const alepha = Alepha.create();

      // In Alepha, t.bigint() is a string type with format "bigint"
      // It represents large integers as strings to avoid precision loss
      const schema = t.object({
        id: t.bigint(),
        name: t.text(),
      });

      const data = {
        id: "9007199254740993",
        name: "Test",
      };

      const encoded = alepha.codec.encode(schema, data, {
        as: "string",
        encoder: "keyless",
      });

      // BigInt in Alepha is stored as a string
      expect(encoded).toBe('["9007199254740993","Test"]');

      const decoded = alepha.codec.decode(schema, encoded, {
        encoder: "keyless",
      });

      expect(decoded.id).toBe("9007199254740993");
      expect(decoded.name).toBe("Test");
    });
  });

  describe("Nested objects", () => {
    test("should handle nested objects", async ({ expect }) => {
      const alepha = Alepha.create();

      const schema = t.object({
        user: t.object({
          name: t.text(),
          profile: t.object({
            bio: t.text(),
            age: t.integer(),
          }),
        }),
      });

      const data = {
        user: {
          name: "Alice",
          profile: {
            bio: "Developer",
            age: 30,
          },
        },
      };

      const encoded = alepha.codec.encode(schema, data, {
        as: "string",
        encoder: "keyless",
      });

      // Nested objects become nested arrays
      expect(encoded).toBe('[["Alice",["Developer",30]]]');

      const decoded = alepha.codec.decode(schema, encoded, {
        encoder: "keyless",
      });

      expect(decoded).toEqual(data);
    });
  });

  describe("Arrays", () => {
    test("should handle arrays of primitives", async ({ expect }) => {
      const alepha = Alepha.create();

      const schema = t.object({
        tags: t.array(t.text()),
        scores: t.array(t.number()),
      });

      const data = {
        tags: ["typescript", "nodejs"],
        scores: [95.5, 88.0, 92.3],
      };

      const encoded = alepha.codec.encode(schema, data, {
        as: "string",
        encoder: "keyless",
      });

      const decoded = alepha.codec.decode(schema, encoded, {
        encoder: "keyless",
      });

      expect(decoded).toEqual(data);
    });

    test("should handle arrays of objects", async ({ expect }) => {
      const alepha = Alepha.create();

      const schema = t.object({
        users: t.array(
          t.object({
            name: t.text(),
            age: t.integer(),
          }),
        ),
        socialProfiles: t.array(
          t.object({
            platform: t.text(),
            username: t.text(),
          }),
        ),
      });

      const data = {
        users: [
          { name: "Alice", age: 30 },
          { name: "Bob", age: 25 },
        ],
        socialProfiles: [
          { platform: "twitter", username: "alice" },
          { platform: "github", username: "alice123" },
        ],
      };

      const encoded = alepha.codec.encode(schema, data, {
        as: "string",
        encoder: "keyless",
      });

      // Arrays of objects should be encoded as nested arrays
      expect(encoded).toBe(
        '[[["Alice",30],["Bob",25]],[["twitter","alice"],["github","alice123"]]]',
      );

      const decoded = alepha.codec.decode(schema, encoded, {
        encoder: "keyless",
      });

      expect(decoded).toEqual(data);
    });
  });

  describe("Optional and nullable types", () => {
    test("should handle optional fields", async ({ expect }) => {
      const alepha = Alepha.create();

      const schema = t.object({
        name: t.text(),
        bio: t.optional(t.text()),
      });

      const dataWithBio = {
        name: "Alice",
        bio: "Developer",
      };

      const dataWithoutBio = {
        name: "Bob",
      };

      // With optional field present
      const encodedWith = alepha.codec.encode(schema, dataWithBio, {
        as: "string",
        encoder: "keyless",
      });
      const decodedWith = alepha.codec.decode(schema, encodedWith, {
        encoder: "keyless",
      });
      expect(decodedWith).toEqual(dataWithBio);

      // With optional field missing
      const encodedWithout = alepha.codec.encode(schema, dataWithoutBio, {
        as: "string",
        encoder: "keyless",
      });
      const decodedWithout = alepha.codec.decode(schema, encodedWithout, {
        encoder: "keyless",
      });
      expect(decodedWithout.name).toBe("Bob");
      expect(decodedWithout.bio).toBeUndefined();
    });

    test("should handle nullable fields", async ({ expect }) => {
      const alepha = Alepha.create();

      const schema = t.object({
        name: t.text(),
        deletedAt: t.nullable(t.datetime()),
      });

      const activeUser = {
        name: "Alice",
        deletedAt: null,
      };

      const deletedUser = {
        name: "Bob",
        deletedAt: "2024-01-15T10:00:00Z",
      };

      // Active user (null deletedAt)
      const encodedActive = alepha.codec.encode(schema, activeUser, {
        as: "string",
        encoder: "keyless",
      });
      const decodedActive = alepha.codec.decode(schema, encodedActive, {
        encoder: "keyless",
      });
      expect(decodedActive.name).toBe("Alice");
      expect(decodedActive.deletedAt).toBeNull();

      // Deleted user (non-null deletedAt)
      const encodedDeleted = alepha.codec.encode(schema, deletedUser, {
        as: "string",
        encoder: "keyless",
      });
      const decodedDeleted = alepha.codec.decode(schema, encodedDeleted, {
        encoder: "keyless",
      });
      expect(decodedDeleted).toEqual(deletedUser);
    });
  });

  describe("Enums", () => {
    test("should handle enum values", async ({ expect }) => {
      const alepha = Alepha.create();

      const schema = t.object({
        status: t.enum(["ACTIVE", "INACTIVE", "PENDING"]),
        name: t.text(),
      });

      const data = {
        status: "ACTIVE",
        name: "Test",
      };

      const encoded = alepha.codec.encode(schema, data, {
        as: "string",
        encoder: "keyless",
      });

      const decoded = alepha.codec.decode(schema, encoded, {
        encoder: "keyless",
      });

      expect(decoded).toEqual(data);
    });
  });

  describe("Binary encoding", () => {
    test("should encode and decode binary format", async ({ expect }) => {
      const alepha = Alepha.create();

      const schema = t.object({
        name: t.text(),
        age: t.integer(),
      });

      const data = {
        name: "Alice",
        age: 30,
      };

      const binary = alepha.codec.encode(schema, data, {
        as: "binary",
        encoder: "keyless",
      });

      expect(binary).toBeInstanceOf(Uint8Array);

      const decoded = alepha.codec.decode(schema, binary, {
        encoder: "keyless",
      });

      expect(decoded).toEqual(data);
    });
  });

  describe("Complex schemas", () => {
    test("should handle complex nested structures", async ({ expect }) => {
      const alepha = Alepha.create();

      const schema = t.object({
        user: t.object({
          id: t.text(),
          profile: t.object({
            name: t.text(),
            age: t.nullable(t.integer()),
            tags: t.array(t.text()),
          }),
        }),
        status: t.enum(["ACTIVE", "INACTIVE"]),
      });

      const data = {
        user: {
          id: "123",
          profile: {
            name: "Alice",
            age: 30,
            tags: ["developer", "typescript"],
          },
        },
        status: "ACTIVE",
      };

      const encoded = alepha.codec.encode(schema, data, {
        as: "string",
        encoder: "keyless",
      });

      const decoded = alepha.codec.decode(schema, encoded, {
        encoder: "keyless",
      });

      expect(decoded).toEqual(data);
    });

    test("should handle comprehensive schema with all types", async ({
      expect,
    }) => {
      const alepha = Alepha.create();

      // Comprehensive schema with all supported types
      const comprehensiveSchema = t.object({
        // Primitive types
        id: t.integer(),
        uuid: t.uuid(),
        name: t.text(),
        email: t.text(),
        score: t.number(),
        isActive: t.boolean(),
        bigNumber: t.bigint(),

        // Date/time types (stored as strings)
        createdAt: t.datetime(),
        updatedAt: t.datetime(),

        // Enum type
        status: t.enum(["ACTIVE", "INACTIVE", "PENDING"]),
        role: t.enum(["USER", "ADMIN", "MODERATOR"]),

        // Optional fields
        nickname: t.optional(t.text()),
        bio: t.optional(t.text()),

        // Nullable fields
        deletedAt: t.nullable(t.datetime()),
        lastLoginAt: t.nullable(t.datetime()),

        // Arrays of primitives
        tags: t.array(t.text()),
        scores: t.array(t.number()),
        flags: t.array(t.boolean()),

        // Nested object
        profile: t.object({
          firstName: t.text(),
          lastName: t.text(),
          age: t.integer(),
        }),

        // Deeply nested objects
        settings: t.object({
          theme: t.text(),
          preferences: t.object({
            notifications: t.boolean(),
            emailAlerts: t.boolean(),
            language: t.text(),
          }),
        }),

        // Arrays of objects
        contacts: t.array(
          t.object({
            type: t.text(),
            value: t.text(),
          }),
        ),

        // Nested arrays of objects
        socialProfiles: t.array(
          t.object({
            platform: t.text(),
            username: t.text(),
            verified: t.boolean(),
          }),
        ),

        // Optional nested object
        address: t.optional(
          t.object({
            street: t.text(),
            city: t.text(),
            country: t.text(),
            postalCode: t.text(),
          }),
        ),

        // Nullable nested object
        company: t.nullable(
          t.object({
            name: t.text(),
            position: t.text(),
          }),
        ),
      });

      const fullData = {
        id: 12345,
        uuid: "550e8400-e29b-41d4-a716-446655440000",
        name: "John Doe",
        email: "john.doe@example.com",
        score: 98.75,
        isActive: true,
        bigNumber: "9007199254740993",
        createdAt: "2023-01-15T10:30:00Z",
        updatedAt: "2024-06-20T14:45:30Z",
        status: "ACTIVE",
        role: "ADMIN",
        nickname: "johnny",
        bio: "Software developer and tech enthusiast",
        deletedAt: null,
        lastLoginAt: "2024-06-20T14:00:00Z",
        tags: ["developer", "typescript", "nodejs", "premium"],
        scores: [95.5, 88.0, 92.3, 100.0],
        flags: [true, false, true, true],
        profile: {
          firstName: "John",
          lastName: "Doe",
          age: 35,
        },
        settings: {
          theme: "dark",
          preferences: {
            notifications: true,
            emailAlerts: false,
            language: "en-US",
          },
        },
        contacts: [
          { type: "phone", value: "+1234567890" },
          { type: "fax", value: "+0987654321" },
        ],
        socialProfiles: [
          { platform: "twitter", username: "johndoe", verified: true },
          { platform: "github", username: "johndoe123", verified: false },
          { platform: "linkedin", username: "john-doe", verified: true },
        ],
        address: {
          street: "123 Main Street",
          city: "San Francisco",
          country: "USA",
          postalCode: "94102",
        },
        company: {
          name: "Tech Corp",
          position: "Senior Developer",
        },
      };

      const encoded = alepha.codec.encode(comprehensiveSchema, fullData, {
        as: "string",
        encoder: "keyless",
      });

      const decoded = alepha.codec.decode(comprehensiveSchema, encoded, {
        encoder: "keyless",
      });

      expect(decoded).toEqual(fullData);

      // Test with missing optional fields
      const partialData = {
        id: 12345,
        uuid: "550e8400-e29b-41d4-a716-446655440000",
        name: "Jane Doe",
        email: "jane.doe@example.com",
        score: 85.5,
        isActive: false,
        bigNumber: "123456789",
        createdAt: "2023-02-20T08:00:00Z",
        updatedAt: "2024-05-15T12:30:00Z",
        status: "PENDING",
        role: "USER",
        // nickname and bio are omitted (optional)
        deletedAt: "2024-01-01T00:00:00Z", // not null this time
        lastLoginAt: null,
        tags: [],
        scores: [75.0],
        flags: [false],
        profile: {
          firstName: "Jane",
          lastName: "Doe",
          age: 28,
        },
        settings: {
          theme: "light",
          preferences: {
            notifications: false,
            emailAlerts: true,
            language: "fr-FR",
          },
        },
        contacts: [],
        socialProfiles: [
          { platform: "instagram", username: "janedoe", verified: false },
        ],
        // address is omitted (optional)
        company: null, // nullable field set to null
      };

      const encodedPartial = alepha.codec.encode(
        comprehensiveSchema,
        partialData,
        {
          as: "string",
          encoder: "keyless",
        },
      );

      const decodedPartial = alepha.codec.decode(
        comprehensiveSchema,
        encodedPartial,
        {
          encoder: "keyless",
        },
      );

      expect(decodedPartial).toEqual(partialData);

      // Verify size reduction
      const jsonSize = JSON.stringify(fullData).length;
      const keylessSize = encoded.length;
      expect(keylessSize).toBeLessThan(jsonSize);
    });
  });
});
