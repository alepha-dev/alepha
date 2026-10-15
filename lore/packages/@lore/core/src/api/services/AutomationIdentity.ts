/**
 * Stable identities contain no secrets or serialized source data.
 */
export class AutomationIdentity {
  public async hash(value: unknown): Promise<string> {
    const bytes = await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(JSON.stringify(this.canonical(value))),
    );
    return [...new Uint8Array(bytes)]
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("");
  }
  protected canonical(value: unknown): unknown {
    if (Array.isArray(value)) return value.map((item) => this.canonical(item));
    if (value && typeof value === "object") {
      const result: Record<string, unknown> = Object.create(null);
      for (const key of Object.keys(value).sort())
        result[key] = this.canonical((value as Record<string, unknown>)[key]);
      return result;
    }
    return value;
  }
}
