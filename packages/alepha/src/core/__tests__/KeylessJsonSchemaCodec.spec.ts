import { Alepha, z } from "alepha";
import { describe, test } from "vitest";
import { KeylessJsonSchemaCodec } from "../providers/KeylessJsonSchemaCodec.ts";

describe("KeylessJsonSchemaCodec", () => {
  describe("Basic types", () => {
    test("should encode and decode primitive types", async ({ expect }) => {
      const alepha = Alepha.create();

      const userSchema = z.object({
        name: z.text(),
        age: z.integer(),
        active: z.boolean(),
        score: z.number(),
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

      const userSchema = z.object({
        username: z.text(),
        email: z.text(),
        age: z.integer(),
        isVerified: z.boolean(),
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

      // In Alepha, z.bigint() is a string type with format "bigint"
      // It represents large integers as strings to avoid precision loss
      const schema = z.object({
        id: z.bigint(),
        name: z.text(),
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

      const schema = z.object({
        user: z.object({
          name: z.text(),
          profile: z.object({
            bio: z.text(),
            age: z.integer(),
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

      const schema = z.object({
        tags: z.array(z.text()),
        scores: z.array(z.number()),
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

      const schema = z.object({
        users: z.array(
          z.object({
            name: z.text(),
            age: z.integer(),
          }),
        ),
        socialProfiles: z.array(
          z.object({
            platform: z.text(),
            username: z.text(),
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

      const schema = z.object({
        name: z.text(),
        bio: z.text().optional(),
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

      const schema = z.object({
        name: z.text(),
        deletedAt: z.datetime().nullable(),
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

      const schema = z.object({
        status: z.enum(["ACTIVE", "INACTIVE", "PENDING"]),
        name: z.text(),
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

      const schema = z.object({
        name: z.text(),
        age: z.integer(),
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

      const schema = z.object({
        user: z.object({
          id: z.text(),
          profile: z.object({
            name: z.text(),
            age: z.integer().nullable(),
            tags: z.array(z.text()),
          }),
        }),
        status: z.enum(["ACTIVE", "INACTIVE"]),
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
      const comprehensiveSchema = z.object({
        // Primitive types
        id: z.integer(),
        uuid: z.uuid(),
        name: z.text(),
        email: z.text(),
        score: z.number(),
        isActive: z.boolean(),
        bigNumber: z.bigint(),

        // Date/time types (stored as strings)
        createdAt: z.datetime(),
        updatedAt: z.datetime(),

        // Enum type
        status: z.enum(["ACTIVE", "INACTIVE", "PENDING"]),
        role: z.enum(["USER", "ADMIN", "MODERATOR"]),

        // Optional fields
        nickname: z.text().optional(),
        bio: z.text().optional(),

        // Nullable fields
        deletedAt: z.datetime().nullable(),
        lastLoginAt: z.datetime().nullable(),

        // Arrays of primitives
        tags: z.array(z.text()),
        scores: z.array(z.number()),
        flags: z.array(z.boolean()),

        // Nested object
        profile: z.object({
          firstName: z.text(),
          lastName: z.text(),
          age: z.integer(),
        }),

        // Deeply nested objects
        settings: z.object({
          theme: z.text(),
          preferences: z.object({
            notifications: z.boolean(),
            emailAlerts: z.boolean(),
            language: z.text(),
          }),
        }),

        // Arrays of objects
        contacts: z.array(
          z.object({
            type: z.text(),
            value: z.text(),
          }),
        ),

        // Nested arrays of objects
        socialProfiles: z.array(
          z.object({
            platform: z.text(),
            username: z.text(),
            verified: z.boolean(),
          }),
        ),

        // Optional nested object
        address: z
          .object({
            street: z.text(),
            city: z.text(),
            country: z.text(),
            postalCode: z.text(),
          })
          .optional(),

        // Nullable nested object
        company: z
          .object({
            name: z.text(),
            position: z.text(),
          })
          .nullable(),
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

  describe("Safe Mode (Interpreted)", () => {
    test("should work correctly in safe mode", async ({ expect }) => {
      const alepha = Alepha.create();
      const codec = alepha.inject(KeylessJsonSchemaCodec);

      // Force safe mode (no Function compilation)
      codec.configure({ useFunctionCompilation: false });

      const schema = z.object({
        name: z.text(),
        age: z.integer(),
        active: z.boolean(),
      });

      const data = {
        name: "Alice",
        age: 30,
        active: true,
      };

      const encoded = codec.encodeToString(schema, data);
      expect(encoded).toBe('["Alice",30,true]');

      const decoded = codec.decode(schema, encoded);
      expect(decoded).toEqual(data);
    });

    test("should handle nested objects in safe mode", async ({ expect }) => {
      const alepha = Alepha.create();
      const codec = alepha.inject(KeylessJsonSchemaCodec);

      codec.configure({ useFunctionCompilation: false });

      const schema = z.object({
        user: z.object({
          name: z.text(),
          profile: z.object({
            bio: z.text(),
            age: z.integer(),
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

      const encoded = codec.encodeToString(schema, data);
      expect(encoded).toBe('[["Alice",["Developer",30]]]');

      const decoded = codec.decode(schema, encoded);
      expect(decoded).toEqual(data);
    });

    test("should handle arrays of objects in safe mode", async ({ expect }) => {
      const alepha = Alepha.create();
      const codec = alepha.inject(KeylessJsonSchemaCodec);

      codec.configure({ useFunctionCompilation: false });

      const schema = z.object({
        users: z.array(
          z.object({
            name: z.text(),
            age: z.integer(),
          }),
        ),
      });

      const data = {
        users: [
          { name: "Alice", age: 30 },
          { name: "Bob", age: 25 },
        ],
      };

      const encoded = codec.encodeToString(schema, data);
      const decoded = codec.decode(schema, encoded);
      expect(decoded).toEqual(data);
    });

    test("should handle optional fields in safe mode", async ({ expect }) => {
      const alepha = Alepha.create();
      const codec = alepha.inject(KeylessJsonSchemaCodec);

      codec.configure({ useFunctionCompilation: false });

      const schema = z.object({
        name: z.text(),
        bio: z.text().optional(),
      });

      // With optional field
      const dataWithBio = { name: "Alice", bio: "Developer" };
      const encodedWith = codec.encodeToString(schema, dataWithBio);
      const decodedWith = codec.decode(schema, encodedWith);
      expect(decodedWith).toEqual(dataWithBio);

      // Without optional field
      const dataWithoutBio = { name: "Bob" };
      const encodedWithout = codec.encodeToString(schema, dataWithoutBio);
      const decodedWithout = codec.decode<{ name: string; bio?: string }>(
        schema,
        encodedWithout,
      );
      expect(decodedWithout.name).toBe("Bob");
      expect(decodedWithout.bio).toBeUndefined();
    });

    test("should handle nullable fields in safe mode", async ({ expect }) => {
      const alepha = Alepha.create();
      const codec = alepha.inject(KeylessJsonSchemaCodec);

      codec.configure({ useFunctionCompilation: false });

      const schema = z.object({
        name: z.text(),
        deletedAt: z.datetime().nullable(),
      });

      // With null value
      const dataNull = { name: "Alice", deletedAt: null };
      const encodedNull = codec.encodeToString(schema, dataNull);
      const decodedNull = codec.decode<{
        name: string;
        deletedAt: string | null;
      }>(schema, encodedNull);
      expect(decodedNull.deletedAt).toBeNull();

      // With non-null value
      const dataValue = { name: "Bob", deletedAt: "2024-01-15T10:00:00Z" };
      const encodedValue = codec.encodeToString(schema, dataValue);
      const decodedValue = codec.decode(schema, encodedValue);
      expect(decodedValue).toEqual(dataValue);
    });
  });

  describe("Compiled Mode (Function)", () => {
    test("should work correctly in compiled mode", async ({ expect }) => {
      const alepha = Alepha.create();
      const codec = alepha.inject(KeylessJsonSchemaCodec);

      // Force compiled mode
      codec.configure({ useFunctionCompilation: true });

      const schema = z.object({
        name: z.text(),
        age: z.integer(),
        active: z.boolean(),
      });

      const data = {
        name: "Alice",
        age: 30,
        active: true,
      };

      const encoded = codec.encodeToString(schema, data);
      expect(encoded).toBe('["Alice",30,true]');

      const decoded = codec.decode(schema, encoded);
      expect(decoded).toEqual(data);
    });

    test("should produce same results as safe mode", async ({ expect }) => {
      const alepha = Alepha.create();

      const codecSafe = alepha.inject(KeylessJsonSchemaCodec);
      codecSafe.configure({ useFunctionCompilation: false });

      // Create a second Alepha instance for the compiled codec
      const alepha2 = Alepha.create();
      const codecCompiled = alepha2.inject(KeylessJsonSchemaCodec);
      codecCompiled.configure({ useFunctionCompilation: true });

      const schema = z.object({
        user: z.object({
          name: z.text(),
          age: z.integer(),
        }),
        tags: z.array(z.text()),
        active: z.boolean(),
      });

      const data = {
        user: { name: "Alice", age: 30 },
        tags: ["dev", "typescript"],
        active: true,
      };

      const encodedSafe = codecSafe.encodeToString(schema, data);
      const encodedCompiled = codecCompiled.encodeToString(schema, data);

      // Both modes should produce the same output
      expect(encodedSafe).toBe(encodedCompiled);

      const decodedSafe = codecSafe.decode(schema, encodedSafe);
      const decodedCompiled = codecCompiled.decode(schema, encodedCompiled);

      // Both modes should decode to the same result
      expect(decodedSafe).toEqual(data);
      expect(decodedCompiled).toEqual(data);
    });
  });

  describe("Configuration", () => {
    test("should allow configuring options", async ({ expect }) => {
      const alepha = Alepha.create();
      const codec = alepha.inject(KeylessJsonSchemaCodec);

      // Configure options
      codec.configure({
        useFunctionCompilation: false,
      });

      // Test that configuration works by encoding/decoding
      const schema = z.object({ name: z.text() });
      const data = { name: "test" };

      const encoded = codec.encodeToString(schema, data);
      const decoded = codec.decode(schema, encoded);

      expect(decoded).toEqual(data);
    });

    test("should clear cache when compilation mode changes", async ({
      expect,
    }) => {
      const alepha = Alepha.create();
      const codec = alepha.inject(KeylessJsonSchemaCodec);

      const schema = z.object({ name: z.text() });
      const data = { name: "test" };

      // Use compiled mode first
      codec.configure({ useFunctionCompilation: true });
      const encoded1 = codec.encodeToString(schema, data);

      // Switch to safe mode (cache should be cleared)
      codec.configure({ useFunctionCompilation: false });
      const encoded2 = codec.encodeToString(schema, data);

      // Both should produce the same result
      expect(encoded1).toBe(encoded2);
    });
  });

  describe("Unsupported schemas", () => {
    // The format is positional: it stores values, never keys. A union has no
    // single field order, and the codec used to silently pick the FIRST
    // variant — encoding a value of variant B with A's layout, which decodes
    // to wrong keys and dropped fields with no error at all. Refusing the
    // schema up front is the only honest answer until a tagged encoding
    // exists.
    test("should refuse a schema containing a union", async ({ expect }) => {
      const alepha = Alepha.create();
      const codec = alepha.inject(KeylessJsonSchemaCodec);

      const schema = z.object({
        payload: z.union([
          z.object({ kind: z.literal("a"), x: z.text() }),
          z.object({ kind: z.literal("b"), y: z.text() }),
        ]),
      });

      expect(() =>
        codec.encodeToString(schema, { payload: { kind: "a", x: "1" } }),
      ).toThrow(/union/i);
    });

    test("should refuse a top-level optional object schema", async ({
      expect,
    }) => {
      const alepha = Alepha.create();
      const codec = alepha.inject(KeylessJsonSchemaCodec);

      // Encodes flat but decodes as a single slot — verified to round-trip
      // `{a:1,b:"x"}` into `{a:1,b:1}`.
      const schema = z.object({ a: z.integer(), b: z.text() }).optional();

      expect(() =>
        codec.encodeToString(schema as any, { a: 1, b: "x" }),
      ).toThrow(/top-level/i);
    });

    test("should still accept optional and nullable fields", async ({
      expect,
    }) => {
      const alepha = Alepha.create();
      const codec = alepha.inject(KeylessJsonSchemaCodec);

      const schema = z.object({
        name: z.text(),
        bio: z.text().optional(),
        age: z.integer().nullable(),
      });

      expect(() =>
        codec.encodeToString(schema, { name: "a", bio: undefined, age: null }),
      ).not.toThrow();
    });
  });
});
