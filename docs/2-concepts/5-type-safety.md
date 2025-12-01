# Type Safety (The `t` Object)

In many full-stack frameworks, you end up defining your data structures three times:
1.  Once for the Database (SQL/ORM)
2.  Once for the API Validation (Zod/Joi)
3.  Once for TypeScript interfaces

If you change one, you have to change the others. It's exhaustive and error-prone.

Alepha solves this with the `t` object.

## One Schema to Rule Them All

Alepha uses **TypeBox** (wrapped as `t`) as its schema definition language. We chose TypeBox because it compiles down to standard JSON Schema, which is extremely portable.

When you define an object with `t`, Alepha uses it for everything:

```typescript
const userSchema = t.object({
  username: t.text(),
  age: t.integer()
});
```

1.  **Runtime Validation:** Used by `$action` to validate incoming HTTP JSON bodies.
2.  **Database Definition:** Used by `$entity` to generate `CREATE TABLE` statements (String -> VARCHAR, Integer -> INT4).
3.  **TypeScript Inference:** Used by your IDE to give you autocomplete (`user.username`).
4.  **Documentation:** Used by `$swagger` to generate OpenAPI specs.

## Specialized Types

We extended TypeBox with Alepha-specific helpers to cover common app scenarios without regex soup.

*   `t.text()`: A **safe string**. Unlike raw `t.string()`, it enforces a max length (default 255) and auto-trims whitespace. This prevents memory attacks and common input issues out of the box.
*   `t.email()`: Validates email format.
*   `t.date()` / `t.datetime()`: Handles ISO date strings.
*   `t.file()`: Handles file uploads (multipart/form-data).
*   `t.uuid()`: Validates UUID format.

```typescript
// t.text() is safe by default
const schema = t.object({
  name: t.text(),                    // max 255 chars, trimmed
  bio: t.text({ maxLength: 1000 }), // custom max length
  code: t.text({ trim: false }),    // disable auto-trim
});
```

Use `t.text()` for user input. Reserve `t.string()` for internal identifiers or when you explicitly need no limits.

## Usage Example

You don't need to manually infer types. It happens automatically.

```typescript
// Define schema
const inputSchema = t.object({
  search: t.text(),
  page: t.number()
});

// TypeScript type helper
import { type Static } from "alepha";
type Input = Static<typeof inputSchema>;
// Input is now: { search: string; page: number }
```

Alepha providers (like the `CodecManager`) handle the serialization/deserialization for you, ensuring that a `t.date()` coming from a JSON API ends up as a real Date object (or DayJS object) in your code, not just a string.
