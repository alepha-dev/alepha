# WebAuthnVerifier

## Import

```typescript
import { WebAuthnVerifier } from "alepha/security";
```

## Overview

Verifies WebAuthn registrations and assertions with `crypto.subtle` and
nothing else, so the same code runs on Node, Bun and workerd.

It never reads a request: the caller passes the challenge it issued, the
RP id and the origin rule. Attestation is not trusted. Format `none` is
accepted, a `packed` self attestation has its signature checked, and any
other statement (a `packed` one with a certificate chain, `tpm`,
`android-key`, `apple`, `fido-u2f`) is accepted with the statement
ignored: nothing here checks a manufacturer chain, so refusing one would
lock an authenticator out for no protection.

Every refusal is a `WebAuthnError` whose `reason` names the check.
