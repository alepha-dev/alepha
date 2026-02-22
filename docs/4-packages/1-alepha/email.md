# Alepha - Email

## Installation

Part of the `alepha` package. Import from `alepha/email`.

```bash
npm install alepha
```

## Overview

Email delivery with template support.

**Features:**
- Send emails with templates
- Multiple recipients
- SMTP via Nodemailer
- Local file provider for development

## API Reference

### Providers

- [`NodemailerEmailProvider`](/docs/reference-providers-nodemaileremailprovider) — Email provider using Nodemailer for SMTP transport.
- [`WorkermailerEmailProvider`](/docs/reference-providers-workermaileremailprovider) — Email provider using worker-mailer for Cloudflare Workers.

### Environment Variables

Environment variables used to configure this module. These can be set in your `.env` file or through your deployment configuration.

| Variable | Type | Default | Description |
|----------|------|---------|-------------|
| `EMAIL_AUTH_TYPE` | enum | plain | SMTP authentication type |
| `EMAIL_FROM` | text | - | Default from email address |
| `EMAIL_FROM_NAME` | text | - | Default from name |
| `EMAIL_HOST` | text | - | SMTP server host |
| `EMAIL_PASS` | text | - | SMTP authentication password |
| `EMAIL_PORT` | number | 587 | SMTP server port |
| `EMAIL_SECURE` | boolean | false | Use secure connection (TLS) |
| `EMAIL_USER` | text | - | SMTP authentication username |
