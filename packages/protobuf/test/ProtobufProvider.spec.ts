import { Alepha, t } from "@alepha/core";
import { test } from "vitest";
import { ProtobufProvider } from "../src";

const protobuf = Alepha.create().inject(ProtobufProvider);
const userSchema = t.object({
	username: t.string(),
	createdAt: t.datetime(),
	age: t.int(),
	isActive: t.boolean(),
});

test("ProtobufProvider#typeboxToProtobuf", async ({ expect }) => {
	const schema = protobuf.createProtobufSchema(userSchema);
	expect(schema).toBe(
		`package root;
syntax = "proto3";

message Target {
  string username = 1;
  string createdAt = 2;
  int32 age = 3;
  bool isActive = 4;
}
`,
	);
});

test("ProtobufProvider#encode", async ({ expect }) => {
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
