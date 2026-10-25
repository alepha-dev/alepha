import { Alepha, z } from "alepha";
import { describe, it } from "vitest";

import { AlephaProtobuf, ProtobufProvider } from "../index.ts";

const alepha = Alepha.create().with(AlephaProtobuf);
const protobuf = alepha.inject(ProtobufProvider);

describe("ProtobufProvider", () => {
  describe("Basic types", () => {
    it("should handle primitive types", async ({ expect }) => {
      const userSchema = z.object({
        username: z.text(),
        createdAt: z.datetime(),
        age: z.integer(),
        isActive: z.boolean(),
        score: z.number(),
        bigNumber: z.bigint(),
        level: z.integer(),
        points: z.integer(),
      });

      const schema = protobuf.createProtobufSchema(userSchema);
      expect(schema).toBe(
        `package root;
syntax = "proto3";

message Target {
  string username = 1;
  string createdAt = 2;
  int64 age = 3;
  bool isActive = 4;
  double score = 5;
  int64 bigNumber = 6;
  int64 level = 7;
  int64 points = 8;
}
`,
      );
    });

    it("should encode and decode primitive types", async ({ expect }) => {
      const userSchema = z.object({
        username: z.text(),
        createdAt: z.datetime(),
        age: z.integer(),
        isActive: z.boolean(),
      });

      const createdAt = new Date().toISOString();
      const data = {
        username: "John Doe",
        createdAt,
        age: 30,
        isActive: true,
      };
      const buf = alepha.codec.encode(userSchema, data, {
        as: "binary",
        encoder: "protobuf",
      });
      expect(buf).toBeInstanceOf(Uint8Array);

      const user = alepha.codec.decode(userSchema, buf, {
        encoder: "protobuf",
      });
      expect(user.username).toBe(data.username);
      expect(user.age).toBe(data.age);
      expect(user.isActive).toBe(data.isActive);
      expect(user.createdAt).toBe(createdAt);
    });
  });

  describe("Arrays", () => {
    it("should handle arrays of primitives", async ({ expect }) => {
      const schema = z.object({
        tags: z.array(z.text()),
        scores: z.array(z.number()),
        flags: z.array(z.boolean()),
      });

      const protoSchema = protobuf.createProtobufSchema(schema);
      expect(protoSchema).toBe(
        `package root;
syntax = "proto3";

message Target {
  repeated string tags = 1;
  repeated double scores = 2;
  repeated bool flags = 3;
}
`,
      );
    });

    it("should handle arrays of objects", async ({ expect }) => {
      const schema = z.object({
        users: z.array(
          z.object({
            name: z.text(),
            age: z.integer(),
          }),
        ),
      });

      const protoSchema = protobuf.createProtobufSchema(schema);
      expect(protoSchema).toBe(
        `package root;
syntax = "proto3";

message Target_users {
  string name = 1;
  int64 age = 2;
}
message Target {
  repeated Target_users users = 1;
}
`,
      );
    });

    it("should encode and decode arrays", async ({ expect }) => {
      const schema = z.object({
        tags: z.array(z.text()),
        users: z.array(
          z.object({
            name: z.text(),
            age: z.integer(),
          }),
        ),
      });

      const data = {
        tags: ["admin", "user"],
        users: [
          { name: "John", age: 30 },
          { name: "Jane", age: 25 },
        ],
      };

      const buf = alepha.codec.encode(schema, data, {
        as: "binary",
        encoder: "protobuf",
      });
      expect(buf).toBeInstanceOf(Uint8Array);

      const decoded = alepha.codec.decode(schema, buf, {
        encoder: "protobuf",
      });
      expect(decoded).toEqual(data);
    });
  });

  describe("Nested objects", () => {
    it("should handle nested objects", async ({ expect }) => {
      const schema = z.object({
        user: z.object({
          profile: z.object({
            name: z.text(),
            bio: z.text(),
          }),
          settings: z.object({
            theme: z.text(),
            notifications: z.boolean(),
          }),
        }),
      });

      const protoSchema = protobuf.createProtobufSchema(schema);
      expect(protoSchema).toBe(
        `package root;
syntax = "proto3";

message Target_user_profile {
  string name = 1;
  string bio = 2;
}
message Target_user_settings {
  string theme = 1;
  bool notifications = 2;
}
message Target_user {
  Target_user_profile profile = 1;
  Target_user_settings settings = 2;
}
message Target {
  Target_user user = 1;
}
`,
      );
    });

    it("should encode and decode nested objects", async ({ expect }) => {
      const schema = z.object({
        user: z.object({
          profile: z.object({
            name: z.text(),
            bio: z.text(),
          }),
          age: z.integer(),
        }),
      });

      const data = {
        user: {
          profile: {
            name: "John Doe",
            bio: "Software developer",
          },
          age: 30,
        },
      };

      const buf = alepha.codec.encode(schema, data, {
        as: "binary",
        encoder: "protobuf",
      });
      expect(buf).toBeInstanceOf(Uint8Array);

      const decoded = alepha.codec.decode(schema, buf, {
        encoder: "protobuf",
      });
      expect(decoded).toEqual(data);
    });
  });

  describe("Optional and nullable types", () => {
    it("should handle nullable types", async ({ expect }) => {
      const schema = z.object({
        name: z.text(),
        email: z.text().nullable(),
        age: z.integer().nullable(),
      });

      const protoSchema = protobuf.createProtobufSchema(schema);
      expect(protoSchema).toBe(
        `package root;
syntax = "proto3";

message Target {
  string name = 1;
  string email = 2;
  int64 age = 3;
}
`,
      );
    });

    /**
     * `.optional()` drops the key from `required` but leaves the property in
     * place, so the field still needs a slot in the message — proto3 encodes an
     * absent optional as its type default rather than omitting the field.
     */
    it("should handle optional types", async ({ expect }) => {
      const schema = z.object({
        name: z.text(),
        nickname: z.text().optional(),
        age: z.integer().optional(),
      });

      const protoSchema = protobuf.createProtobufSchema(schema);
      expect(protoSchema).toBe(
        `package root;
syntax = "proto3";

message Target {
  string name = 1;
  string nickname = 2;
  int64 age = 3;
}
`,
      );
    });

    it("should encode and decode nullable types", async ({ expect }) => {
      const schema = z.object({
        name: z.text(),
        email: z.text().nullable(),
      });

      const data1 = {
        name: "John",
        email: "john@example.com",
      };

      const data2 = {
        name: "Jane",
        email: "", // In proto3, null string becomes empty string
      };

      const buf1 = alepha.codec.encode(schema, data1, {
        as: "binary",
        encoder: "protobuf",
      });
      const buf2 = alepha.codec.encode(schema, data2, {
        as: "binary",
        encoder: "protobuf",
      });

      const decoded1 = alepha.codec.decode(schema, buf1, {
        encoder: "protobuf",
      });
      const decoded2 = alepha.codec.decode(schema, buf2, {
        encoder: "protobuf",
      });

      expect(decoded1).toEqual(data1);
      expect(decoded2.name).toEqual("Jane");
      expect(decoded2.email).toEqual(""); // Proto3 default value for string is ""
    });
  });

  describe("Enums and special types", () => {
    it("should handle enums", async ({ expect }) => {
      const schema = z.object({
        status: z.enum(["ACTIVE", "INACTIVE", "PENDING"]),
        role: z.enum(["USER", "ADMIN", "MODERATOR"]),
      });

      const protoSchema = protobuf.createProtobufSchema(schema);
      expect(protoSchema).toBe(
        `package root;
syntax = "proto3";

enum Status {
  ACTIVE = 0;
  INACTIVE = 1;
  PENDING = 2;
}
enum Role {
  USER = 0;
  ADMIN = 1;
  MODERATOR = 2;
}
message Target {
  Status status = 1;
  Role role = 2;
}
`,
      );
    });

    it("should handle special string types", async ({ expect }) => {
      const schema = z.object({
        id: z.uuid(),
        createdAt: z.datetime(),
        birthDate: z.date(),
        shortText: z.text({ size: "short" }),
        longText: z.text({ size: "long" }),
        richText: z.text({ size: "rich" }),
      });

      const protoSchema = protobuf.createProtobufSchema(schema);
      expect(protoSchema).toBe(
        `package root;
syntax = "proto3";

message Target {
  string id = 1;
  string createdAt = 2;
  string birthDate = 3;
  string shortText = 4;
  string longText = 5;
  string richText = 6;
}
`,
      );
    });

    it("should encode and decode enums", async ({ expect }) => {
      const schema = z.object({
        status: z.enum(["ACTIVE", "INACTIVE"]),
        name: z.text(),
      });

      const data = {
        status: "ACTIVE" as const,
        name: "Test",
      };

      const buf = alepha.codec.encode(schema, data, {
        as: "binary",
        encoder: "protobuf",
      });
      const decoded = alepha.codec.decode(schema, buf, {
        encoder: "protobuf",
      });

      expect(decoded).toEqual(data);
    });

    /**
     * The first enum member is proto3's zero value, which the wire format omits.
     * Decoding has to put it back from the enum definition, or the field comes
     * back `undefined` and fails validation.
     */
    it("should round-trip the zero-value enum member", async ({ expect }) => {
      const schema = z.object({
        status: z.enum(["ACTIVE", "INACTIVE"]),
        name: z.text(),
      });

      const data = { status: "ACTIVE" as const, name: "" };

      const decoded = alepha.codec.decode(
        schema,
        alepha.codec.encode(schema, data, {
          as: "binary",
          encoder: "protobuf",
        }),
        { encoder: "protobuf" },
      );

      expect(decoded).toEqual(data);
    });
  });

  describe("Records (maps)", () => {
    it("should handle records", async ({ expect }) => {
      const schema = z.object({
        metadata: z.record(z.text(), z.text()),
        scores: z.record(z.text(), z.number()),
      });

      const protoSchema = protobuf.createProtobufSchema(schema);
      expect(protoSchema).toBe(
        `package root;
syntax = "proto3";

message Target {
  map<string, string> metadata = 1;
  map<string, double> scores = 2;
}
`,
      );
    });

    it("should encode and decode records", async ({ expect }) => {
      const schema = z.object({
        metadata: z.record(z.text(), z.text()),
      });

      const data = {
        metadata: {
          version: "1.0.0",
          author: "John Doe",
        },
      };

      const buf = alepha.codec.encode(schema, data, {
        as: "binary",
        encoder: "protobuf",
      });
      const decoded = alepha.codec.decode(schema, buf, {
        encoder: "protobuf",
      });

      expect(decoded).toEqual(data);
    });
  });

  describe("Complex combinations", () => {
    it("should handle complex nested structures", async ({ expect }) => {
      const schema = z.object({
        user: z.object({
          id: z.uuid(),
          profile: z.object({
            name: z.text(),
            age: z.integer().nullable(),
            tags: z.array(z.text()),
          }),
          posts: z.array(
            z.object({
              title: z.text(),
              content: z.text({ size: "rich" }),
              metadata: z.record(z.text(), z.text()),
            }),
          ),
        }),
        status: z.enum(["ACTIVE", "INACTIVE"]),
      });

      const data = {
        user: {
          id: "123e4567-e89b-12d3-a456-426614174000",
          profile: {
            name: "John Doe",
            age: 30,
            tags: ["developer", "typescript"],
          },
          posts: [
            {
              title: "Hello World",
              content: "This is my first post",
              metadata: {
                category: "tech",
                draft: "false",
              },
            },
          ],
        },
        status: "ACTIVE" as const,
      };

      const buf = alepha.codec.encode(schema, data, {
        as: "binary",
        encoder: "protobuf",
      });
      const decoded = alepha.codec.decode(schema, buf, {
        encoder: "protobuf",
      });

      expect(decoded).toEqual(data);
    });
  });

  describe("Edge cases", () => {
    /**
     * `z.bigint()` is carried as a string with a `bigint` format, because JSON
     * Schema has no bigint. The field must still reach the wire as int64 — a
     * check on `type` alone would silently widen it to `string`.
     */
    it("should round-trip a bigint as int64", async ({ expect }) => {
      const schema = z.object({ id: z.bigint(), name: z.text() });
      // `z.bigint()` is a validated decimal string, not a JS bigint — JSON
      // Schema has no bigint, so the framework carries it as text.
      const data = { id: "9007199254740993", name: "big" };

      const proto = protobuf.createProtobufSchema(schema);
      expect(proto).toContain("int64 id = 1;");

      const decoded = alepha.codec.decode(
        schema,
        alepha.codec.encode(schema, data, {
          as: "binary",
          encoder: "protobuf",
        }),
        { encoder: "protobuf" },
      );

      expect(decoded.id).toBe(data.id);
      expect(decoded.name).toBe(data.name);
    });

    /**
     * Two fields with the same members share one definition, rather than
     * emitting a duplicate enum protobufjs would reject.
     */
    it("should reuse one enum definition for identical members", async ({
      expect,
    }) => {
      const schema = z.object({
        status: z.enum(["ACTIVE", "INACTIVE"]),
        previousStatus: z.enum(["ACTIVE", "INACTIVE"]),
      });

      const proto = protobuf.createProtobufSchema(schema);
      expect(proto).toBe(
        `package root;
syntax = "proto3";

enum Status {
  ACTIVE = 0;
  INACTIVE = 1;
}
message Target {
  Status status = 1;
  Status previousStatus = 2;
}
`,
      );
    });

    it("should restore an omitted optional field as its type default", async ({
      expect,
    }) => {
      const schema = z.object({
        name: z.text(),
        nickname: z.text().optional(),
        tags: z.array(z.text()).optional(),
      });

      const decoded = alepha.codec.decode(
        schema,
        alepha.codec.encode(
          schema,
          { name: "John" },
          { as: "binary", encoder: "protobuf" },
        ),
        { encoder: "protobuf" },
      );

      expect(decoded.name).toBe("John");
      expect(decoded.nickname).toBe("");
      expect(decoded.tags).toEqual([]);
    });

    /**
     * A protobuf message is an object. Anything else has no message to map to,
     * and the failure should name that rather than surfacing as a lookup error
     * from inside protobufjs.
     */
    it("should reject a non-object root schema", async ({ expect }) => {
      expect(() => protobuf.createProtobufSchema(z.array(z.text()))).toThrow(
        /root schema must be a z.object/,
      );
      expect(() => protobuf.createProtobufSchema(z.text())).toThrow(
        /root schema must be a z.object/,
      );
    });

    it("should reject a field it cannot map to a protobuf type", async ({
      expect,
    }) => {
      expect(() =>
        protobuf.createProtobufSchema(z.object({ nothing: z.null() })),
      ).toThrow(/Unsupported type for protobuf/);
    });

    it("should handle an empty message", async ({ expect }) => {
      const schema = z.object({});

      expect(protobuf.createProtobufSchema(schema)).toBe(
        `package root;
syntax = "proto3";

message Target {

}
`,
      );
    });

    /**
     * The conversion is cached on the schema object, so repeated encodes of the
     * same schema do not re-walk it.
     */
    it("should return a stable JSON Schema for the same schema object", async ({
      expect,
    }) => {
      const schema = z.object({ name: z.text() });

      expect(protobuf.toJsonSchema(schema)).toBe(protobuf.toJsonSchema(schema));
    });

    it("should honour custom root and message names", async ({ expect }) => {
      const schema = z.object({ name: z.text() });

      expect(
        protobuf.createProtobufSchema(schema, {
          rootName: "custom",
          mainMessageName: "User",
        }),
      ).toBe(
        `package custom;
syntax = "proto3";

message User {
  string name = 1;
}
`,
      );
    });
  });

  describe("Codec surface", () => {
    it("should encode to a base64 string and decode it back", async ({
      expect,
    }) => {
      const schema = z.object({ name: z.text(), age: z.integer() });
      const data = { name: "John", age: 30 };

      const text = alepha.codec.encode(schema, data, {
        as: "string",
        encoder: "protobuf",
      });
      expect(typeof text).toBe("string");

      expect(
        alepha.codec.decode(schema, text, { encoder: "protobuf" }),
      ).toEqual(data);
    });

    it("should reject a value it cannot decode", async ({ expect }) => {
      const schema = z.object({ name: z.text() });

      expect(() =>
        alepha.codec.decode(schema, 42 as any, { encoder: "protobuf" }),
      ).toThrow(/Unsupported value type/);
    });
  });

  /**
   * `z.integer()` used to be emitted as `int32`, so a millisecond timestamp,
   * an id past 2^31-1 or any large counter wrapped silently on encode.
   */
  describe("integer width", () => {
    it("round-trips a timestamp-sized integer exactly", async ({ expect }) => {
      const schema = z.object({ at: z.integer() });
      const data = { at: 1_787_667_245_237 };

      const buf = alepha.codec.encode(schema, data, {
        as: "binary",
        encoder: "protobuf",
      });

      expect(alepha.codec.decode(schema, buf, { encoder: "protobuf" })).toEqual(
        data,
      );
    });

    it("round-trips a negative integer past the int32 floor", async ({
      expect,
    }) => {
      const schema = z.object({ delta: z.integer() });
      const data = { delta: -3_000_000_000 };

      const buf = alepha.codec.encode(schema, data, {
        as: "binary",
        encoder: "protobuf",
      });

      expect(alepha.codec.decode(schema, buf, { encoder: "protobuf" })).toEqual(
        data,
      );
    });

    it("round-trips a large integer inside an array and a nullable", async ({
      expect,
    }) => {
      const schema = z.object({
        stamps: z.array(z.integer()),
        maybe: z.integer().nullable(),
      });
      const data = { stamps: [1_787_667_245_237, 2], maybe: 9_000_000_000 };

      const buf = alepha.codec.encode(schema, data, {
        as: "binary",
        encoder: "protobuf",
      });

      expect(alepha.codec.decode(schema, buf, { encoder: "protobuf" })).toEqual(
        data,
      );
    });

    it("keeps int32 when both declared bounds fit", async ({ expect }) => {
      const schema = z.object({ level: z.integer().min(0).max(1000) });

      expect(protobuf.createProtobufSchema(schema)).toContain(
        "int32 level = 1;",
      );
    });

    it("widens when only the upper bound is declared", async ({ expect }) => {
      // zod emits `minimum: -(2^53-1)` for every integer, so `.max(1000)`
      // alone still admits values that wrap an int32. Narrowing on the
      // strength of one bound would keep the bug this exists to close.
      const schema = z.object({ level: z.integer().max(1000) });

      expect(protobuf.createProtobufSchema(schema)).toContain(
        "int64 level = 1;",
      );
    });
  });
});
