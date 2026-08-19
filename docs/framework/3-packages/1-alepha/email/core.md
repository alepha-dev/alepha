# Alepha - Email

## Installation

Part of the `alepha` package. Import from `alepha/email`.

```bash
npm install alepha
```

## Overview

Email delivery over pluggable providers.

**Features:**
- `$email` declares a named send channel; the name is surfaced to the
  `email:sending` / `email:sent` hooks (as their `template` field) for
  auditing and interception
- Multiple recipients
- Local file provider for development
- Memory provider for testing

There is **no template rendering**: `send()` takes an already-rendered
`subject` and `body` - bring your own templating if you need it.

For SMTP support, use `AlephaEmailSmtp` from `alepha/email/smtp`.
For Brevo support, use `AlephaEmailBrevo` from `alepha/email/brevo`.

## API Reference

### Primitives

- [`$email`](/docs/reference-primitives-$email) - Declares an email channel for sending mail through the configured provider.

### Providers

- [`EmailProvider`](/docs/reference-providers-emailprovider) - Email provider interface.
