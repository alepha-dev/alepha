# Conventions

`alepha check` reads your source and refuses a small set of constructs. They are not style rules: each one protects a property the framework sells. A clock a test can move, an error a client can catch by type, a service a spec can replace. Every one of them is easy to break by accident, by a person or by an agent, and silent once broken, so a command checks them instead of a review.

```bash
npx alepha check              # every rule, the whole project
npx alepha check src/api      # one directory or file
npx alepha check --rule no-date-now
npx alepha check --json       # the findings as data, for an agent or an editor
npx alepha check --list       # the rules this version knows
```

Each finding prints the file and line, the rule id, and what to write instead:

```
src/api/services/OrderService.ts:42  no-date-now
  Date.now() cannot be travelled in a test. Inject DateTimeProvider and call this.dateTime.nowMillis() (or now()), so a test can travel(). In a component, useInject(DateTimeProvider).
```

The command exits 1 on any finding. It reads the source only: it never boots the app, so it works on a project that does not compile yet. `alepha verify` runs it between lint and typecheck.

The full list, with each rule's description and fix as the installed version prints them, is the [conventions reference](/docs/reference-conventions). This page explains why each rule exists.

## What it reads

Every `.ts` and `.tsx` file from the project root down, `.d.ts` excluded. It skips `node_modules`, `dist`, `.gen` and every dot-directory, and honours the root `.gitignore`. Rules about application code skip tests (`*.spec.*`, `*.test.*`, and anything under `__tests__/`, `test/`, `e2e/` or `fixtures/`); the two test rules read only those.

## The rules

### `no-date-now`

`Date.now()` reads the wall clock, and nothing in a test can move it. `DateTimeProvider` can: `travel()` and `pause()` make an expiry, a retry or a schedule testable without waiting.

```typescript check
export class SessionService {
  isExpired(expiresAt: number): boolean {
    return Date.now() > expiresAt;
  }
}
```

```typescript check
import { $inject } from "alepha";
import { DateTimeProvider } from "alepha/datetime";

export class SessionService {
  protected readonly dateTime = $inject(DateTimeProvider);

  isExpired(expiresAt: number): boolean {
    return this.dateTime.nowMillis() > expiresAt;
  }
}
```

`new Date()` with no argument is not refused. In a component, `useInject(DateTimeProvider)` gives the same clock.

### `no-bare-error`

A bare `Error` has no name a caller can catch by type, and the browser cannot rebuild it from a response body. `AlephaError` is the plain failure; an `$error` constant is one a caller can act on. Only `Error` itself is refused: `TypeError` and the other built-ins are not.

```typescript check
export const findOrder = (id: string) => {
  throw new Error(`Order ${id} not found`);
};
```

```typescript check
import { AlephaError } from "alepha";

export const findOrder = (id: string) => {
  throw new AlephaError(`Order ${id} not found`);
};
```

### `no-error-class`

`$error({ name, schema })` declares an error the registry knows by name, so it survives the trip to the browser and `instanceof` holds on both sides. A hand-written class is invisible to that registry and comes back as a plain error. The rule reads the superclass: any class extending something whose name ends in `Error`.

```typescript check
export class QuotaExceeded extends Error {}
```

```typescript check
import { $error, z } from "alepha";

export const QuotaExceeded = $error({
  name: "QUOTA_EXCEEDED",
  schema: z.object({ limit: z.number() }),
  message: "Quota exceeded",
});
```

A more specific error derives from another with `Parent.extend({ name })`.

### `no-zod-import`

The framework's `z` carries its own defaults and extensions (`z.text()`, `z.integer()`). A second copy of `zod` builds schemas that are not type-compatible with it, and an `$action` typed with one refuses the other.

```typescript check
import { z } from "zod";

export const orderSchema = z.object({ id: z.string() });
```

```typescript check
import { z } from "alepha";

export const orderSchema = z.object({ id: z.text() });
```

### `no-vi-mock`

`vi.mock`, `vi.doMock`, `vi.spyOn`, `vi.useFakeTimers` and `vi.setSystemTime` replace a module, a method or the clock behind the container's back, so the spec exercises a wiring the app never runs. Substitute the service in the container instead, and move time with `DateTimeProvider`. `vi.fn()`, `vi.stubGlobal()` and `vi.stubEnv()` are allowed: they substitute nothing the container owns.

```typescript check
import { Alepha } from "alepha";
import { EmailProvider } from "alepha/email";
import { describe, it, vi } from "vitest";

describe("signup", () => {
  it("sends a welcome email", async () => {
    const alepha = Alepha.create();
    const send = vi.spyOn(alepha.inject(EmailProvider), "send");
    void send;
  });
});
```

