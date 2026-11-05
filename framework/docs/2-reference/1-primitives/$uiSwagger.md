# $uiSwagger

## Import

```typescript
import { $uiSwagger } from "@alepha/ui/swagger";
```

## Overview

An API explorer page, reading the app's OpenAPI document.

`alepha/server/swagger` serves the document only (`$swagger`, at
`/docs/json` by default); this is the viewer, built on `@alepha/ui`. It
lists the operations by tag with a search, and shows each in full:
parameters, request body, responses, their schemas, and what Alepha
declared about it (the action, who may call it, middlewares, declared
errors, timeout) from the `x-alepha-*` extensions. Each operation can be
called from a form built from its schemas, as the signed-in user (the
session cookie) or with a token typed in, and a gated one says whether the
viewer's permissions reach it.

The page and the document share the `/docs` prefix by default, which is
fine: the page is `/docs`, the document `/docs/json`.

```ts
import { $uiSwagger } from "@alepha/ui/swagger";
import { $swagger } from "alepha/server/swagger";

class App {
  openapi = $swagger({ info: { title: "Shop API", version: "1.0.0" } });
  docs = $uiSwagger();
}
```

It carries the `$` prefix to sit with the framework's other declarations
at a call site, but it is a plain function wrapping `$page`, like
`$pageAdmin`. The page component is a lazy chunk, so an app pays for the
explorer only when someone opens it.

## Options

| Option   | Type           | Required | Description                                                                                                                           |
| -------- | -------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `name`   | `string`       | No       | The page's name in the router, for `router.push(name)`.                                                                               |
| `path`   | `string`       | No       | Where the explorer is mounted.                                                                                                        |
| `spec`   | `string`       | No       | Where the OpenAPI document is served: `&lt;prefix&gt;/json` of the app's `$swagger`, or any OpenAPI 3 document the browser may fetch. |
| `title`  | `string`       | No       | The browser tab's title.                                                                                                              |
| `signIn` | `string`       | No       | Where to sign in, linked from a gated operation when nobody is signed in.                                                             |
| `use`    | `Middleware[]` | No       | Middlewares guarding the page, `[$secure({ roles: ["admin"] })]` for an explorer only the team should see                             |
