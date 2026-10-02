# ScopeGrantsProvider

## Import

```typescript
import { ScopeGrantsProvider } from "alepha/server/links";
```

## Overview

What the viewer may do inside the scope the UI is currently rendering.

`LinkProvider.can("createQuest")` answers one question today: is that action
in the registry the server sent me. The server prunes an action whose
`$secure` permissions the caller's roles do not carry, so that answer is
**application scope** - it is the same for every project, team or workspace
the viewer can open.

An application where a member's powers vary per resource needs a second
question answered by the same call, or every screen has to remember to ask
twice and the ones that forget render a button that 403s. That is what this
provider is: `can()` consults it, and its default says there is no scope, so
an application that never substitutes it gets exactly today's answers.

## Synchronous, on purpose

`can()` runs during render, on the server and in the browser, and the two
have to agree or the markup drifts on hydration. So the scope's permission
set is something the page's loader has already put somewhere readable - an
atom, typically - and this reads it. It is not a place to fetch from.

```ts
class ProjectScopeGrants extends ScopeGrantsProvider {
  protected readonly alepha = $inject(Alepha);

  public override current(): readonly string[] | undefined {
    return this.alepha.store.get(currentProjectAtom)?.permissions;
  }
}

alepha.with({ provide: ScopeGrantsProvider, use: ProjectScopeGrants });
```
