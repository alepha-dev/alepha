# useSidebarState

## Import

```typescript
import { useSidebarState } from "alepha/react/ui";
```

## Overview

Read and update the sidebar collapsed state. The value is persisted via the
`alepha-ui` cookie so it survives reloads and is available during SSR - no
flash of expanded-then-collapsed when the user prefers a collapsed shell.

## ⚠️ During hydration it answers what the server rendered

The browser seeds `uiAtom` from the cookie at boot, and the SSR payload
overrides it only when the payload carries the atom. A page rendered for the
request carries it, read from the same cookie, so the two agree. A
PRERENDERED page was built with no cookie: its HTML holds the expanded
shell, its payload holds no ui state, and the store holds the visitor's
collapsed preference. Rendering the store value in the hydration pass drew
the other trigger icon over the HTML's and threw React #418 on every load
(#Q2347).

So for the hydration pass this returns the value the page was rendered
with: the payload's, or the atom's default when the payload carries none.
From the next render on it returns the stored preference. On a page
rendered for the request nothing moves; on a prerendered page a collapsed
visitor sees the expanded shell for one frame, then theirs.

⚠️ Read here, not through an injected service: an app may render the shell
without registering `alepha.react.ui`, and a service injected after start
is refused.

## Examples

const { collapsed, setCollapsed, toggle } = useSidebarState();
