# Passkeys

A passkey is a WebAuthn credential: a key pair made by the user's device (Touch ID, Windows Hello, a phone, a security key), whose private half never leaves it. A realm that offers passkeys lets a user add one from the account page, sign in with it and nothing else, and clear the second-factor step with it.

## Turning it on

```typescript check
import { $realm } from "alepha/api/users";

class AuthService {
  realm = $realm({
    settings: {
      passkeys: "optional",
    },
  });
}
```

`passkeys` is `"disabled"` (the default, so an upgrade changes nothing) or `"optional"`. A project made with `alepha init --preset saas` starts with `"optional"`.

Nothing else is needed: the account page, the login page and the second-factor step of `@alepha/ui` pick it up from the realm config.

### The relying party is the hostname

A passkey is bound to a relying party id, which is a hostname. By default it is the request's hostname, and the browser's origin is checked by host, whatever the scheme: behind a proxy that ends TLS without forwarding the scheme, the server sees `http` and cannot know its own origin.

⚠️ **Changing the app's hostname orphans every passkey enrolled on the old one.** They stay listed on the account page, marked as not usable here, and sign in nowhere.

An app served on several subdomains sets the id once, to the domain they share, and lists its origins:

```typescript check
import { $realm } from "alepha/api/users";

class AuthService {
  realm = $realm({
    settings: {
      passkeys: "optional",
      passkeyRelyingParty: {
        id: "example.com",
        name: "Example",
        origins: ["https://app.example.com", "https://id.example.com"],
      },
    },
  });
}
```

An explicit `origins` list is compared whole, scheme included. `name` is what the device shows beside the passkey; it defaults to the realm's `displayName`.

## What the user sees

- **The account page** gains a Passkeys card: each passkey with its name, when it was added and last used, and a "Synced" badge when it is copied to the user's other devices. The user adds one (and names it), renames one, or removes one.
- **The login page** gains a "Sign in with a passkey" button under the form, and the browser offers the user's passkeys in the autofill of the identifier field. No username is typed and no password.
- **The second-factor step** offers "Use a passkey" beside the code field, when the user holds one.

All three are hidden when the realm does not offer passkeys or the browser cannot use them. A passkey added before the realm turned them off stays listed, so the user can still remove it.

## Adding or removing a passkey asks for proof

A signed-in session alone does not add or remove a passkey. The account page asks for:

1. the current password, when the account has one;
2. else a confirmation with a passkey the account already holds;
3. else nothing more than being signed in (an account that only signs in through a provider such as Google).

The reason: a passkey added from a borrowed session would be a way in that outlives a password change. `GET /api/users/me/passkeys` says which proof the account owes, so the page never guesses.

Removing the last way to sign in is refused, and a usable passkey counts as one: a user may remove their password and keep signing in with a passkey.

## Passkeys and the second factor

A passkey sign-in with user verification (a fingerprint, a face, a device PIN) is possession plus a biometric or a PIN, so it satisfies the realm's second-factor requirement by itself. After a password, a passkey is one more way to clear a step that TOTP or an email code raised. A passkey beside a password raises no step by itself and is not an enrolment: in a realm where a factor is `required`, an app that enforces it in its UI keeps sending such a user to TOTP enrolment, since `GET /api/users/me/mfa` reports TOTP alone.

## Recovery, as it is

A user who has a password and loses their passkey signs in with the password and adds a new one. A user with no password has no self-service recovery: password reset does nothing for an account with no password. What is left is another passkey, a synced one restored on a new device, or an administrator, who revokes the lost passkey from the user's Security tab and sets a password.

Revoking a passkey, one or all of them, does not sign the user out: revoke their sessions for that.

## What is stored and what is checked

A passkey is a row of the `identities` table: the credential id, and in its JSON data the public key, a sign counter, the transports, the relying party id, the name and the dates. Nothing secret is stored, so no migration was needed and a database dump yields nothing to sign in with.

At sign-in, the server checks the origin, the relying party id, the user-presence flag, the signature over its own single-use challenge, and the counter: a counter that does not increase, when the authenticator counts at all, is refused and audited as a possible cloned authenticator. Challenges live in a signed, encrypted, five-minute cookie, so nothing is kept server side and it works on Workers with no KV. Every refusal looks the same from outside: nothing can be learned about which accounts exist. Sign-in attempts share the IP budget of the password login.

Verification uses WebCrypto alone (ES256, RS256 and EdDSA) and runs on Node, Bun and workerd.

## Limits

- Attestation is not verified: the realm asks for `attestation: "none"` and trusts no manufacturer chain.
- Passkey-only realms are not offered: `passkeys` has no `"required"`.
- Native apps are not covered yet.

## Testing your own flows

`alepha/testing/webauthn` ships a software authenticator. It answers the options your server issues with real registration and assertion responses, so a spec runs the true verification path with no mock:

```typescript check
import { Alepha } from "alepha";
import type { RegistrationOptionsJson } from "alepha/security";
import {
  AlephaTestingWebAuthn,
  MemoryAuthenticator,
} from "alepha/testing/webauthn";

const alepha = Alepha.create().with(AlephaTestingWebAuthn);
const device = alepha.inject(MemoryAuthenticator);
device.origin = "http://localhost:3000";

const options: RegistrationOptionsJson = {
  rp: { id: "localhost", name: "Example" },
  user: { id: "dXNlcg", name: "ada@example.com", displayName: "Ada" },
  challenge: "Y2hhbGxlbmdl",
  pubKeyCredParams: [{ type: "public-key", alg: -7 }],
};

// What `navigator.credentials.create()` would answer.
const credential = await device.create(options);

// A cloned authenticator replaying an old counter, for a refusal spec.
const replay = await device.get(
  { challenge: "c2Vjb25k", rpId: "localhost" },
  { counter: 0 },
);
```

Knobs cover the cases a server must refuse: `origin`, `userVerified`, `counter`, `algorithm`, `crossOrigin` and `tamper`. For a React page, substitute `MemoryPasskeyClient` for `PasskeyClient` of `alepha/react/auth`: the browser side of every ceremony then runs on that authenticator.
