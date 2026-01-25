# Alepha - Email

## Installation

Part of the `alepha` package. Import from `alepha/email`.

```bash
npm install alepha
```

## Overview

| type | quality | stability |
|------|---------|-----------|
| backend | rare | stable |

Email delivery with template support.

**Features:**
- Send emails with templates
- Multiple recipients
- SMTP via Nodemailer
- Local file provider for development

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

### Environment Variables

Environment variables used to configure this module. These can be set in your `.env` file or through your deployment configuration.

| Variable | Type | Default | Description |
|----------|------|---------|-------------|
| `EMAIL_FROM` | text | - | Default from email address |
| `EMAIL_HOST` | text | - | SMTP server host |
| `EMAIL_PASS` | text | - | SMTP authentication password |
| `EMAIL_PORT` | number | 587 | SMTP server port |
| `EMAIL_SECURE` | boolean | false | Use secure connection (TLS) |
| `EMAIL_USER` | text | - | SMTP authentication username |
