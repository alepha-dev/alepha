# Alepha - Email

## Installation

Part of the `alepha` package. Import from `alepha/email`.

```bash
npm install alepha
```

## Overview

Provides email sending capabilities for Alepha applications with multiple provider backends.

The email module enables declarative email sending through the `$email` primitive, allowing you to send
emails through different providers: memory (for testing), local file system, or SMTP via Nodemailer.
It supports HTML email content and automatic provider selection based on environment configuration.

## API Reference

### Providers

Providers are classes that encapsulate specific functionality and can be injected into your application. They handle initialization, configuration, and lifecycle management.

For more details, see the [Providers documentation](/docs/concepts-providers).

#### NodemailerEmailProvider

Email provider using Nodemailer for SMTP transport.

Configuration is provided via environment variables:
- EMAIL_HOST: SMTP server host
- EMAIL_PORT: SMTP server port (default: 587)
- EMAIL_USER: SMTP authentication username
- EMAIL_PASS: SMTP authentication password
- EMAIL_FROM: Default from email address
- EMAIL_SECURE: Use secure connection (default: false)

Advanced pooling/rate limiting options can be configured via atom:

```typescript
// Configure via environment variables
// EMAIL_HOST=smtp.example.com
// EMAIL_PORT=587
// EMAIL_USER=user@example.com
// EMAIL_PASS=secret
// EMAIL_FROM=noreply@example.com

// Optionally configure pooling via atom
alepha.state.set(nodemailerEmailOptions.key, {
  pool: true,
  maxConnections: 5,
  rateLimit: 10,
});
```
