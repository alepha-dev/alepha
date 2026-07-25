# Types

Alepha provides schema validation through the `z` singleton from `"alepha"`. It wraps [Zod 4](https://zod.dev) with opinionated defaults: objects reject extra properties, strings have length limits, and arrays cap their size.

Import `z` from `alepha`, not from `zod` — a schema built with the raw library carries none of those defaults.

## Basic Usage

```typescript
import { z } from "alepha";

const userSchema = z.object({
  id: z.uuid(),
  email: z.email(),
  name: z.text(),
  age: z.integer().optional(),
});
```

`z` returns plain Zod schemas, so anything that accepts a Zod type accepts them — `.parse()`, `.safeParse()`, `.optional()`, and the rest of the Zod surface all work as usual.

## Strings

### z.string() vs z.text()

`z.string()` creates a raw string with no length limit. Use it for internal values where length is irrelevant.

`z.text()` adds length limits and text processing. Use it for user input, database fields, and API schemas.

```typescript
z.string()                  // no limits
z.text()                    // max 255 chars, trimmed
z.text({ size: "short" })   // max 64 chars, trimmed
z.text({ size: "long" })    // max 1024 chars, trimmed
z.text({ size: "rich" })    // max 65535 chars, trimmed
```

`z.text()` trims whitespace by default. You can control this and enable lowercase conversion:

```typescript
z.text({ trim: false })          // no trimming
z.text({ trim: true, lowercase: true })  // trim + lowercase
```

### Text Presets

Shorthand methods for common text sizes:

```typescript
z.shortText()   // same as z.text({ size: "short" })  — 64 chars
z.longText()    // same as z.text({ size: "long" })   — 1024 chars
z.richText()    // same as z.text({ size: "rich" })   — 65535 chars
```

### Default Length Limits

These static properties control the defaults. Override them at startup if needed:

```typescript
TypeProvider.DEFAULT_STRING_MAX_LENGTH       // 255
TypeProvider.DEFAULT_SHORT_STRING_MAX_LENGTH  // 64
TypeProvider.DEFAULT_LONG_STRING_MAX_LENGTH   // 1024
TypeProvider.DEFAULT_RICH_STRING_MAX_LENGTH   // 65535
```

```typescript
import { TypeProvider } from "alepha/core";

TypeProvider.DEFAULT_STRING_MAX_LENGTH = 512;
TypeProvider.DEFAULT_RICH_STRING_MAX_LENGTH = 100000;
```

## Numbers

```typescript
z.number()    // any number
z.integer()   // integer (no fractional part)
z.int32()     // integer clamped to signed 32-bit range (-2147483647 to 2147483647)
z.int64()     // JS-safe integer (-9007199254740991 to 9007199254740991)
```

`z.int64()` is NOT a true 64-bit integer. JavaScript cannot represent all int64 values. For true int64, use `z.bigint()` which stores values as strings.

Chain zod's native number checks for bounds:

```typescript
z.integer().min(0).max(100)
z.number().gt(0)
```

## Objects

Objects reject additional properties by default:

```typescript
const schema = z.object({
  name: z.text(),
  email: z.email(),
});
// { name: "alice", email: "a@b.c", extra: true } → validation error
```

To allow additional properties:

```typescript
z.object({ name: z.text() }).meta({ additionalProperties: true })
```

## Arrays

Arrays are limited to 1000 items by default:

```typescript
z.array(z.string())                      // max 1000 items
z.array(z.string()).max(50)              // max 50 items
z.array(z.string()).min(1)               // at least 1 item
```

Override the global default:

```typescript
TypeProvider.DEFAULT_ARRAY_MAX_ITEMS = 5000;
```

## Modifiers

### Optional and Nullable

```typescript
z.string().optional()    // string | undefined
z.string().nullable()    // string | null
```

These can be combined:

```typescript
z.string().nullable().optional()  // string | null | undefined
```

### Partial, Pick, Omit

```typescript
const user = z.object({
  id: z.uuid(),
  name: z.text(),
  email: z.email(),
});

user.partial()                              // all fields optional
user.pick({ id: true, name: true })         // only id and name
user.omit({ id: true })                     // name and email only
```

All three preserve the `additionalProperties: false` default.

### Extend

Add properties to an existing schema:

```typescript
const baseUser = z.object({
  id: z.uuid(),
  name: z.text(),
});

const admin = baseUser.extend({
  role: z.const("admin"),
  permissions: z.array(z.text()),
});
```

To merge multiple base schemas, spread their `.shape` into a new object:

```typescript
z.object({ ...baseUser.shape, ...timestamped.shape, extra: z.text() })
```

## Format Types

### Bigint

String-encoded arbitrary-precision integer:

```typescript
z.bigint()   // validates "123456789", "-42", etc.
```

Values are represented as strings to avoid JavaScript number limitations.

### UUID

```typescript
z.uuid()   // validates UUID format (e.g. "550e8400-e29b-41d4-a716-446655440000")
```

### URL

```typescript
z.url()   // validates URL format
```

### File and Stream

```typescript
z.file()                      // file-like object (browser File API compatible)
z.file({ maxSize: 1048576 })  // with size limit (bytes)
z.stream()                    // experimental streaming type
```

## Domain Types

### Email

```typescript
z.email()   // validates email format, auto-trims and lowercases
```

### Phone (E.164)

```typescript
z.e164()   // validates E.164 format, e.g. "+1234567890"
```

### Language Tag (BCP 47)

```typescript
z.bcp47()   // validates BCP 47 tags, e.g. "en", "en-US", "fr-CA"
```

### Date and Time

```typescript
z.datetime()   // ISO 8601 date-time, e.g. "2024-01-15T10:30:00Z"
z.date()       // ISO 8601 date, e.g. "2024-01-15"
z.time()       // ISO 8601 time, e.g. "10:30:00"
z.duration()   // ISO 8601 duration, e.g. "P1DT12H"
```

## Enums

String enums with built-in validation:

```typescript
z.enum(["ACTIVE", "INACTIVE", "BANNED"])
// validates that the value is one of the listed strings
```

Enum values are validated both by pattern matching and by an `enum` constraint on the schema.

## Other Types

```typescript
z.const("value")    // literal value
z.boolean()         // boolean
z.null()            // null
z.any()             // any (no validation)
z.void()            // void
z.undefined()       // undefined
z.union([...])      // union of schemas
z.tuple([...])      // fixed-length array
z.record(k, v)      // Record<K, V>
z.json()            // Record<string, any> — convenience for JSON blobs
```

## Validation

Alepha validates data through `alepha.codec.validate()`. This is the same validation used internally by `$action`, `$env`, and other primitives.

```typescript
import { Alepha, z } from "alepha";

const alepha = Alepha.create();
const schema = z.object({
  name: z.text(),
  email: z.email(),
});

const result = alepha.codec.validate(schema, {
  name: "  Alice  ",
  email: "ALICE@EXAMPLE.COM",
});
// result: { name: "Alice", email: "alice@example.com" }
```

Validation does more than type checking. It applies preprocessing defined by `z.text()`:

- **Trimming**: strings created with `z.text()` are trimmed by default.
- **Lowercase**: strings with `lowercase: true` (like `z.email()`) are lowercased.
- **Null coercion**: `null` values in non-nullable fields become `undefined`, which are then stripped from objects.
- **Array wrapping**: non-array values passed to an array schema are automatically wrapped into a single-element array (e.g. `"hello"` becomes `["hello"]`).

If validation fails, a `SchemaValidationError` is thrown with details about the first failing constraint.

### Validation Options

```typescript
alepha.codec.validate(schema, value, {
  trim: true,              // apply text trimming (default: true)
  nullToUndefined: true,   // convert null to undefined for non-nullable fields (default: true)
  deleteUndefined: true,   // remove undefined keys from objects (default: true)
});
```

## Encoding

`alepha.codec.encode()` validates data and serializes it to a target format:

```typescript
const schema = z.object({
  id: z.uuid(),
  name: z.text(),
});

// Validate and return the cleaned object (default)
const obj = alepha.codec.encode(schema, data);

// Validate and serialize to JSON string
const json = alepha.codec.encode(schema, data, { as: "string" });

// Validate and serialize to binary (for protobuf, msgpack, etc.)
const bytes = alepha.codec.encode(schema, data, { as: "binary" });
```

You can skip validation with `validation: false`:

```typescript
alepha.codec.encode(schema, data, { validation: false, as: "string" });
```

### Codec Formats

The default codec is `"json"`. Alepha also ships a `"keyless"` codec (smaller payloads, used for internal RPC). Additional codecs like Protobuf can be registered:

```typescript
alepha.codec.register({
  name: "protobuf",
  codec: myProtobufCodec,
});

alepha.codec.encode(schema, data, { encoder: "protobuf", as: "binary" });
```

## Decoding

`alepha.codec.decode()` deserializes data and validates it against a schema:

```typescript
const result = alepha.codec.decode(schema, jsonString);
// result is validated and typed as Static<typeof schema>
```

Specify a codec if the data isn't standard JSON:

```typescript
const result = alepha.codec.decode(schema, binaryData, { encoder: "protobuf" });
```

Validation runs automatically after decoding. Disable it with `validation: false`.

## Accessing Zod Directly

`z` covers what Alepha needs. For anything it does not wrap, `Type` is the raw
Zod namespace:

```typescript
import { Type } from "alepha";

Type.intersection(schemaA, schemaB);
```

Schemas built by `z` are ordinary Zod schemas, so the fluent API works on them
directly too:

```typescript
schemaA.and(schemaB);
```
