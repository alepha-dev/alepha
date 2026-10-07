# SplashScreenProvider

## Import

```typescript
import { SplashScreenProvider } from "@alepha/capacitor/core";
```

## Overview

The native launch splash. A no-op on the web, which has none.

`NativeChrome` hides it when the first screen settles; the shell's
`launchShowDuration` is only a backstop for a WebView whose JavaScript never
got that far.