```typescript check
import { Alepha } from "alepha";
import { EmailProvider, MemoryEmailProvider } from "alepha/email";
import { describe, it } from "vitest";

describe("signup", () => {
  it("sends a welcome email", async () => {
    const alepha = Alepha.create().with({
      provide: EmailProvider,
      use: MemoryEmailProvider,
    });
    const emails = alepha.inject(MemoryEmailProvider);
    void emails;
  });
});
```

### `describe-it`

A case at the top level of a spec has no subject in the reporter and no handle for `vitest run -t`. Wrap the cases in a `describe` named after the unit. Playwright files are exempt (under `e2e/`, named `*.e2e.ts`, or importing `@playwright/test`): Playwright's API is `test`.

```typescript check
import { expect, it } from "vitest";

it("adds", () => {
  expect(1 + 1).toBe(2);
});
```

```typescript check
import { describe, expect, it } from "vitest";

describe("math", () => {
  it("adds", () => {
    expect(1 + 1).toBe(2);
  });
});
```

### `no-module-code`

A function or a constant beside the class, in a `services/`, `providers/`, `controllers/` or `jobs/` directory, cannot be substituted through the container: a test cannot replace it and a subclass cannot override it. On the class, as a `protected` member, it can. `schemas/`, `entities/`, `atoms/` and `errors/` hold module-level constants by definition and are never read; a second class, an `enum`, a `type` or an `interface` is not reported.

```typescript check
const TTL_MS = 60_000;

export class CacheService {
  isFresh(storedAt: number, now: number): boolean {
    return now - storedAt < TTL_MS;
  }
}
```

```typescript check
export class CacheService {
  protected readonly ttlMs = 60_000;

  isFresh(storedAt: number, now: number): boolean {
    return now - storedAt < this.ttlMs;
  }
}
```

### `no-window-dialog`

`window.confirm()`, `alert()` and `prompt()` block the page, cannot be styled, and are what an automated browser dismisses without a trace. `useDialog` from `@alepha/ui` renders the same three as components, awaitable like the originals. The rule applies only where `@alepha/ui` is a dependency, and a bare `confirm()` is reported only when the file binds no `confirm` of its own.

```typescript check
export const remove = (id: string) => {
  if (!window.confirm(`Delete ${id}?`)) return;
};
```

```typescript check
import { useDialog } from "@alepha/ui";

export const useRemove = () => {
  const dialog = useDialog();
  return async (id: string) => {
    if (!(await dialog.confirm({ title: `Delete ${id}?` }))) return;
  };
};
```

## Exemptions

A line that is a genuine exception carries a comment on the line above it, with the reason:

```typescript check
import { $inject } from "alepha";
import { DateTimeProvider } from "alepha/datetime";

export class Clock {
  protected readonly dateTime = $inject(DateTimeProvider);

  wall(): number {
    // alepha-allow no-date-now: the one place that reads the real clock
    return Date.now();
  }
}
```

The reason is mandatory, and an exemption without one is itself a finding. That is deliberate: a list of exceptions with no reasons becomes a list nobody dares touch, because nobody can tell which entries are still needed. Several exemption lines stacked above one statement all apply to it. An exemption that names no rule, or that suppresses nothing on the line below it, is reported too, so a stale one does not linger and cover the next real violation on that line.

## Configuration

Every rule is on by default. The `check` key of `alepha.config.ts` turns one off, or hides paths from every rule:

```typescript
import { defineConfig } from "alepha/cli/config";

export default defineConfig({
  check: {
    rules: { "no-module-code": "off" },
    ignore: ["src/legacy/**"],
  },
});
```

`ignore` takes `.gitignore`-style globs relative to the project root. There is no per-rule path scope: exempt the line instead. A rule id the version does not know is refused, with the list of valid ones.

`check: false` removes the step from `alepha verify`, and nothing else: `alepha check` typed by hand still runs.

## Upgrading an existing app

`alepha verify` runs `check` from the version that ships it on, in every app, with no key to add. An app that already holds a violation fails its first `verify` after the upgrade, and that is intended: a rule nobody sees is the situation the command exists to end.

Run `npx alepha check` to see the list, then, for each finding:

1. fix it, as the line under it says;
2. or exempt that one line with its reason;
3. or turn that one rule `off` in `check.rules` while the others stay on.

`check: false` removes the step altogether, if the app is not ready for any of it.
