# Alepha - Crypto

## Installation

Part of the `alepha` package. Import from `alepha/crypto`.

```bash
npm install alepha
```

## Overview

Cryptographic utilities: hashing, HMAC, AES-256-GCM encryption, password hashing, and secure random generation.

## API Reference

### Providers

- [`CryptoProviderBase`](/docs/reference-providers-cryptoproviderbase) - One public crypto contract. Cryptographic transformations return promises

### Environment Variables

Environment variables used to configure this module. These can be set in your `.env` file or through your deployment configuration.

| Variable          | Type | Default                 | Description                                                                                                                                                          |
| ----------------- | ---- | ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `APP_SECRET`      | text | change-me-in-production | The secret key used for signing JWTs, encrypting cookies, and other security features.                                                                               |
| `APP_SECRET_FILE` | text | -                       | Path to a file holding APP_SECRET. Read on boot, and generated on first boot when the file does not exist. For self-hosted images, which cannot ship a baked secret. |
