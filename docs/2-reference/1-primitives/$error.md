# $error

## Import

```typescript
import { $error } from "alepha";
```

## Overview

Declares an error: a name, and a schema for the data it carries.

`$error` returns a class, declared once at module level like `$atom`. Throw
it from anywhere, and derive more specific errors from it with `.extend`:

```ts
export const QuotaExceeded = $error({
  name: "QUOTA_EXCEEDED",
  schema: z.object({ limit: z.number(), used: z.number() }),
  default: { limit: 5 },
  message: "Quota exceeded",
});

throw new QuotaExceeded({ used: 6 }); // `limit` has a default
throw new QuotaExceeded({ used: 6 }, { message: "Upgrade", cause });

if (error instanceof QuotaExceeded) error.data.used; // narrows, typed
```

- `name` is SCREAMING_SNAKE (`"QUOTA_EXCEEDED"`). It is the error's
  `Error.name` and its identity on the wire, so it must be unique.
- `schema` types `data`. `default` makes the keys it covers optional when
  constructing; when every key is optional, `new X("message", { cause })`
  works as it does for `Error`.
- `message` is the default message, a string or a function of the data.
- `.extend({ name, schema?, default?, message? })` derives a real subclass
  (`instanceof` the parent holds), its schema merged into the parent's and
  its defaults over the parent's.
- Every declared error registers under its name, so `X.fromJSON(json)`
  rebuilds the right class from `X.toJSON(error)`, across a process or a
  network.

HTTP errors are one family of declared errors: `HttpError` from
`alepha/server` is an `$error` whose schema carries `status`, and
`NotFoundError` is `HttpError.extend({ name: "NOT_FOUND", default: { status: 404 } })`.

## Options

| Option        | Type                                 | Required | Description                                                          |
| ------------- | ------------------------------------ | -------- | -------------------------------------------------------------------- |
| `name`        | `string`                             | Yes      | The error's name: SCREAMING_SNAKE, unique, its identity on the wire. |
| `schema`      | `S`                                  | No       | Schema of `data`                                                     |
| `default`     | `D`                                  | No       | Default data                                                         |
| `message`     | `string \| ((data: T) =&gt; string)` | No       | The default message, or a function of the data                       |
| `description` | `string`                             | No       | Prose for OpenAPI and the docs.                                      |
