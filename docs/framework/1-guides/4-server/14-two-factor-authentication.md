# Two-factor authentication

A realm can ask for a second factor after the password. Two are built in, and they share one mechanism, so switching between them is a settings change rather than a rewrite.

| Method      | Where the code comes from                | Enrollment                       | Needs                                                 |
| ----------- | ---------------------------------------- | -------------------------------- | ----------------------------------------------------- |
| `totp`      | An authenticator app on the user's phone | Scan a QR code, confirm one code | Nothing                                               |
| `emailCode` | An email sent at sign-in                 | None                             | `features.notifications` and a verified email address |

TOTP is the stronger of the two and works with no infrastructure at all. Email codes need no enrollment, which is what makes them workable for a public audience you cannot ask to install an app.

::: warning Email codes and password reset
If password reset also goes through email, a compromised mailbox is both the reset channel and the second factor. The second factor then adds nothing against the attacker who matters. Prefer TOTP wherever you can ask users to install an app.
:::

## Turning it on

```typescript
import { $realm } from "alepha/api/users";

class AuthService {
  realm = $realm({
    settings: {
      mfa: {
        totp: "required",
        emailCode: "disabled",
      },
    },
  });
}
```

Each method takes `"disabled"`, `"optional"` or `"required"`:

- `disabled` (the default): never offered.
- `optional`: users may enroll from their account page, and are challenged once they have.
- `required`: the same, plus your UI should push an unenrolled user through enrollment.

::: warning `required` does not block an unenrolled user
An account with nothing enrolled has no second factor to be challenged on, so it signs in on the password alone. This is deliberate: enforcing it at the login route would lock out every existing account the moment you switched the setting on, which is nobody's intended rollout.

Enforce it in your UI instead. `realmConfig.settings.mfa.totp === "required"` tells you the policy, and `GET /users/me/mfa` tells you whether this user has satisfied it. Send them to enrollment when they have not.
:::

## The sign-in flow

`POST /_auth/token` behaves exactly as before for a realm with no second factor. When one is owed, it answers `401` with `error: "MfaRequiredError"` and a structured payload instead of tokens:

```json
{
  "error": "MfaRequiredError",
  "status": 401,
  "data": {
    "challenge": "eyJzdWIiOi...",
    "methods": ["totp"],
    "sentTo": "a**@example.com"
  }
}
```

The `challenge` is a signed, five-minute assertion that the password was verified. It grants nothing on its own. `sentTo` is a masked destination, present only for a factor whose code was sent somewhere.

`POST /_auth/mfa` with `{ challenge, code }` mints the real session and answers with the same body a plain sign-in does, so a client only branches once.

### From React

```typescript
import { isMfaRequired, useAuth } from "alepha/react/auth";

const { login, loginMfa } = useAuth();

try {
  await login("credentials", { username, password });
} catch (error) {
  if (isMfaRequired(error)) {
    // Show a code field, then:
    await loginMfa(error.data.challenge, code);
  } else {
    throw error;
  }
}
```

`@alepha/ui`'s `AuthLogin` already does this: it swaps its form for the code step on a challenge, and offers a resend button when the method is `emailCode`. Applications with a hand-rolled login page use the two calls above.

## Enrollment

`MyMfaController` exposes the self-service endpoints, all scoped to the caller:

| Endpoint                                 | What it does                                                          |
| ---------------------------------------- | --------------------------------------------------------------------- |
| `GET /users/me/mfa`                      | Whether TOTP is on, pending, and how many recovery codes are left     |
| `POST /users/me/mfa/totp/enroll`         | Returns the secret, the `otpauth://` URI, and a QR code as inline SVG |
| `POST /users/me/mfa/totp/activate`       | Confirms a code and returns the recovery codes, once                  |
| `DELETE /users/me/mfa/totp`              | Turns it off, and requires a current code to do so                    |
| `POST /users/me/mfa/totp/recovery-codes` | Issues a fresh set, retiring the old one                              |

The QR is rendered on the server, so an application does not need a QR encoder in its own bundle.

`@alepha/ui`'s account security page has the whole dialog already. Nothing to build if you use it.

### Why disabling asks for a code

A live session is not proof that the person at the keyboard still holds the second factor. Without the check, an unattended signed-in browser is enough to strip the factor off an account and come back later.

## Recovery codes

Activation returns ten single-use codes. They are stored hashed, so that response is the only time they can ever be displayed, and a user who does not keep them has no way back in without an administrator.

An administrator resets a locked-out user by deleting their `totp` identity row through `AdminIdentityController`, which appears in the admin UI as the "Authenticator app" sign-in method.

## What is stored

Everything lives in the existing `identities` row, so **turning this on needs no migration**:

- `provider: "totp"`, `providerUserId: null`
- `providerData`: the secret (encrypted with the application secret), the status, the last accepted time step, and the hashed recovery codes

## Notes on the implementation

- Codes are RFC 6238, SHA-1, six digits, thirty-second steps, with one step of tolerance either side to absorb clock drift.
- A time step is single use. A code seen over someone's shoulder cannot be replayed inside its own validity window.
- The clock comes from `DateTimeProvider`, so tests drive it with `travel()`.
- An emailed code is refused on its second use, even though the underlying verification record would still accept it: idempotency is right for confirming an address and wrong for a login factor.
- Second-factor attempts are rate limited on their own counter, separate from password attempts.
