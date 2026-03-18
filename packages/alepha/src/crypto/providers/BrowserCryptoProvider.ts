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
    const max = 10 ** length;
    const array = new Uint32Array(1);
    // Rejection sampling to avoid modulo bias
    const limit = Math.floor(0x100000000 / max) * max;
    let value: number;
    do {
      crypto.getRandomValues(array);
      value = array[0]!;
    } while (value >= limit);
    const code = value % max;
    return String(code).padStart(length, "0");
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
}
