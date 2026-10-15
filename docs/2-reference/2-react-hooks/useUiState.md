# useUiState

## Import

```typescript
import { useUiState } from "alepha/react/ui";
```

## Overview

The visitor's UI preferences, read so that no server render ever depends
on them.

The server and the client's hydration pass both see the DEFAULT
preferences: the server never reads `uiAtom` at all, so a page whose markup
uses this stays shareable by the page cache (#E78), and the first client
render agrees with any prerendered or cached HTML. The visitor's real value
arrives on the first commit after hydration.

What must be right before that commit, the dark class, the theme class,
the collapsed sidebar, is painted by the boot script `UiPersistence`
injects, from the cookie, onto `<html>`.
