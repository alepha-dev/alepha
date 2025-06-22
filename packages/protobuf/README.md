# alepha/protobuf

```ts
import { Alepha, t } from "@alepha/core";
import { ProtobufProvider } from "@alepha/protobuf";

const protobuf = Alepha.create().get(ProtobufProvider);

const userSchema = t.object({
	username: t.string(),
	createdAt: t.datetime(),
	age: t.int(),
	isActive: t.boolean()
});

const buffer = protobuf.encode(userSchema, {
	username: "John Doe",
	createdAt: new Date().toISOString(),
	age: 30,
	isActive: true
});

const user = protobuf.decode(userSchema, buffer);
```
