# DeepLinkProvider

## Import

```typescript
import { DeepLinkProvider } from "@alepha/capacitor/core";
```

## Overview

Custom-scheme deep links: `<scheme>://app/<path>?query#hash` opens that
path of the app.

- **Cold:** the link that launched the app is staged as the router's first
  URL (`ReactBrowserProvider.initialUrlResolver`), before the first
  transition: the WebView itself always loads `index.html`.
- **Warm:** a link opened while the app runs is pushed onto the router.
- Only the shell's own scheme (from its public config, so a variant only
  ever answers its own) and the host `app` are routes. Anything else is
  ignored: another scheme or host, user info, a malformed encoding, a `..`
  segment. Nothing about a refused link is logged beyond its scheme.
- `<scheme>://auth/callback` is reserved for a sign-in finished in the
  system browser. It goes to `authCallback` when one is installed and
  is refused by name otherwise, never routed.

The same link reported twice (as the launch URL and as an `appUrlOpen`
event, which iOS does on a cold start) is handled once.

The web implementation (this class) listens to nothing: a website has its
URL bar. The native one reads `@capacitor/app`.
