# @alepha/capacitor - Ota Api

## Installation

```bash
npm install @alepha/capacitor
```

## Overview

The server side of live updates for a native shell's web layer, mounted
into the app's own Alepha backend: no hosted service, no Capgo account.

- `POST /ota/updates`, `/ota/stats`, `/ota/channel` and the signed
  `GET /ota/bundles/:id/download?token=`: the endpoints the pinned updater
  (`@capgo/capacitor-updater` 8.52.1) calls, unauthenticated, bounded and
  throttled; see `OtaUpdateService` for how a bundle is chosen;
- `POST /ota/bundles`: where `alepha capacitor release` publishes, with an
  API key holding `ota:release` and listed on the app;
- `/api/ota/*`: the typed admin actions `@alepha/capacitor/ota-admin`
  renders, under `ota:read`, `ota:manage` and `ota:release`;
- a nightly retention job.

Bundles are exact: one may run only on the native build numbers its
release lists, all of one native fingerprint, so a newer binary with other
plugins never receives a web layer it cannot run. Encryption is Capgo v2;
the server holds the app's public key, verifies and inspects every upload
with it, and never holds the publisher's private key.

Needs a database (`alepha/orm`), file storage (`alepha/api/files`),
`OTA_DOWNLOAD_SECRET` in production, and API keys (`alepha/api/keys`, a
realm's `features.apiKeys`) for the publisher.

## API Reference

### Environment Variables

Environment variables used to configure this module. These can be set in your `.env` file or through your deployment configuration.

| Variable              | Type | Default | Description                                                                                                                    |
| --------------------- | ---- | ------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `OTA_DOWNLOAD_SECRET` | text | -       | Server-only secret signing the short-lived OTA download links. Required in production. Never the signing key of the publisher. |
