# $middleware

## Import

```typescript
import { $middleware } from "alepha/server";
```

## Overview

Applies middleware functions to every route whose path starts with a prefix.

Use it for cross-cutting behavior (auth headers, logging, shaping) that
should cover a whole path family rather than one action - per-action
middleware belongs in the action's own `use: [...]`.

## Options

| Option    | Type                           | Required | Description                                               |
| --------- | ------------------------------ | -------- | --------------------------------------------------------- |
| `path`    | `string`                       | Yes      | Path prefix                                               |
| `use`     | `Middleware[]`                 | Yes      | Middleware functions to apply to matching routes.         |
| `method`  | `RouteMethod \| RouteMethod[]` | No       | Limit middleware to specific HTTP methods                 |
| `exclude` | `string[]`                     | No       | Exclude specific route paths from middleware application. |

## Examples

```typescript
class Security {
  api = $middleware({
    path: "/api",
    use: [myRateLimiter()],
  });
}
```
