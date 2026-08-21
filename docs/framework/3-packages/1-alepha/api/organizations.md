# Alepha - Api Organizations

## Installation

Part of the `alepha` package. Import from `alepha/api/organizations`.

```bash
npm install alepha
```

## Overview

Organization management for multi-tenancy.

**Features:**

- Admin CRUD for organizations
- Organization scoping via `db.organization()` on entities
- User with no organization = god mode (sees all resources)
- User with an organization = scoped to that organization
