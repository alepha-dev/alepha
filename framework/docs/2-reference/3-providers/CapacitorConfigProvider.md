# CapacitorConfigProvider

## Import

```typescript
import { CapacitorConfigProvider } from "@alepha/capacitor/core";
```

## Overview

The public configuration of a native shell, as its build baked it.

`alepha capacitor sync`, `build` and `dev` hand it to the client bundle as
the Vite `define` `__ALEPHA_CAPACITOR__`. A web build never defines it, and
its absence is how the rest of `@alepha/capacitor/core` knows it runs in a
plain website: nothing it configures then changes.

On `configure`, in a shell only:

- every host-less `$client` is pointed at the shell's API: the WebView's own
  origin (`capacitor://localhost`, `https://localhost`) serves the shell
  and nothing else;
- the router's bounded boot is turned on (`reactBootOptions.offline`): an
  API that cannot be reached commits the offline screen within the boot
  deadline instead of leaving a blank WebView behind the splash. Keyed on
  the shell, not on `isNativePlatform()`, so the same shell opened in a
  browser boots exactly as a phone does.
