# $hook

## Import

```typescript
import { $hook } from "alepha";
```

## Overview

Registers a new hook.

```ts
import { $hook } from "alepha";

class MyProvider {
  onStart = $hook({
    on: "start", // or "configure", "ready", "stop", ...
    handler: async (app) => {
      // await db.connect(); ...
    }
  });
}
```

Hooks are used to run async functions from all registered providers/services.

You can't register a hook after the App has started.

It's used under the hood by the `configure`, `start`, and `stop` methods.
Some modules also use hooks to run their own logic. (e.g. `alepha/server`).

You can create your own hooks by using module augmentation:

```ts
declare module "alepha" {

  interface Hooks {
    "my:custom:hook": {
      arg1: string;
    }
  }
}

await alepha.events.emit("my:custom:hook", { arg1: "value" });
```

## Options

| Option | Type | Required | Description |
|--------|------|----------|-------------|
| `on` | `T` | Yes | The name of the hook |
| `handler` | `Object` | Yes | The handler to run when the hook is triggered. |
| `priority` | `"first" \| "last"` | No | Force the hook to run first or last on the list of hooks. |
| `before` | `object \| Array&lt;object&gt;` | No | Run this hook before the hooks owned by the specified services. |
| `after` | `object \| Array&lt;object&gt;` | No | Run this hook after the hooks owned by the specified services. |

