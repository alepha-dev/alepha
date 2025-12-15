# Type Safety (The `t` Object)

In many full-stack frameworks, you end up defining your data structures three times:
1.  Once for the Database (SQL/ORM)
2.  Once for the API Validation (Zod/Joi)
3.  Once for TypeScript interfaces

If you change one, you have to change the others. It's exhausting and error-prone.

Alepha solves this with the `t` object.

## One Schema to Rule Them All

Alepha uses [TypeBox](https://github.com/sinclairzx81/typebox) as its schema definition language, wrapped as `t`. We chose TypeBox because it compiles down to standard JSON Schema, provides compile-time type inference without code generation, and is ridiculously fast.

When you define an object with `t`, Alepha uses it for everything:

```typescript
const userSchema = t.object({
  username: t.text(),
  age: t.integer()
});
```

1. **Runtime Validation:** Used by `$action` to validate incoming HTTP JSON bodies.
2. **Database Definition:** Used by `$entity` to generate `CREATE TABLE` statements.
3. **TypeScript Inference:** Used by your IDE to give you autocomplete.
4. **Documentation:** Used to generate OpenAPI/Swagger specs.

## Static Type Inference

You don't need to write TypeScript interfaces. Use `Static<T>` to extract the type:

```typescript
import { t, type Static } from "alepha";

const userSchema = t.object({
  id: t.uuid(),
  email: t.email(),
  age: t.integer(),
});

type User = Static<typeof userSchema>;
// { id: string; email: string; age: number }
```

## Strings

### `t.string()` vs `t.text()`

`t.string()` is raw and unbounded. Use it for internal stuff.

`t.text()` is the safe version: max 255 chars by default, auto-trims whitespace. Use it for user input.

```typescript
t.string()                         // any string, no limits
t.text()                           // max 255, trimmed
t.text({ maxLength: 1000 })        // custom limit
t.text({ trim: false })            // keep whitespace
t.text({ lowercase: true })        // force lowercase
```

### Size Helpers

```typescript
t.shortText()   // max 64 - names, titles
t.text()        // max 255 - default
t.longText()    // max 1024 - descriptions
t.richText()    // max 65535 - HTML, Markdown
```

Same as `t.text({ size: "short" })`, etc.

## Numbers

```typescript
t.number()                    // any number
t.number({ minimum: 0 })      // non-negative
t.integer()                   // whole numbers
t.integer({ minimum: 1 })     // positive integers
t.int32()                     // -2B to 2B (Postgres INT4)
t.int64()                     // safe JS integer range
t.bigint()                    // string representation for true 64-bit
```

`t.int64()` is not a real int64. JavaScript can't represent all 64-bit integers. If you need the full range, use `t.bigint()` which stores it as a string like `"123456789012345678"`.

## Booleans

```typescript
t.boolean()
```

Nothing fancy here.

## Format Types

```typescript
t.uuid()      // "550e8400-e29b-41d4-a716-446655440000"
t.email()     // auto-trims and lowercases
t.url()       // "https://example.com"
t.e164()      // "+1234567890" (phone)
t.bcp47()     // "en", "en-US", "fr-CA" (language tag)
```

## Date and Time

All ISO 8601 strings:

```typescript
t.datetime()   // "2024-01-15T14:30:00.000Z"
t.date()       // "2024-01-15"
t.time()       // "14:30:00"
t.duration()   // "P1DT2H30M"
```

## Files

```typescript
t.file()                 // any file
t.file({ maxSize: 5 })   // max 5 MB
```

Used in `$action` for uploads:

```typescript
upload = $action({
  path: "/avatar",
  schema: { body: t.object({ file: t.file({ maxSize: 5 }) }) },
  handler: async ({ body }) => {
    // body.file is a FileLike object
  },
});
```

## Enums and Literals

```typescript
t.const("active")                        // exactly "active"
t.const(42)                              // exactly 42
t.enum(["pending", "active", "done"])    // one of these
```

## Unions

```typescript
t.union([t.text(), t.null()])              // string | null
t.union([t.const("a"), t.const("b")])      // "a" | "b"
```

Avoid unions when possible. They're harder to work with in the ORM, validation errors are confusing, and OpenAPI doesn't love them. Prefer `t.enum()` for string choices or `t.nullable()` for optional values.

## Optional vs Nullable

```typescript
// optional: can be omitted
t.object({
  name: t.text(),
  nickname: t.optional(t.text()),
})
// { name: string; nickname?: string }

// nullable: must be present, can be null
t.object({
  name: t.text(),
  deletedAt: t.nullable(t.datetime()),
})
// { name: string; deletedAt: string | null }
```

`t.nullify(schema)` makes all properties nullable at once.

## Schema Manipulation

```typescript
// pick specific fields
t.pick(userSchema, ["id", "name"])

// remove fields
t.omit(userSchema, ["password"])

// make everything optional
t.partial(userSchema)

// extend with new fields
t.extend(baseSchema, { newField: t.text() })
```

## Compound Types

### Objects

```typescript
t.object({
  name: t.text(),
  age: t.integer(),
})
```

Additional properties are rejected by default. We're strict here.

### Arrays

```typescript
t.array(t.text())                    // max 1000 items by default
t.array(t.text(), { maxItems: 50 })  // custom limit
t.array(t.text(), { minItems: 1 })   // non-empty
```

The default limit prevents someone from sending you a million items.

### Records and Tuples

```typescript
t.record(t.text(), t.number())       // { [key: string]: number }
t.tuple([t.text(), t.number()])      // [string, number]
```

## Utility Types

```typescript
t.any()         // escape hatch
t.void()        // nothing
t.null()        // null
t.undefined()   // undefined
t.json()        // { [key: string]: any }
```

## Customizing Defaults

Alepha sets sane defaults. Change them if you need:

```typescript
import { TypeProvider } from "alepha";

TypeProvider.DEFAULT_STRING_MAX_LENGTH = 255;        // t.text()
TypeProvider.DEFAULT_SHORT_STRING_MAX_LENGTH = 64;   // t.shortText()
TypeProvider.DEFAULT_LONG_STRING_MAX_LENGTH = 1024;  // t.longText()
TypeProvider.DEFAULT_RICH_STRING_MAX_LENGTH = 65535; // t.richText()
TypeProvider.DEFAULT_ARRAY_MAX_ITEMS = 1000;         // t.array()
```

Or override per-field:

```typescript
t.text({ maxLength: 500 })
t.array(t.text(), { maxItems: 10 })
```

## Raw TypeBox

Need something we don't wrap? Access TypeBox directly:

```typescript
import { Type } from "alepha";

const schema = Type.String({ format: "custom" });
```

## Quick Reference

| Need | Use |
|------|-----|
| User input | `t.text()` |
| Internal string | `t.string()` |
| Short label | `t.shortText()` |
| Long description | `t.longText()` |
| Rich content | `t.richText()` |
| Email | `t.email()` |
| UUID | `t.uuid()` |
| Phone | `t.e164()` |
| Timestamp | `t.datetime()` |
| Date only | `t.date()` |
| File upload | `t.file()` |
| Exact value | `t.const("x")` |
| Choices | `t.enum(["a", "b"])` |
| Optional | `t.optional(schema)` |
| Nullable | `t.nullable(schema)` |
| Pick fields | `t.pick(schema, ["a"])` |
| Remove fields | `t.omit(schema, ["b"])` |
| All optional | `t.partial(schema)` |
| Add fields | `t.extend(schema, {})` |
| Get TS type | `Static<typeof schema>` |

Define your schema once. Alepha handles the rest.
