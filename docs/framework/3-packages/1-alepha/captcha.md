# Alepha - Captcha

## Installation

Part of the `alepha` package. Import from `alepha/captcha`.

```bash
npm install alepha
```

## Overview

Captcha verification for bot protection.

**Features:**

- Provider abstraction for captcha services
- Cloudflare Turnstile support (free, privacy-friendly)
- In-memory provider for testing

## API Reference

### Providers

- [`CaptchaProvider`](/docs/reference-providers-captchaprovider) - Captcha verification provider interface.
- [`MemoryCaptchaProvider`](/docs/reference-providers-memorycaptchaprovider) - In-memory captcha provider for testing.
- [`TurnstileCaptchaProvider`](/docs/reference-providers-turnstilecaptchaprovider) - Cloudflare Turnstile captcha verification provider.
