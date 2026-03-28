import { Alepha, t } from "alepha";
import { describe, test } from "vitest";
import { AlephaProtobuf, ProtobufProvider } from "../index.ts";

const alepha = Alepha.create().with(AlephaProtobuf);
const protobuf = alepha.inject(ProtobufProvider);

describe("ProtobufProvider", () => {
  describe("Basic types", () => {
    test("should handle primitive types", async ({ expect }) => {
      const userSchema = t.object({
        username: t.text(),
        createdAt: t.datetime(),
        age: t.integer(),
        isActive: t.boolean(),
        score: t.number(),
        bigNumber: t.bigint(),
        level: t.integer(),
        points: t.integer(),
      });

      const schema = protobuf.createProtobufSchema(userSchema);
      expect(schema).toBe(
        `package root;
syntax = "proto3";

message Target {
  string username = 1;
  string createdAt = 2;
  int32 age = 3;
  bool isActive = 4;
  double score = 5;
  int64 bigNumber = 6;
  int32 level = 7;
  int32 points = 8;
}
`,
      );
    });

    test("should encode and decode primitive types", async ({ expect }) => {
      const userSchema = t.object({
        username: t.text(),
        createdAt: t.datetime(),
        age: t.integer(),
        isActive: t.boolean(),
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
      // When decoding, dates come back as dayjs objects, so compare the ISO strings
      expect(user.username).toBe(data.username);
      expect(user.age).toBe(data.age);
      expect(user.isActive).toBe(data.isActive);
      // Compare datetime as ISO strings since dayjs might be used
      expect(user.createdAt).toBe(createdAt);
    });
  });

  describe("Arrays", () => {
    test("should handle arrays of primitives", async ({ expect }) => {
      const schema = t.object({
        tags: t.array(t.text()),
        scores: t.array(t.number()),
        flags: t.array(t.boolean()),
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

    test("should handle arrays of objects", async ({ expect }) => {
      const schema = t.object({
        users: t.array(
          t.object({
            name: t.text(),
            age: t.integer(),
          }),
        ),
      });

      const protoSchema = protobuf.createProtobufSchema(schema);
      expect(protoSchema).toBe(
        `package root;
syntax = "proto3";

message Target_users {
  string name = 1;
  int32 age = 2;
}
message Target {
  repeated Target_users users = 1;
}
`,
      );
    });

    test("should encode and decode arrays", async ({ expect }) => {
      const schema = t.object({
        tags: t.array(t.text()),
        users: t.array(
          t.object({
            name: t.text(),
            age: t.integer(),
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
    test("should handle nested objects", async ({ expect }) => {
      const schema = t.object({
        user: t.object({
          profile: t.object({
            name: t.text(),
            bio: t.text(),
          }),
          settings: t.object({
            theme: t.text(),
            notifications: t.boolean(),
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

    test("should encode and decode nested objects", async ({ expect }) => {
      const schema = t.object({
        user: t.object({
          profile: t.object({
            name: t.text(),
            bio: t.text(),
          }),
          age: t.integer(),
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
    test("should handle nullable types", async ({ expect }) => {
      const schema = t.object({
        name: t.text(),
        email: t.nullable(t.text()),
        age: t.nullable(t.integer()),
      });

      const protoSchema = protobuf.createProtobufSchema(schema);
      expect(protoSchema).toBe(
        `package root;
syntax = "proto3";

message Target {
  string name = 1;
  string email = 2;
  int32 age = 3;
}
`,
      );
    });

    test("should encode and decode nullable types", async ({ expect }) => {
      const schema = t.object({
        name: t.text(),
        email: t.nullable(t.text()),
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
    test("should handle enums", async ({ expect }) => {
      const schema = t.object({
        status: t.enum(["ACTIVE", "INACTIVE", "PENDING"]),
        role: t.enum(["USER", "ADMIN", "MODERATOR"]),
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

    test("should handle special string types", async ({ expect }) => {
      const schema = t.object({
        id: t.uuid(),
        createdAt: t.datetime(),
        birthDate: t.date(),
        shortText: t.text({ size: "short" }),
        longText: t.text({ size: "long" }),
        richText: t.text({ size: "rich" }),
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

    test("should encode and decode enums", async ({ expect }) => {
      const schema = t.object({
        status: t.enum(["ACTIVE", "INACTIVE"]),
        name: t.text(),
      });

      const data = {
        status: "ACTIVE",
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
  });

  describe("Records (maps)", () => {
    test("should handle records", async ({ expect }) => {
      const schema = t.object({
        metadata: t.record(t.text(), t.text()),
        scores: t.record(t.text(), t.number()),
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

    test("should encode and decode records", async ({ expect }) => {
      const schema = t.object({
        metadata: t.record(t.text(), t.text()),
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
    test("should handle complex nested structures", async ({ expect }) => {
      const schema = t.object({
        user: t.object({
          id: t.uuid(),
          profile: t.object({
            name: t.text(),
            age: t.nullable(t.integer()),
            tags: t.array(t.text()),
          }),
          posts: t.array(
            t.object({
              title: t.text(),
              content: t.text({ size: "rich" }),
              metadata: t.record(t.text(), t.text()),
            }),
          ),
        }),
        status: t.enum(["ACTIVE", "INACTIVE"]),
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
        status: "ACTIVE",
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
});
