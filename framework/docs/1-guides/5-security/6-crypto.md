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
    const hash = await this.crypto.hashPassword(password); // "$scrypt$ln=14,r=8,p=1$...", scrypt
    const ok = await this.crypto.verifyPassword(password, hash); // true

    const code = this.crypto.randomCode(6); // "042917", digits only
    const token = this.crypto.randomText(32); // base64url, 32 chars

    return { hash, ok, code, token };
  }
}
```

| Method                                       | Notes                                                                                            |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `hashPassword(password)`                     | scrypt (16-byte salt, 64-byte key), stored as a PHC string `$scrypt$ln=14,r=8,p=1$<salt>$<hash>` |
| `verifyPassword(password, stored)`           | constant-time; reads legacy `salt:hex` hashes too; `false` on a malformed hash, never a throw    |
| `needsRehash(stored)`                        | `true` for a legacy hash or one below the current scrypt parameters (synchronous)                |
| `hash(data, algorithm = "sha256")`           | hex digest; `"sha256"`, `"sha384"` or `"sha512"`, anything else is refused                       |
| `hmac(data, secret, algorithm = "sha256")`   | hex digest; `verifyHmac(data, signature, secret)` compares in constant time                      |
| `encrypt(plaintext, key)` / `decrypt(...)`   | AES-256-GCM, output `v1:iv:tag:ciphertext` in hex, key hashed to 32 bytes with SHA-256           |
| `equals(a, b)`                               | constant-time string comparison                                                                  |
| `randomUUID()` / `randomUUIDv7(timestampMs)` | v7 takes the timestamp, see below                                                                |
| `randomText(length)`                         | base64url, cut to `length`                                                                       |
| `randomCode(length)`                         | zero-padded digits, for one-time codes                                                           |
| `randomInt(maxExclusive)`                    | uniform integer in `[0, maxExclusive)`, the stand-in for `Math.random()`; throws on a bound < 1  |

Every transformation (`hashPassword`, `verifyPassword`, `hash`, `hmac`,
`verifyHmac`, `encrypt`, `decrypt`) returns a promise, on Node as in the
browser, so the same code runs on both. Random values and `equals` are
synchronous.

```typescript check
import { $inject } from "alepha";
import { CryptoProvider } from "alepha/crypto";

class PayloadSigner {
  protected readonly crypto = $inject(CryptoProvider);

  public async inspect(payload: string, secret: string) {
    const digest = await this.crypto.hash(payload, "sha256");
    const signature = await this.crypto.hmac(payload, secret);
    const valid = await this.crypto.verifyHmac(payload, signature, secret);
    return { digest, signature, valid };
  }
}
```

The scrypt parameters live in the hash, so raising them later does not break
stored passwords. After a successful `verifyPassword`, `needsRehash(stored)`
says whether to store a fresh hash; the built-in password login does it on its
own. `decrypt` also reads the older `iv:tag:ciphertext` form, without the `v1`
prefix.

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
the same `CryptoProvider` name and the same contract. The one difference:
`hashPassword` and `verifyPassword` reject, since password hashing is
server-only.

Both providers also expose `deriveKeyFromPassphrase`, `encryptWithPassphrase`
and `decryptWithPassphrase` (PBKDF2-SHA-256, 600,000 iterations by default),
meant for client-side encryption with a user's passphrase. The envelope records
its version (`v: 1`, the only one decryption accepts) and its iteration count,
so either side decrypts what the other wrote.

## APP_SECRET

`SecretProvider` reads the application secret used to sign JWTs, encrypt
cookies, and sign links such as unsubscribe URLs. It is created only when
something injects it, so an app that signs nothing never needs one.

| Variable          | Meaning                                                                                                  |
| ----------------- | -------------------------------------------------------------------------------------------------------- |
| `APP_SECRET`      | the secret itself; an empty value counts as unset                                                        |
| `APP_SECRET_FILE` | a file holding it, read on boot and **generated on first boot** (mode `0600`) when it is absent or empty |

- **Production refuses the default.** Unset, the secret falls back to a public
  constant: outside production that logs a warning, in production the app
  refuses to boot, since anyone could forge tokens.
- **`APP_SECRET` wins over the file.** The file is read only when no explicit
  secret is set.
- **No file on serverless.** With no `APP_SECRET` set, `APP_SECRET_FILE` on a
  serverless runtime (Cloudflare, Vercel, or `ALEPHA_SERVERLESS` set) throws:
  there is no writable file system, so set `APP_SECRET` as a secret.
- **The generated secret** is 64 random base64url characters. An empty file is
  regenerated with a warning; a directory that is missing or not writable
  stops the boot with an error saying so.
- **Rotating it invalidates** every session token, signed cookie and signed
  link issued with the old value.

`APP_SECRET_FILE` is what lets a self-hosted image start with a plain
`docker run`: point it at a mounted volume and each install mints its own
secret.
