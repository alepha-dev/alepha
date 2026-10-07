# NativeAuthTransport

## Import

```typescript
import { NativeAuthTransport } from "@alepha/capacitor/core";
```

## Overview

`ReactAuth`'s transport inside a native shell: password sign-in against
the API's origin, the session in secure storage, a Bearer header instead of
cookies.

- Every auth request goes to the shell's `apiUrl` with `credentials:
"omit"`: a cookie of the API's origin would never reach a WebView on
  `capacitor://localhost`, and asking for one needs a CORS grant a Bearer
  API does not give.
- Every host-less `$client` call to the API carries the session's Bearer
  (`LinkProvider.setDefaultAuthorization`), and nothing else does: a
  client naming another hostname never receives it.
- At boot, a stored session is restored and validated through `userinfo`
  before the first page decides anything, inside the router's boot
  deadline. No response keeps the session and ends on the offline screen; a
  refused one clears it.
- Sign-out revokes the session on the server (`deleteMySession`), then
  forgets it locally whether or not the server answered, and says which.

Installed by `AlephaCapacitor` in a native shell.
