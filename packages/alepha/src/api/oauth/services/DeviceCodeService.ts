import { randomBytes, randomInt, timingSafeEqual } from "node:crypto";

import { $inject, AlephaError } from "alepha";
import { $cache } from "alepha/cache";
import { DateTimeProvider } from "alepha/datetime";

/**
 * How long a device authorization stays usable, in seconds.
 *
 * RFC 8628 suggests a "reasonably short" lifetime. Ten minutes is long enough
 * for someone to move to another device and read their email, short enough that
 * a leaked user code is worthless by the time it is found.
 */
export const DEVICE_CODE_TTL_SECONDS = 600;

/**
 * Seconds a client must wait between polls.
 */
export const DEVICE_POLL_INTERVAL_SECONDS = 5;

/**
 * Alphabet for the code a human retypes.
 *
 * No vowels, so no code can spell something unfortunate. No `0/O`, `1/I/L`,
 * `5/S`, `2/Z`, `8/B` — every pair someone would mistype reading a code off one
 * screen and into another, which is the entire situation this grant exists for.
 */
const USER_CODE_ALPHABET = "CDFGHJKMNPQRTVWXY34679";

/**
 * A device authorization in flight.
 */
export interface DeviceAuthorization {
  deviceCode: string;
  userCode: string;
  clientId: string;
  scopes: string[];
  resource?: string;
  status: "pending" | "approved" | "denied";
  /** Set once a human approves. */
  userId?: string;
  createdAt: number;
  /** Last poll, used to enforce the interval. */
  lastPolledAt?: number;
  /** Wrong user codes tried against this record's slot. */
  attempts: number;
}

/**
 * The result of one poll, shaped so the caller cannot forget a case.
 */
export type DevicePollResult =
  | { status: "pending" }
  | { status: "slow_down" }
  | { status: "denied" }
  | { status: "expired" }
  | { status: "approved"; userId: string; scopes: string[]; resource?: string };

/**
 * OAuth 2.0 Device Authorization Grant (RFC 8628).
 *
 * The grant for anything that cannot host a browser redirect: a CLI, CI, a TV.
 * The device shows a short code, the human approves it somewhere with a
 * keyboard and a session, and the device polls until it does.
 *
 * **Stateful on purpose, unlike authorization codes.** Those are signed JWTs
 * carrying their own grant, which works because they are minted only after the
 * user has already approved. A device code is handed out BEFORE approval and
 * must later change state, so something has to remember it.
 *
 * That state lives in the cache: these records are short-lived by definition,
 * and losing them costs one re-run of `login`, which the user is standing right
 * there to do.
 *
 * ⚠ With the default in-memory cache this only holds for a single process. Run
 * more than one instance behind a load balancer and a poll can land on a node
 * that never saw the authorization — configure a shared cache provider
 * (`DatabaseCacheProvider`, Redis) before scaling out.
 */
export class DeviceCodeService {
  protected readonly dateTime = $inject(DateTimeProvider);

  /**
   * Records keyed by device code — what the polling device presents.
   */
  protected readonly byDevice = $cache<DeviceAuthorization>({
    name: "oauth-device-code",
    ttl: [DEVICE_CODE_TTL_SECONDS, "seconds"],
  });

  /**
   * Device code keyed by user code — what the human types.
   *
   * A second index rather than a second copy, so approval and polling can never
   * disagree about the state of one authorization.
   */
  protected readonly byUser = $cache<string>({
    name: "oauth-device-user-code",
    ttl: [DEVICE_CODE_TTL_SECONDS, "seconds"],
  });

  /**
   * Begins a device authorization.
   */
  async start(args: {
    clientId: string;
    scopes: string[];
    resource?: string;
  }): Promise<DeviceAuthorization> {
    const record: DeviceAuthorization = {
      // 32 bytes: this one is never retyped, so it can be as long as it likes,
      // and it is the value that actually protects the grant.
      deviceCode: randomBytes(32).toString("base64url"),
      userCode: this.generateUserCode(),
      clientId: args.clientId,
      scopes: args.scopes,
      resource: args.resource,
      status: "pending",
      createdAt: this.dateTime.nowMillis(),
      attempts: 0,
    };
    await this.byDevice.set(record.deviceCode, record);
    // Indexed under the NORMALIZED code: `byUserCode` normalizes what a human
    // typed, so storing the grouped form would make every lookup miss.
    await this.byUser.set(this.normalize(record.userCode), record.deviceCode);
    return record;
  }

