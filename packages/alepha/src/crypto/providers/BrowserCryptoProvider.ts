import { AlephaError } from "alepha";

export class BrowserCryptoProvider {
  protected static readonly AES_ALGORITHM = "AES-GCM";
  protected static readonly AES_IV_LENGTH = 12;
  public hashPassword(): never {
    throw new AlephaError("hashPassword is not supported in the browser");
  }

  public verifyPassword(): never {
    throw new AlephaError("verifyPassword is not supported in the browser");
  }

  public async hash(data: string, algorithm = "SHA-256"): Promise<string> {
    const encoded = new TextEncoder().encode(data);
    const digest = await crypto.subtle.digest(algorithm, encoded);
    return this.toHex(digest);
  }

  public async hmac(
    data: string,
    secret: string,
    algorithm = "SHA-256",
  ): Promise<string> {
    const key = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(secret),
      { name: "HMAC", hash: algorithm },
      false,
      ["sign"],
    );
    const signature = await crypto.subtle.sign(
      "HMAC",
      key,
      new TextEncoder().encode(data),
    );
    return this.toHex(signature);
  }

  public async verifyHmac(
    data: string,
    signature: string,
    secret: string,
    algorithm = "SHA-256",
  ): Promise<boolean> {
    const expected = await this.hmac(data, secret, algorithm);
    return this.equals(expected, signature);
  }

  public async encrypt(plaintext: string, key: string): Promise<string> {
    const iv = crypto.getRandomValues(
      new Uint8Array(BrowserCryptoProvider.AES_IV_LENGTH),
    );
    const cryptoKey = await this.deriveAesKey(key);
    const encoded = new TextEncoder().encode(plaintext);
    const encrypted = await crypto.subtle.encrypt(
      {
        name: BrowserCryptoProvider.AES_ALGORITHM,
        iv: iv.buffer as ArrayBuffer,
      },
      cryptoKey,
      encoded,
    );
    // Web Crypto appends the auth tag to the ciphertext
    const encryptedBytes = new Uint8Array(encrypted);
    const ciphertext = encryptedBytes.slice(0, -16);
    const tag = encryptedBytes.slice(-16);
    return `${this.toHex(iv)}:${this.toHex(tag)}:${this.toHex(ciphertext)}`;
  }

  public async decrypt(ciphertext: string, key: string): Promise<string> {
    const parts = ciphertext.split(":");
    if (parts.length !== 3) {
      throw new AlephaError("Invalid ciphertext format");
    }

    const [ivHex, tagHex, encryptedHex] = parts;
    const iv = this.fromHex(ivHex!);
    const tag = this.fromHex(tagHex!);
    const encrypted = this.fromHex(encryptedHex!);
    // Web Crypto expects tag appended to ciphertext
    const combined = new Uint8Array(encrypted.length + tag.length);
    combined.set(encrypted);
    combined.set(tag, encrypted.length);
    const cryptoKey = await this.deriveAesKey(key);
    const decrypted = await crypto.subtle.decrypt(
      {
        name: BrowserCryptoProvider.AES_ALGORITHM,
        iv: iv.buffer as ArrayBuffer,
      },
      cryptoKey,
      combined.buffer as ArrayBuffer,
    );
    return new TextDecoder().decode(decrypted);
  }

  public equals(a: string, b: string): boolean {
    if (a.length !== b.length) {
      return false;
    }
    let result = 0;
    for (let i = 0; i < a.length; i++) {
      result |= a.charCodeAt(i) ^ b.charCodeAt(i);
    }
    return result === 0;
  }

  public randomUUID(): string {
    return crypto.randomUUID();
  }

  public randomText(length: number): string {
    const bytes = crypto.getRandomValues(new Uint8Array(length));
    return this.toBase64Url(bytes.buffer as ArrayBuffer).slice(0, length);
  }

  public randomCode(length: number): string {
    // Generated digit by digit: computing `10 ** length` first overflows the
    // Uint32 range at length >= 10, which floored the rejection-sampling
    // limit to 0 and made the loop unterminable (a hung tab). Drawing each
    // digit independently is uniform, allocation-cheap, and has no length
    // ceiling — matching the Node provider, which handles long codes fine.
    //
    // 250 = 25 × 10, so bytes 0–249 map onto 0–9 with no modulo bias;
    // 250–255 are rejected and redrawn.
    const digits: string[] = [];
    const buffer = new Uint8Array(length);
    while (digits.length < length) {
      crypto.getRandomValues(buffer);
      for (const byte of buffer) {
        if (byte < 250) {
          digits.push(String(byte % 10));
          if (digits.length === length) break;
        }
      }
    }
    return digits.join("");
  }

  protected toHex(buffer: ArrayBuffer | Uint8Array): string {
    const bytes =
      buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
    return Array.from(bytes)
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  }

  protected fromHex(hex: string): Uint8Array {
    const bytes = new Uint8Array(hex.length / 2);
    for (let i = 0; i < hex.length; i += 2) {
      bytes[i / 2] = Number.parseInt(hex.substring(i, i + 2), 16);
    }
    return bytes;
  }

  protected toBase64Url(buffer: ArrayBuffer): string {
    const bytes = new Uint8Array(buffer);
    let binary = "";
    for (const byte of bytes) {
      binary += String.fromCharCode(byte);
    }
    return btoa(binary)
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
  }

  protected async deriveAesKey(key: string): Promise<CryptoKey> {
    const encoded = new TextEncoder().encode(key);
    const hash = await crypto.subtle.digest("SHA-256", encoded);
    return crypto.subtle.importKey(
      "raw",
      hash,
      { name: BrowserCryptoProvider.AES_ALGORITHM },
      false,
      ["encrypt", "decrypt"],
    );
  }

  /**
   * Derive an AES-GCM key from a low-entropy user passphrase using
   * PBKDF2-SHA-256. Use this in place of {@link deriveAesKey} whenever the
   * key material is a human-chosen string — a single SHA-256 over a
   * passphrase is brute-forceable by anyone with the ciphertext.
   *
   * OWASP 2023 recommends 600k iterations of PBKDF2-SHA-256 for password
   * storage; we use the same budget for client-side at-rest content keys.
   * Each protected blob carries its own random salt so the same passphrase
   * derives a different key per blob.
   */
  public async deriveKeyFromPassphrase(
    passphrase: string,
    saltHex: string,
    iterations = 600_000,
  ): Promise<CryptoKey> {
    const baseKey = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(passphrase),
      { name: "PBKDF2" },
      false,
      ["deriveKey"],
    );
    return crypto.subtle.deriveKey(
      {
        name: "PBKDF2",
        salt: this.fromHex(saltHex).buffer as ArrayBuffer,
        iterations,
        hash: "SHA-256",
      },
      baseKey,
      { name: BrowserCryptoProvider.AES_ALGORITHM, length: 256 },
      false,
      ["encrypt", "decrypt"],
    );
  }

  /**
   * Encrypt `plaintext` with a pre-derived passphrase key, returning a
   * self-contained envelope (versioned for forward compatibility):
   *
   *     { v: 1, salt, iv, ciphertext, kdf }
   *
   * `salt` + `kdf` are echoed back so {@link decryptWithPassphrase} can
   * reproduce the exact derivation. Each call generates a fresh IV — pass
   * a stable salt across saves of the same protected blob so the
   * passphrase only has to be derived once per session.
   */
  public async encryptWithPassphrase(
    plaintext: string,
    key: CryptoKey,
    saltHex: string,
    iterations = 600_000,
  ): Promise<string> {
    const iv = crypto.getRandomValues(
      new Uint8Array(BrowserCryptoProvider.AES_IV_LENGTH),
    );
    const encrypted = await crypto.subtle.encrypt(
      {
        name: BrowserCryptoProvider.AES_ALGORITHM,
        iv: iv.buffer as ArrayBuffer,
      },
      key,
      new TextEncoder().encode(plaintext),
    );
    return JSON.stringify({
      v: 1,
      salt: saltHex,
      iv: this.toHex(iv),
      ciphertext: this.toHex(new Uint8Array(encrypted)),
      kdf: { name: "PBKDF2", iterations, hash: "SHA-256" },
    });
  }

  /**
   * Reverse of {@link encryptWithPassphrase}. Throws when the passphrase
   * is wrong or the envelope is corrupt — both surface as the same
   * `OperationError` from Web Crypto, which the UI presents as a generic
   * "wrong passphrase" without revealing which.
   */
  public async decryptWithPassphrase(
    envelope: string,
    passphrase: string,
  ): Promise<string> {
    let parsed: {
      v?: number;
      salt?: string;
      iv?: string;
      ciphertext?: string;
      kdf?: { iterations?: number };
    };
    try {
      parsed = JSON.parse(envelope);
    } catch {
      throw new AlephaError("Invalid protected folio envelope");
    }
    if (!parsed.salt || !parsed.iv || !parsed.ciphertext) {
      throw new AlephaError("Invalid protected folio envelope");
    }
    const key = await this.deriveKeyFromPassphrase(
      passphrase,
      parsed.salt,
      parsed.kdf?.iterations ?? 600_000,
    );
    const decrypted = await crypto.subtle.decrypt(
      {
        name: BrowserCryptoProvider.AES_ALGORITHM,
        iv: this.fromHex(parsed.iv).buffer as ArrayBuffer,
      },
      key,
      this.fromHex(parsed.ciphertext).buffer as ArrayBuffer,
    );
    return new TextDecoder().decode(decrypted);
  }
}
