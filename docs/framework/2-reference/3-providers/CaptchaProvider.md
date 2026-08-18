# CaptchaProvider

## Import

```typescript
import { CaptchaProvider } from "alepha/captcha";
```

## Overview

Captcha verification provider interface.

Verifies that a user-submitted captcha token is valid. Implementations
call the relevant captcha service (Turnstile, reCAPTCHA, hCaptcha, etc.)
to validate the token server-side.

