# MemoryCaptchaProvider

## Import

```typescript
import { MemoryCaptchaProvider } from "alepha/captcha";
```

## Overview

In-memory captcha provider for testing.

Accepts all tokens by default. Use `reject()` to make verification fail,
and `accept()` to restore. All verification attempts are recorded for assertions.

