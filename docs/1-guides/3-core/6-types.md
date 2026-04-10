# Types

Alepha provides schema validation through the `t` singleton from `"alepha"`. It wraps [TypeBox](https://github.com/sinclairzx81/typebox) with opinionated defaults: objects reject extra properties, strings have length limits, and arrays cap their size.

## Basic Usage

```typescript
import { t } from "alepha";

const userSchema = t.object({
  id: t.uuid(),
  email: t.email(),
  name: t.text(),
  age: t.optional(t.integer()),
});
```

`t` is a `TypeProvider` instance. All methods return TypeBox schemas that work with standard TypeBox utilities (`Value.Check`, `Value.Decode`, etc.).

## Strings

### t.string() vs t.text()

`t.string()` creates a raw string with no length limit. Use it for internal values where length is irrelevant.

`t.text()` adds length limits and text processing. Use it for user input, database fields, and API schemas.

```typescript
t.string()                  // no limits
t.text()                    // max 255 chars, trimmed
t.text({ size: "short" })   // max 64 chars, trimmed
t.text({ size: "long" })    // max 1024 chars, trimmed
t.text({ size: "rich" })    // max 65535 chars, trimmed
```

`t.text()` trims whitespace by default. You can control this and enable lowercase conversion:

```typescript
t.text({ trim: false })          // no trimming
t.text({ trim: true, lowercase: true })  // trim + lowercase
```

### Text Presets

Shorthand methods for common text sizes:

```typescript
t.shortText()   // same as t.text({ size: "short" })  — 64 chars
t.longText()    // same as t.text({ size: "long" })   — 1024 chars
t.richText()    // same as t.text({ size: "rich" })   — 65535 chars
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
t.number()    // any number
t.integer()   // integer (no fractional part)
t.int32()     // integer clamped to signed 32-bit range (-2147483647 to 2147483647)
t.int64()     // JS-safe integer (-9007199254740991 to 9007199254740991)
```

`t.int64()` is NOT a true 64-bit integer. JavaScript cannot represent all int64 values. For true int64, use `t.bigint()` which stores values as strings.

All number methods accept TypeBox number options:

```typescript
t.integer({ minimum: 0, maximum: 100 })
t.number({ exclusiveMinimum: 0 })
```

## Objects

Objects reject additional properties by default:

```typescript
const schema = t.object({
  name: t.text(),
  email: t.email(),
});
// { name: "alice", email: "a@b.c", extra: true } → validation error
```

To allow additional properties:

```typescript
t.object({ name: t.text() }, { additionalProperties: true })
```

## Arrays

Arrays are limited to 1000 items by default:

```typescript
t.array(t.string())                      // max 1000 items
t.array(t.string(), { maxItems: 50 })    // max 50 items
t.array(t.string(), { minItems: 1 })     // at least 1 item
```

Override the global default:

```typescript
TypeProvider.DEFAULT_ARRAY_MAX_ITEMS = 5000;
```

## Modifiers

### Optional and Nullable

```typescript
t.optional(t.string())    // string | undefined
t.nullable(t.string())    // string | null
```

These can be combined:

```typescript
t.optional(t.nullable(t.string()))  // string | null | undefined
```

### Partial, Pick, Omit

```typescript
const user = t.object({
  id: t.uuid(),
  name: t.text(),
  email: t.email(),
});

t.partial(user)                  // all fields optional
t.pick(user, ["id", "name"])     // only id and name
t.omit(user, ["id"])             // name and email only
```

All three preserve the `additionalProperties: false` default.

### Extend

Add properties to an existing schema:

```typescript
const baseUser = t.object({
  id: t.uuid(),
  name: t.text(),
});

const admin = t.extend(baseUser, {
  role: t.const("admin"),
  permissions: t.array(t.text()),
});
```

`t.extend` also accepts an array of schemas to merge multiple bases:

```typescript
t.extend([baseUser, timestamped], { extra: t.text() })
```

### Nullify

Maps all properties of an object to nullable:

```typescript
const schema = t.object({
  name: t.text(),
  age: t.integer(),
});

t.nullify(schema)
// equivalent to: { name: string | null, age: number | null }
```

## Format Types

### Bigint

String-encoded arbitrary-precision integer:

```typescript
t.bigint()   // validates "123456789", "-42", etc.
```

Values are represented as strings to avoid JavaScript number limitations.

### UUID

```typescript
t.uuid()   // validates UUID format (e.g. "550e8400-e29b-41d4-a716-446655440000")
```

### URL

```typescript
t.url()   // validates URL format
```

### File and Stream

```typescript
t.file()                      // file-like object (browser File API compatible)
t.file({ maxSize: 1048576 })  // with size limit (bytes)
t.stream()                    // experimental streaming type
```

## Domain Types

### Email

```typescript
t.email()   // validates email format, auto-trims and lowercases
```

### Phone (E.164)

```typescript
t.e164()   // validates E.164 format, e.g. "+1234567890"
```

### Language Tag (BCP 47)

```typescript
t.bcp47()   // validates BCP 47 tags, e.g. "en", "en-US", "fr-CA"
```

### Date and Time

```typescript
t.datetime()   // ISO 8601 date-time, e.g. "2024-01-15T10:30:00Z"
t.date()       // ISO 8601 date, e.g. "2024-01-15"
t.time()       // ISO 8601 time, e.g. "10:30:00"
t.duration()   // ISO 8601 duration, e.g. "P1DT12H"
```

## Enums

String enums with built-in validation:

```typescript
t.enum(["ACTIVE", "INACTIVE", "BANNED"])
// validates that the value is one of the listed strings
```

Enum values are validated both by pattern matching and by an `enum` constraint on the schema.

## Other Types

```typescript
t.const("value")    // literal value
t.boolean()         // boolean
t.null()            // null
t.any()             // any (no validation)
t.void()            // void
t.undefined()       // undefined
t.union([...])      // union of schemas
t.tuple([...])      // fixed-length array
t.record(k, v)      // Record<K, V>
t.json()            // Record<string, any> — convenience for JSON blobs
```

## Validation

Alepha validates data through `alepha.codec.validate()`. This is the same validation used internally by `$action`, `$env`, and other primitives.

```typescript
import { Alepha, t } from "alepha";

const alepha = Alepha.create();
const schema = t.object({
  name: t.text(),
  email: t.email(),
});

const result = alepha.codec.validate(schema, {
  name: "  Alice  ",
  email: "ALICE@EXAMPLE.COM",
});
// result: { name: "Alice", email: "alice@example.com" }
```

Validation does more than type checking. It applies preprocessing defined by `t.text()`:

- **Trimming**: strings created with `t.text()` are trimmed by default.
- **Lowercase**: strings with `lowercase: true` (like `t.email()`) are lowercased.
- **Null coercion**: `null` values in non-nullable fields become `undefined`, which are then stripped from objects.
- **Array wrapping**: non-array values passed to an array schema are automatically wrapped into a single-element array (e.g. `"hello"` becomes `["hello"]`).

If validation fails, a `TypeBoxError` is thrown with details about the first failing constraint.

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
const schema = t.object({
  id: t.uuid(),
  name: t.text(),
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

## Accessing TypeBox Directly

If you need raw TypeBox functionality:

```typescript
t.raw   // the TypeBox Type object
```

```typescript
t.raw.Intersect([schemaA, schemaB])
```
