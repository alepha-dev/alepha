# $mode

## Import

```typescript
import { $mode } from "alepha";
```

## Overview

Activate a selective bootstrap mode.

When the environment condition matches, the owning class becomes `alepha.target`:
the DI graph is pruned to only this class and its transitive dependencies.
Everything else (HTTP server, job scheduler, etc.) is discarded.

Returns `true` if the mode is active, `false` otherwise.

## Examples

```ts
import { $mode, $inject } from "alepha";
import { DatabaseProvider } from "alepha/orm";

class DbMigrationMode {
  db = $inject(DatabaseProvider);

  mode = $mode({
    env: "MIGRATE",
    ready: async () => {
      await this.db.migrate();
    },
  });
}
```

```bash
MIGRATE=true node app.js    # runs migrations, then exits
MODE=MIGRATE node app.js    # same effect
```

