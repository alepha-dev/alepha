# Alepha - Testing Webauthn

## Installation

Part of the `alepha` package. Import from `alepha/testing/webauthn`.

```bash
npm install alepha
```

## Overview

A software WebAuthn authenticator, for testing passkey flows with no
browser and no device.

**Features:**

- Real registration and assertion responses on `crypto.subtle`: key
  pairs, COSE keys, authenticator data, signatures
- ES256, RS256 and EdDSA credentials, several per authenticator
- Knobs for a misbehaving device: origin, user verification, counter,
  cross-origin, and tampering with one field
- Runs on Node, Bun, workerd and jsdom
