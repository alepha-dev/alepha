# Alepha - Email Smtp

## Installation

Part of the `alepha` package. Import from `alepha/email/smtp`.

```bash
npm install alepha
```

## Overview

Plugin for Alepha Email that provides SMTP capabilities via Nodemailer.

## API Reference

### Providers

- [`NodemailerEmailProvider`](/docs/reference-providers-nodemaileremailprovider) — Email provider using Nodemailer for SMTP transport.

### Environment Variables

Environment variables used to configure this module. These can be set in your `.env` file or through your deployment configuration.

| Variable | Type | Default | Description |
|----------|------|---------|-------------|
| `EMAIL_PORT` | number | 587 | SMTP server port |
