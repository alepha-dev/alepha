# Crypto and Secrets

`alepha/crypto` holds the cryptographic helpers every other module uses:
password hashing, hashes and HMAC, AES-256-GCM encryption, and secure random
values. It also owns `APP_SECRET`, the key that signs tokens and cookies.

## CryptoProvider

Inject `CryptoProvider` instead of calling `node:crypto` or `Math.random()`
directly, so a test can substitute it.

```typescript check
import { $inject } from "alepha";
import { CryptoProvider } from "alepha/crypto";

class AccountService {
  crypto = $inject(CryptoProvider);

  async register(password: string) {
    const hash = await this.crypto.hashPassword(password); // "salt:key", scrypt
    const ok = await this.crypto.verifyPassword(password, hash); // true

    const code = this.crypto.randomCode(6); // "042917", digits only
    const token = this.crypto.randomText(32); // base64url, 32 chars

    return { hash, ok, code, token };
  }
}
```

| Method                                       | Notes                                                                       |
| -------------------------------------------- | --------------------------------------------------------------------------- |
| `hashPassword(password)`                     | scrypt with a random 16-byte salt, stored as `salt:key` in hex              |
| `verifyPassword(password, stored)`           | constant-time; returns `false` on a malformed hash instead of throwing      |
| `hash(data, algorithm = "sha256")`           | hex digest                                                                  |
| `hmac(data, secret, algorithm = "sha256")`   | hex digest; `verifyHmac(data, signature, secret)` compares in constant time |
| `encrypt(plaintext, key)` / `decrypt(...)`   | AES-256-GCM, output `iv:tag:ciphertext` in hex, key hashed to 32 bytes      |
| `equals(a, b)`                               | constant-time string comparison                                             |
| `randomUUID()` / `randomUUIDv7(timestampMs)` | v7 takes the timestamp, see below                                           |
| `randomText(length)`                         | base64url, cut to `length`                                                  |
| `randomCode(length)`                         | zero-padded digits, for one-time codes                                      |
| `randomInt(maxExclusive)`                    | uniform integer in `[0, maxExclusive)`, the stand-in for `Math.random()`    |

`randomUUIDv7` takes the timestamp rather than reading a clock, so pass
`DateTimeProvider.nowMillis()` and generated ids follow `travel()` in tests.
Ids generated in the same millisecond still sort in generation order.

```typescript check
import { $inject } from "alepha";
import { CryptoProvider } from "alepha/crypto";
import { DateTimeProvider } from "alepha/datetime";

class IdService {
  crypto = $inject(CryptoProvider);
  dateTime = $inject(DateTimeProvider);

  next() {
    return this.crypto.randomUUIDv7(this.dateTime.nowMillis());
  }
}
```

### In the browser

The browser build of `alepha/crypto` exports a Web Crypto implementation under
the same `CryptoProvider` name. Two differences: `hash`, `hmac`, `verifyHmac`,
`encrypt` and `decrypt` return promises, and `hashPassword` /
`verifyPassword` throw, since password hashing is server-only. Code shared by
both sides should `await` those calls.

Both providers also expose `deriveKeyFromPassphrase`, `encryptWithPassphrase`
and `decryptWithPassphrase` (PBKDF2 over Web Crypto), meant for client-side
encryption with a user's passphrase.

## APP_SECRET

`SecretProvider` reads the application secret used to sign JWTs, encrypt
cookies, and sign links such as unsubscribe URLs. It is created only when
something injects it, so an app that signs nothing never needs one.

| Variable          | Meaning                                                                                         |
| ----------------- | ----------------------------------------------------------------------------------------------- |
| `APP_SECRET`      | the secret itself; an empty value counts as unset                                               |
| `APP_SECRET_FILE` | a file holding it, read on boot and **generated on first boot** (mode `0600`) when it is absent |

- **Production refuses the default.** Unset, the secret falls back to a public
  constant: outside production that logs a warning, in production the app
  refuses to boot, since anyone could forge tokens.
- **`APP_SECRET` wins over the file.** The file is read only when no explicit
  secret is set.
- **No file on serverless.** `APP_SECRET_FILE` on Cloudflare Workers throws:
  there is no writable file system, so set `APP_SECRET` as a secret.
- **Rotating it invalidates** every session token, signed cookie and signed
  link issued with the old value.

`APP_SECRET_FILE` is what lets a self-hosted image start with a plain
`docker run`: point it at a mounted volume and each install mints its own
secret.
