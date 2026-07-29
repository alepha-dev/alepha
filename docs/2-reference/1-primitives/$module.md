# $module

## Import

```typescript
import { $module } from "alepha";
```

## Overview

Wrap Services and Primitives into a Module.

- A module is just a Service with some extra {@link Module}.
- You must attach a `name` to it.
- Name must follow the pattern: `project.module.submodule`. (e.g. `myapp.users.auth`).

## Options

| Option | Type | Required | Description |
|--------|------|----------|-------------|
| `name` | `string` | Yes | Name of the module |
| `services` | `Array&lt;Service&gt;` | No | Services that belong to this module |
| `variants` | `Array&lt;Service&gt;` | No | Alternative implementations that belong to this module but are NOT auto-injected |
| `imports` | `Array&lt;Service&lt;Module&gt;&gt;` | No | Other modules this module depends on |
| `primitives` | `Array&lt;PrimitiveFactoryLike&gt;` | No | List of $primitives to register in the module. |
| `register` | `Object` | No | Additive side-effect hook |
| `atoms` | `Array&lt;Atom&lt;any&gt;&gt;` | No | List of atoms to register in the module. |

## Examples

```ts
import { $module } from "alepha";
import { MyService } from "./MyService.ts";

export default $module({
 name: "my.project.module",
 services: [MyService],
});
```

### Slots

- `services[]` — always auto-injected. Module metadata attached.
- `variants[]` — module metadata attached but NOT auto-injected. Two typical uses:
  (1) alternative implementations picked at register-time via `alepha.with({ provide, use })`;
  (2) services whose instantiation is driven externally (e.g., the framework core).
- `imports[]` — other modules this one depends on. Wired after `register()`
  runs and before `services[]` are injected.
- `atoms[]` — registered on the store, first.
- `primitives[]` — tagged with module metadata.
- `register(alepha)` — purely additive side-effect hook. Runs after `atoms[]`
  and BEFORE `imports[]` are wired and `services[]` are auto-injected — so
  substitutions it records (e.g. `alepha.with({ provide, use })`) apply to
  the subsequent auto-injection. It can never suppress auto-registration.

### Why Modules?

#### Logging

By default, AlephaLogger will log the module name in the logs.
This helps to identify where the logs are coming from.

You can also set different log levels for different modules.

#### Modulith

Force to structure your application in modules, even if it's a single deployable unit.
It helps to keep a clean architecture and avoid monolithic applications.

### When not to use Modules?

Small applications do not need modules. Modules earn their keep when the application
grows — as a rule of thumb, once a module has 30+ `$actions`, consider splitting it.

