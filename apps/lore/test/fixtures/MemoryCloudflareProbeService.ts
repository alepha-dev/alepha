import {
  CloudflareProbeService,
  type CloudflareProbeResponse,
} from "../../src/api/services/CloudflareProbeService.ts";

/**
 * Cloudflare, scripted.
 *
 * Substituted for the real probe through `Alepha.with({ provide, use })`,
 * never `vi.mock`: the seam is a class, so a spec drives the seven answers
 * the same way production does, and nothing here reaches the network.
 *
 * Everything passes by default, because most cases are about one probe
 * failing among six that do not.
 */
export class MemoryCloudflareProbeService extends CloudflareProbeService {
  /**
   * Answers by path suffix, first match wins. A suffix rather than a whole
   * path so a case can say `/d1/database` without repeating the account id.
   */
  public readonly answers = new Map<string, CloudflareProbeResponse>();

  /**
   * What an unscripted path answers. A pass with no `result`, which the
   * identity probe reads as an active token with no expiry.
   */
  public fallback: CloudflareProbeResponse = {
    ok: true,
    status: 200,
    errors: [],
  };

  /**
   * Every path asked for, in order. The probe table's spec reads this: the
   * contract is which endpoints are called, not only what they answered.
   */
  public readonly calls: string[] = [];

  override async get(
    path: string,
    token: string,
  ): Promise<CloudflareProbeResponse> {
    void token;
    this.calls.push(path);
    for (const [suffix, answer] of this.answers) {
      if (path.endsWith(suffix)) {
        return answer;
      }
    }
    return this.fallback;
  }

  /**
   * Cloudflare refusing one endpoint the way it refuses every missing
   * permission: `403` with error `10000`, the same code for all of them.
   */
  refuse(suffix: string, status = 403): this {
    this.answers.set(suffix, { ok: false, status, errors: [10_000] });
    return this;
  }

  /**
   * A `5xx`, a `429` or a network error, which is Lore failing to ask rather
   * than Cloudflare answering.
   */
  unreachable(suffix: string, status = 0): this {
    this.answers.set(suffix, { ok: false, status, errors: [] });
    return this;
  }

  /**
   * What the verify endpoint says about the token itself.
   */
  identity(result: Record<string, unknown>): this {
    this.answers.set("/tokens/verify", {
      ok: true,
      status: 200,
      errors: [],
      result,
    });
    return this;
  }

  reset(): this {
    this.answers.clear();
    this.calls.length = 0;
    this.fallback = { ok: true, status: 200, errors: [] };
    return this;
  }
}
