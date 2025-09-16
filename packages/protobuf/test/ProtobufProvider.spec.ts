import { Alepha, t } from "@alepha/core";
import { describe, test } from "vitest";
import { ProtobufProvider } from "../src";

const protobuf = Alepha.create().inject(ProtobufProvider);

describe("ProtobufProvider", () => {
	describe("Basic types", () => {
		test("should handle primitive types", async ({ expect }) => {
			const userSchema = t.object({
				username: t.string(),
				createdAt: t.datetime(),
				age: t.int(),
				isActive: t.boolean(),
				score: t.number(),
				bigNumber: t.bigint(),
				level: t.uchar(),
				points: t.uint(),
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
  uint32 level = 7;
  uint32 points = 8;
}
`,
			);
		});

		test("should encode and decode primitive types", async ({ expect }) => {
			const userSchema = t.object({
				username: t.string(),
				createdAt: t.datetime(),
				age: t.int(),
				isActive: t.boolean(),
			});

			const data = {
				username: "John Doe",
				createdAt: new Date().toISOString(),
				age: 30,
				isActive: true,
			};
			const buf = protobuf.encode(userSchema, data);
			expect(buf).toBeInstanceOf(Uint8Array);

			const user = protobuf.decode(userSchema, buf);
			expect(user).toEqual(data);
		});
	});

	describe("Arrays", () => {
		test("should handle arrays of primitives", async ({ expect }) => {
			const schema = t.object({
				tags: t.array(t.string()),
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
						name: t.string(),
						age: t.int(),
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
				tags: t.array(t.string()),
				users: t.array(
					t.object({
						name: t.string(),
						age: t.int(),
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

			const buf = protobuf.encode(schema, data);
			expect(buf).toBeInstanceOf(Uint8Array);

			const decoded = protobuf.decode(schema, buf);
			expect(decoded).toEqual(data);
		});
	});

	describe("Nested objects", () => {
		test("should handle nested objects", async ({ expect }) => {
			const schema = t.object({
				user: t.object({
					profile: t.object({
						name: t.string(),
						bio: t.string(),
					}),
					settings: t.object({
						theme: t.string(),
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
						name: t.string(),
						bio: t.string(),
					}),
					age: t.int(),
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

			const buf = protobuf.encode(schema, data);
			expect(buf).toBeInstanceOf(Uint8Array);

			const decoded = protobuf.decode(schema, buf);
			expect(decoded).toEqual(data);
		});
	});

	describe("Optional and nullable types", () => {
		test("should handle nullable types", async ({ expect }) => {
			const schema = t.object({
				name: t.string(),
				email: t.nullable(t.string()),
				age: t.nullable(t.int()),
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
				name: t.string(),
				email: t.nullable(t.string()),
			});

			const data1 = {
				name: "John",
				email: "john@example.com",
			};

			const data2 = {
				name: "Jane",
				email: "", // In proto3, null string becomes empty string
			};

			const buf1 = protobuf.encode(schema, data1);
			const buf2 = protobuf.encode(schema, data2);

			const decoded1 = protobuf.decode(schema, buf1);
			const decoded2 = protobuf.decode(schema, buf2);

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

message Target {
  string status = 1;
  string role = 2;
}
`,
			);
		});

		test("should handle special string types", async ({ expect }) => {
			const schema = t.object({
				id: t.uuid(),
				createdAt: t.datetime(),
				birthDate: t.date(),
				shortText: t.string({ size: "short" }),
				longText: t.string({ size: "long" }),
				richText: t.string({ size: "rich" }),
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
				name: t.string(),
			});

			const data = {
				status: "ACTIVE",
				name: "Test",
			};

			const buf = protobuf.encode(schema, data);
			const decoded = protobuf.decode(schema, buf);

			expect(decoded).toEqual(data);
		});
	});

	describe("Records (maps)", () => {
		test("should handle records", async ({ expect }) => {
			const schema = t.object({
				metadata: t.record(t.string(), t.string()),
				scores: t.record(t.string(), t.number()),
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
				metadata: t.record(t.string(), t.string()),
			});

			const data = {
				metadata: {
					version: "1.0.0",
					author: "John Doe",
				},
			};

			const buf = protobuf.encode(schema, data);
			const decoded = protobuf.decode(schema, buf);

			expect(decoded).toEqual(data);
		});
	});

	describe("Complex combinations", () => {
		test("should handle complex nested structures", async ({ expect }) => {
			const schema = t.object({
				user: t.object({
					id: t.uuid(),
					profile: t.object({
						name: t.string(),
						age: t.nullable(t.int()),
						tags: t.array(t.string()),
					}),
					posts: t.array(
						t.object({
							title: t.string(),
							content: t.string({ size: "rich" }),
							metadata: t.record(t.string(), t.string()),
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

			const buf = protobuf.encode(schema, data);
			const decoded = protobuf.decode(schema, buf);

			expect(decoded).toEqual(data);
		});
	});
});
