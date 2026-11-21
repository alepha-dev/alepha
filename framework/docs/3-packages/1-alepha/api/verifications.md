# Alepha - Api Verifications

## Installation

Part of the `alepha` package. Import from `alepha/api/verifications`.

```bash
npm install alepha
```

## Overview

One-time codes and links that prove a mailbox or a phone number.

`VerificationService` creates an entry and hands the token back to the
caller, which delivers it (an email, an SMS) and later checks what the
recipient submits. The module sends nothing: the module that owns the flow
(registration, password reset, an invitation) sends the message.

**Features:**

- Six digit codes and link tokens, stored hashed
- A cooldown and a daily limit per type, target and purpose
- An attempt budget per entry, taken atomically
- One public route, `POST /verifications/:type/validate`, which answers
  every refusal alike and stops a caller after ten of them
- An hourly purge of entries past their expiry
