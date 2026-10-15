# $error

## Import

```typescript
import { $error } from "alepha/server";
```

## Overview

Declares a typed error with a code, an HTTP status and an optional data schema.

The `data` schema types the payload the client receives with the error.

`$error` returns an `HttpError` subclass. Declare it once at module level,
like `$atom`, in a file the browser can load (`src/errors/QuotaExceeded.ts`),
and throw it from any layer: a service needs no reference to the action
that will answer it.

```ts
export const QuotaExceeded = $error({
  code: "QuotaExceeded",
  status: 409,
  data: z.object({ limit: z.number(), used: z.number() }),
});

export const UserNotFound = $error({ code: "UserNotFound", status: 404 });

throw new QuotaExceeded({ limit: 5, used: 6 }); // data required and typed
throw new UserNotFound({ message: "No such user" }); // every argument optional

if (e instanceof QuotaExceeded) e.data.limit; // narrows, data typed
```

- `code` is required, PascalCase, and equal to the constant's name: it is
  what the `error` field of the JSON body carries, the same vocabulary as
  the built-in errors (`"NotFoundError"`). The factory cannot see the
  constant's name, so it has to be spelled.
- The constant registers itself in `HttpError.registry` when its module is
  evaluated, so `HttpClient` rebuilds it by code and `instanceof` holds in
  the browser.
- Not a container primitive: nothing ties it to an `Alepha` instance, and
  the browser constructs it too.
- A name for signatures is optional:
  `export type QuotaExceeded = InstanceType<typeof QuotaExceeded>;`.

List it in a `$action`'s `errors` to make it part of that action's
contract.

## Options

| Option    | Type     | Required | Description                                   |
| --------- | -------- | -------- | --------------------------------------------- |
| `code`    | `C`      | Yes      | The wire code, written into the `error` field |
| `status`  | `number` | Yes      | The HTTP status the error answers with.       |
| `data`    | `D`      | No       | Schema of the payload the error carries       |
| `message` | `string` | No       | Default message                               |
