# Alepha Parameters Module - Technical Documentation

> **Module:** `alepha/api/parameters`
> **Status:** Stable
> **Location:** `packages/alepha/src/api/parameters/`

This document describes the current implementation of the versioned configuration system for planning the upcoming update.

---

## Overview

The Parameters module provides **versioned, scheduled configuration management** with:
- Type-safe configuration via `$config` primitive
- Version history with rollback support
- Scheduled activation (FUTURE → NEXT → CURRENT → EXPIRED)
- Cross-instance synchronization via pub/sub topic
- Schema migration detection
- Admin REST API for configuration management
- Tree view support via dot-notation naming

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        $config Primitive                         │
│  - Declares schema + default value                               │
│  - Provides .current, .get(), .set(), .sub(), .rollback()       │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                         ConfigStore                              │
│  - Persists versions to PostgreSQL                              │
│  - Manages status transitions                                    │
│  - Publishes sync events via topic                              │
│  - Provides getHistory(), getConfigTree(), etc.                 │
└─────────────────────────────────────────────────────────────────┘
                              │
              ┌───────────────┼───────────────┐
              ▼               ▼               ▼
┌──────────────────┐ ┌──────────────────┐ ┌──────────────────────┐
│  parameters      │ │  config:sync     │ │ ConfigActivation     │
│  (entity)        │ │  (topic)         │ │ Scheduler            │
│                  │ │                  │ │ (every 1 min)        │
└──────────────────┘ └──────────────────┘ └──────────────────────┘
```

---

## Components

### 1. `$config` Primitive

**File:** `primitives/$config.ts`

Declares a type-safe configuration with schema validation.

```typescript
class AppConfig {
  features = $config({
    name: "app.features.flags",        // Dot-notation for tree hierarchy
    description: "Feature toggles",    // Optional description
    schema: t.object({
      enableBeta: t.boolean(),
      maxUploadSize: t.number(),
    }),
    default: { enableBeta: false, maxUploadSize: 10485760 },
  });
}
```

**Properties & Methods:**

| Member | Type | Description |
|--------|------|-------------|
| `name` | `string` | Config name (from options or property key) |
| `schema` | `TObject` | TypeBox schema |
| `current` | `Static<T>` | Current configuration value |
| `get(key)` | `T[Key]` | Get specific field value |
| `set(value, options?)` | `Promise<void>` | Set new value (immediate or scheduled) |
| `sub(fn)` | `() => void` | Subscribe to changes, returns unsubscribe |
| `reload()` | `Promise<void>` | Reload from database |
| `getHistory()` | `Promise<Parameter[]>` | Get all versions |
| `rollback(version, options?)` | `Promise<void>` | Rollback to specific version |

**SetConfigOptions:**

```typescript
interface SetConfigOptions {
  user?: { id: string; email: string; name: string };  // Audit trail
  activationDate?: Date;          // Schedule future activation
  changeDescription?: string;     // What changed and why
  tags?: string[];                // Categorization
}
```

**Lifecycle:**
1. `onInit()` - Registers with ConfigStore, sets default in state, listens to `state:mutate`
2. `onStart` hook - Loads current value from database
3. On `state:mutate` - Auto-persists changes made via `alepha.set()`

---

### 2. `parameters` Entity

**File:** `entities/parameters.ts`

Database schema for storing configuration versions.

| Column | Type | Description |
|--------|------|-------------|
| `id` | `uuid` | Primary key |
| `createdAt` | `datetime` | Creation timestamp |
| `updatedAt` | `datetime` | Last update timestamp |
| `name` | `text` | Config name (dot-notation) |
| `content` | `json` | Configuration value |
| `schemaHash` | `text` | Hash for migration detection |
| `status` | `enum` | `expired` \| `current` \| `next` \| `future` |
| `activationDate` | `datetime` | When this version becomes active |
| `expiredAt` | `datetime?` | When this version was deactivated |
| `version` | `integer` | Auto-incremented per config name |
| `changeDescription` | `text?` | Description of changes |
| `tags` | `text[]?` | Tags for filtering |
| `creatorId` | `uuid?` | User who made the change |
| `creatorName` | `text?` | Display name for audit |
| `previousContent` | `json?` | Content before this change |
| `migrationLog` | `text?` | Schema migration notes |

**Indexes:**
- `(name, status)` - Fast lookup by name and status
- `(name, activationDate)` - Scheduled activation queries
- `(name, version)` UNIQUE - Version uniqueness per config
- `(status)` - Filter by status
- `(activationDate)` - Scheduler queries

---

### 3. ConfigStore Service

**File:** `services/ConfigStore.ts`

Core service managing persistence and synchronization.

**Key Methods:**

| Method | Description |
|--------|-------------|
| `register(config)` | Register a $config primitive |
| `load<T>(name)` | Load current value (CURRENT or NEXT) |
| `save(name, content, schemaHash, options)` | Create new version |
| `getHistory(name)` | Get all versions ordered by version desc |
| `getVersion(name, version)` | Get specific version |
| `rollback(name, targetVersion, options)` | Create new version with old content |
| `getByStatus(status)` | Get all configs with specific status |
| `getConfigNames()` | Get unique config names |
| `getConfigTree()` | Build tree structure from dot-notation names |
| `activateScheduledConfigs()` | Activate due NEXT configs |

**Status Transitions:**

```
FUTURE ──(activationDate approaches)──► NEXT ──(activationDate passes)──► CURRENT ──(new current)──► EXPIRED
```

**Cross-Instance Sync:**

Uses `$topic` named `config:sync` with payload:
```typescript
interface ConfigSyncPayload {
  name: string;
  version: number;
  content: unknown;
  status: ParameterStatus;
  instanceId: string;  // To avoid self-updates
}
```

---

### 4. AdminConfigController

**File:** `controllers/AdminConfigController.ts`

REST API for admin configuration management.

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/configs/tree` | GET | Tree structure of config names |
| `/configs` | GET | List all config names |
| `/configs/status/:status` | GET | Configs by status |
| `/configs/:name/history` | GET | Version history |
| `/configs/:name` | GET | Current + next + default values |
| `/configs/:name/versions/:version` | GET | Specific version |
| `/configs/:name` | POST | Create new version |
| `/configs/:name/rollback` | POST | Rollback to version |
| `/configs/:name/activate` | POST | Activate future version now |
| `/configs/activate-scheduled` | POST | Manual activation check |

