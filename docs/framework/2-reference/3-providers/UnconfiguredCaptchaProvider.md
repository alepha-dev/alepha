# UnconfiguredCaptchaProvider

## Import

```typescript
import { UnconfiguredCaptchaProvider } from "alepha/captcha";
```

## Overview

The captcha provider an app gets when it registered none.

Refuses every token. That is the whole point: the default used to be
`MemoryCaptchaProvider`, which accepts every token, in every
environment — so a realm with `captchaRequired: true` and no provider bound
had captcha "on" and no captcha at all, and nothing said so. A protection
that is absent must refuse, not wave through.

The refusal is loud rather than silent: `verify()` logs an error naming what
to bind. Boot-time refusal is separate and lives with the code that knows a
realm asked for captcha (`RealmProvider`), because a container that merely
registered `alepha/captcha` without ever requiring a captcha is not
misconfigured and must still start.
