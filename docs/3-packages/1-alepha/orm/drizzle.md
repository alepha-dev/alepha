# Alepha - Orm Drizzle

## Installation

Part of the `alepha` package. Import from `alepha/orm/drizzle`.

```bash
npm install alepha
```

## Overview

The escape hatch from `alepha/orm` to drizzle itself.

⚠️ Outside semver. It re-exports `drizzle-orm` and `drizzle-orm/pg-core`
as the pinned drizzle release defines them, and `Drizzle` gives the
drizzle table, database and transaction behind a repository. A drizzle
upgrade can change any of it in a minor version of Alepha. `sql` and `SQL`
are the exception: `alepha/orm` re-exports them and keeps them stable.
