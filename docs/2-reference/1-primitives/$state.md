# $state

## Import

```typescript
import { $state } from "alepha";
```

## Overview

Subscribes to an atom's state and returns its current value for use in components.

Creates a reactive connection between an atom and a component, automatically registering
the atom in the application state if not already registered. The returned value is reactive
and will update when the atom's state changes.

**Use Cases**: Accessing global state, sharing data between components, reactive UI updates

## Examples

```ts
const userState = $atom({ schema: t.object({ name: t.text(), role: t.text() }) });

class UserComponent {
  user = $state(userState); // Reactive reference to atom state

  render() {
    return <div>Hello {this.user.name}!</div>;
  }
}
```

