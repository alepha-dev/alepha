# Alepha - Email Cloudflare

## Installation

Part of the `alepha` package. Import from `alepha/email/cloudflare`.

```bash
npm install alepha
```

## Overview

Plugin for Alepha Email that sends through Cloudflare's Email Sending API
via a Workers binding.

## API Reference

### Providers

- [`CloudflareEmailProvider`](/docs/reference-providers-cloudflareemailprovider) — Email provider using Cloudflare's Email Sending API.

### Environment Variables

Environment variables used to configure this module. These can be set in your `.env` file or through your deployment configuration.

| Variable | Type | Default | Description |
|----------|------|---------|-------------|
| `CLOUDFLARE_ACCOUNT_ID` | text | - | Cloudflare account id. Only needed off Workers, where the REST API stands in for the `SEND_EMAIL` binding. |
| `CLOUDFLARE_API_TOKEN` | text | - | Cloudflare API token with the Email Sending scope. Only needed off Workers, alongside `CLOUDFLARE_ACCOUNT_ID`. |
| `EMAIL_FROM` | text | - | Default sender (a verified sender address). Accepts a bare address or an RFC 5322 display-name form, e.g. `Lore <noreply@lore.alepha.dev>`. |