All endpoints require `secure: true` (authentication).

---

### 5. ConfigActivationScheduler

**File:** `schedulers/ConfigActivationScheduler.ts`

Runs every 1 minute to check for scheduled configurations that should be activated.

```typescript
checkActivations = $scheduler({
  name: "config-activation-check",
  interval: [1, "minute"],
  lock: true,  // Distributed lock to avoid duplicate runs
  handler: async () => {
    await this.store.activateScheduledConfigs();
  },
});
```

---

## Usage Examples

### Basic Usage

```typescript
class AppConfig {
  features = $config({
    name: "app.features",
    schema: t.object({
      enableBeta: t.boolean(),
      maxUploadSize: t.number(),
    }),
    default: { enableBeta: false, maxUploadSize: 10485760 },
  });
}

// Read current value
const config = alepha.inject(AppConfig);
console.log(config.features.current.enableBeta);
console.log(config.features.get("maxUploadSize"));

// Update immediately
await config.features.set({ enableBeta: true, maxUploadSize: 20971520 });

// Subscribe to changes
const unsub = config.features.sub((newValue) => {
  console.log("Config changed:", newValue);
});
```

### Scheduled Activation

```typescript
// Schedule for future date
await config.features.set(
  { enableBeta: true, maxUploadSize: 20971520 },
  {
    activationDate: new Date("2024-03-01T00:00:00Z"),
    changeDescription: "Enable beta features for Q2 launch",
    user: { id: userId, email: "admin@example.com", name: "Admin" },
  }
);
```

### Rollback

```typescript
// Get history
const history = await config.features.getHistory();
// history = [{ version: 3, ... }, { version: 2, ... }, { version: 1, ... }]

// Rollback to version 1
await config.features.rollback(1, {
  changeDescription: "Reverting due to issues",
  user: currentUser,
});
```

### Tree View

Configs named with dot-notation build a navigable tree:
- `app.features.flags`
- `app.features.limits`
- `app.pricing.tiers`
- `system.logging`

Becomes:
```
app
├── features
│   ├── flags (leaf)
│   └── limits (leaf)
└── pricing
    └── tiers (leaf)
system
└── logging (leaf)
```

---

## State Integration

The `$config` primitive integrates with Alepha's state system:

1. **State Storage:** Uses `alepha.store.set(atomKey, value)` with key `config:{name}`
2. **Change Detection:** Listens to `state:mutate` events
3. **Auto-Persistence:** When state changes externally via `alepha.set()`, auto-saves to database
4. **Sync Flag:** Uses `syncing` boolean to prevent infinite loops

---

## Schema Migration

When saving a new version with a different schema hash:
1. Detects hash mismatch with previous version
2. Logs migration in `migrationLog` field
3. Stores `previousContent` for reference

```typescript
// migrationLog example:
"Schema changed from abc123 to def456 at version 5"
```

---

## File Structure

```
packages/alepha/src/api/parameters/
├── index.ts                    # Module definition (AlephaApiParameters)
├── index.browser.ts            # Browser exports (schemas only)
├── controllers/
│   └── AdminConfigController.ts
├── entities/
│   └── parameters.ts
├── primitives/
│   ├── $config.ts
│   └── $config.spec.ts
├── schedulers/
│   └── ConfigActivationScheduler.ts
├── schemas/
│   ├── index.ts
│   ├── parameterStatusSchema.ts
│   ├── configTreeNodeSchema.ts
│   └── ... (15 schema files)
└── services/
    └── ConfigStore.ts
```

---

## Known Limitations / Areas for Improvement

1. **Schema Hash:** Uses simple string hash, not cryptographic
2. **No Validation on Load:** Loaded values aren't validated against current schema
3. **No Diff View:** API returns full content, no field-level diff
4. **No Approval Workflow:** No multi-step approval before activation
5. **No Environment Support:** No concept of dev/staging/prod configs
6. **No Encryption:** Sensitive config values stored in plain JSON
7. **Single Topic:** All configs share one sync topic
8. **No Batch Operations:** Can't update multiple configs atomically
9. **No Import/Export:** No bulk config migration tools
10. **No UI Component:** Admin UI not included in module

---

## Dependencies

- `alepha` (core)
- `alepha/logger` - Logging
- `alepha/orm` - Database access (`$repository`, `$entity`)
- `alepha/topic` - Pub/sub for sync
- `alepha/datetime` - Time utilities
- `alepha/server` - `$action` for REST API
- `alepha/scheduler` - Periodic activation checks
- `alepha/security` - User types for audit trail