  /**
   * Looks an authorization up by the code a human typed.
   *
   * Returns undefined for unknown or expired codes without saying which — the
   * approval page must not become an oracle for guessing valid codes.
   */
  async byUserCode(userCode: string): Promise<DeviceAuthorization | undefined> {
    const deviceCode = await this.byUser.get(this.normalize(userCode));
    if (!deviceCode) {
      return undefined;
    }
    return await this.byDevice.get(deviceCode);
  }

  /**
   * Records a human's decision.
   *
   * The caller must have authenticated that human: this only writes down who it
   * was. Approving on behalf of someone else is the one thing this grant must
   * never allow, and it is the caller's session that establishes identity.
   */
  async decide(
    userCode: string,
    decision: "approve" | "deny",
    userId: string,
  ): Promise<DeviceAuthorization> {
    const record = await this.byUserCode(userCode);
    if (!record) {
      throw new AlephaError("Unknown or expired code");
    }
    if (record.status !== "pending") {
      // Deciding twice is not an error to hide: the second answer must not
      // silently overwrite the first, or a denied grant could be re-approved.
      throw new AlephaError("This code has already been answered");
    }
    record.status = decision === "approve" ? "approved" : "denied";
    record.userId = userId;
    await this.byDevice.set(record.deviceCode, record);
    return record;
  }

  /**
   * Polls on behalf of the device.
   *
   * Enforces the interval here rather than trusting the client to: a client that
   * ignores it is exactly the one worth slowing down.
   */
  async poll(deviceCode: string): Promise<DevicePollResult> {
    const record = await this.byDevice.get(deviceCode);
    if (!record) {
      // Absent means expired or never existed. The device cannot act
      // differently on those, and distinguishing them would leak whether a
      // device code was ever valid.
      return { status: "expired" };
    }

    const now = this.dateTime.nowMillis();
    if (record.lastPolledAt) {
      const since = (now - record.lastPolledAt) / 1000;
      if (since < DEVICE_POLL_INTERVAL_SECONDS) {
        // Deliberately does NOT update lastPolledAt: a client hammering the
        // endpoint would otherwise keep pushing its own window forward and
        // never be allowed through.
        return { status: "slow_down" };
      }
    }
    record.lastPolledAt = now;
    await this.byDevice.set(record.deviceCode, record);

    switch (record.status) {
      case "approved":
        // Single use: the code is spent the moment it yields a token, so a
        // leaked device code cannot be replayed for a second one.
        await this.byDevice.invalidate(record.deviceCode);
        await this.byUser.invalidate(this.normalize(record.userCode));
        return {
          status: "approved",
          userId: record.userId!,
          scopes: record.scopes,
          resource: record.resource,
        };
      case "denied":
        await this.byDevice.invalidate(record.deviceCode);
        await this.byUser.invalidate(this.normalize(record.userCode));
        return { status: "denied" };
      default:
        return { status: "pending" };
    }
  }

  /**
   * Normalizes what a human typed: case and separators carry no meaning.
   */
  normalize(userCode: string): string {
    return userCode.toUpperCase().replace(/[^A-Z0-9]/g, "");
  }

  /**
   * Compares two user codes without leaking timing.
   *
   * The codes are short enough that a timing side channel is worth closing
   * rather than argued about.
   */
  matches(a: string, b: string): boolean {
    const left = Buffer.from(this.normalize(a));
    const right = Buffer.from(this.normalize(b));
    if (left.length !== right.length) {
      return false;
    }
    return timingSafeEqual(left, right);
  }

  /**
   * Eight characters from a 22-symbol alphabet — about 35 bits, well past the
   * 20 RFC 8628 asks for, and still short enough to read aloud.
   *
   * `randomInt` rather than `randomBytes` modulo: taking a byte mod 22 is
   * biased toward the first symbols, which quietly costs entropy.
   */
  protected generateUserCode(): string {
    let out = "";
    for (let i = 0; i < 8; i++) {
      out += USER_CODE_ALPHABET[randomInt(USER_CODE_ALPHABET.length)];
    }
    // Grouped for reading; the separator is stripped on the way back in.
    return `${out.slice(0, 4)}-${out.slice(4)}`;
  }
}
