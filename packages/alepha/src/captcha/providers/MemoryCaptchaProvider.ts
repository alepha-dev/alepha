import { $logger } from "alepha/logger";
import type { CaptchaProvider } from "./CaptchaProvider.ts";

export interface CaptchaRecord {
  token: string;
  ip?: string;
  verifiedAt: Date;
}

/**
 * In-memory captcha provider for testing.
 *
 * Accepts all tokens by default. Use `reject()` to make verification fail,
 * and `accept()` to restore. All verification attempts are recorded for assertions.
 */
export class MemoryCaptchaProvider implements CaptchaProvider {
  protected readonly log = $logger();

  /**
   * All verification attempts.
   */
  public records: CaptchaRecord[] = [];

  protected shouldAccept = true;

  public getSiteKey(): string | undefined {
    return undefined;
  }

  public async verify(token: string, ip?: string): Promise<boolean> {
    this.log.debug("Verifying captcha in memory store", { token, ip });

    this.records.push({
      token,
      ip,
      verifiedAt: new Date(),
    });

    return this.shouldAccept;
  }

  /**
   * Make all subsequent verifications fail.
   */
  public reject(): void {
    this.shouldAccept = false;
  }

  /**
   * Make all subsequent verifications pass (default behavior).
   */
  public accept(): void {
    this.shouldAccept = true;
  }

  /**
   * Whether a token was verified.
   */
  public wasVerified(token: string): boolean {
    return this.records.some((r) => r.token === token);
  }

  /**
   * Get the last verification attempt.
   */
  public get last(): CaptchaRecord | undefined {
    return this.records[this.records.length - 1];
  }
}
