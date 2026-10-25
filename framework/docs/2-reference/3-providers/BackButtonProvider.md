# BackButtonProvider

## Import

```typescript
import { BackButtonProvider } from "@alepha/capacitor/core";
```

## Overview

The Android back button, as a chain rather than a registry of overlays.

A press runs the registered handlers, the last registered first, until one
returns `true`; then goes back in the app's history when
`ReactRouter.canGoBack` says there is somewhere to go; and only at the root
entry exits the app. `canGoBack` counts the app's own entries, so a cold
start or a deep link is the root, and back from it exits.

The web implementation (this class) listens to nothing and never exits: a
browser has its own back button. The native one listens to `@capacitor/app`,
which disables the WebView's default back behavior once a listener exists.
