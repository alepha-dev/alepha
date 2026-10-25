# OtaProvider

## Import

```typescript
import { OtaProvider } from "@alepha/capacitor/ota";
```

## Overview

The device side of live updates: a manual, self-hosted policy over the
pinned updater.

**Health.** On every configured, non-dev native boot (built-in or live
layer alike) the updater is told the layer is healthy once the first
screen settles healthy (`react:boot:settled`), the offline screen
included: an unreachable or stalled API never rolls a working bundle
back, and nothing waits for the API, the session or a protected loader.
A failed first screen is never acknowledged, so the updater reverts it.

**Checks.** On boot, on every return to the foreground, and every ten
minutes while the app stays in front, one at a time:
the server names the bundle this device should run, and the device
reconciles:

- a bundle it does not have: download, verify (the plugin checks the
  Capgo v2 envelope and checksum), and apply it on the next background
  or restart (`next`). Never a reload in front of the user;
- a bundle it already holds, an older one included (a rollback): apply
  that one on the next background;
- "up to date": whatever it holds waiting is cancelled (a kill switch, a
  rollback, a rollout pulled back reach the device this way);
- `builtin`: back to the binary's own layer on the next background;
- blocked or failed: nothing changes.

A failed download is retried once at once with a fresh check (a link may
have expired), then on later resumes with a growing delay. A bundle the
updater rolled back from, or that failed to download twice, is never
fetched again on this device. The kill switch reaches a device at its next
contact: nothing can undo a bundle on a device that stays offline. A
bundle downloaded and still waiting is withdrawn by the foreground check;
one the background already activated runs until the resume check, then
gives way on the next background.

Inert, and saying why in the log, in a browser, in `dev` mode, and in a
shell built without the updater.
