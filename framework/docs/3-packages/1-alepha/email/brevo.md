# Alepha - Email Brevo

## Installation

Part of the `alepha` package. Import from `alepha/email/brevo`.

```bash
npm install alepha
```

## Overview

Plugin for Alepha Email that provides Brevo transactional email capabilities.

## API Reference

### Providers

- [`BrevoEmailProvider`](/docs/reference-providers-brevoemailprovider) - Email provider using Brevo (formerly Sendinblue) transactional email API.

### Environment Variables

Environment variables used to configure this module. These can be set in your `.env` file or through your deployment configuration.

| Variable        | Type | Default      | Description                           |
| --------------- | ---- | ------------ | ------------------------------------- |
| `BREVO_API_KEY` | text | **Required** | Brevo API key for transactional email |
| `EMAIL_FROM`    | text | **Required** | Default sender email address          |
