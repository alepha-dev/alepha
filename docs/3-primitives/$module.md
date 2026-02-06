# $module

> Wrap Services and Primitives into a Module.

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
| `services` | `Array&lt;Service&gt;` | No | List all services related to this module |
| `primitives` | `Array&lt;PrimitiveFactoryLike&gt;` | No | List of $primitives to register in the module. |
| `register` | `Object` | No | By default, module will register ALL services |
| `atoms` | `Array&lt;Atom&lt;any&gt;&gt;` | No | List of atoms to register in the module. |

## Examples

```ts
import { $module } from "alepha";
import { MyService } from "./MyService.ts";

// export MyService, so it can be used everywhere (optional)
export * from "./MyService.ts";

export default $module({
 name: "my.project.module",
 // MyService will have a module context "my.project.module"
 services: [MyService],
});
```

### Why Modules?

#### Logging

By default, AlephaLogger will log the module name in the logs.
This helps to identify where the logs are coming from.

You can also set different log levels for different modules.
It means you can set 'some.very.specific.module' to 'debug' and keep the rest of the application to 'info'.

#### Modulith

Force to structure your application in modules, even if it's a single deployable unit.
It helps to keep a clean architecture and avoid monolithic applications.

A strict mode flag will probably come to enforce module boundaries.
-> Throwing errors when a service from another module is injected.
But it's not implemented yet.

### When not to use Modules?

Small applications does not need modules. It's better to keep it simple.
Modules are more useful when the application grows and needs to be structured.
If we speak with number of `$actions`, a module should be used when you have more than 30 actions in a single module.
Meaning that if you have 100 actions, you should have at least 3 modules.

