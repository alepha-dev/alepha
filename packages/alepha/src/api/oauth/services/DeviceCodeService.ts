import { randomBytes, randomInt } from "node:crypto";

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
 * Wrong user codes one approver may try before the service stops answering.
 *
 * RFC 8628 §5.2 asks for a ceiling here, and 35 bits of entropy over a ten
 * minute window makes guessing hopeless on paper - but "hopeless on paper" is
 * what every unthrottled endpoint says right up until the alphabet or the TTL
 * changes. Five is generous for someone squinting at another screen.
 */
export const DEVICE_USER_CODE_MAX_ATTEMPTS = 5;

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
  /**
   * Set once a human approves.
   */
  userId?: string;
  createdAt: number;
  /**
   * Last poll, used to enforce the interval.
   */
  lastPolledAt?: number;
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
   * Failed user-code lookups, keyed by whoever was doing the looking.
   *
   * Not on the authorization record, which is where a counter first looks
   * like it belongs: a wrong code resolves to no record at all, so there is
   * nothing there to increment. The guess has to be counted against the
   * guesser instead. Same TTL as the codes, so the window closes on its own.
   */
  protected readonly failures = $cache<number>({
    name: "oauth-device-user-code-failures",
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
   *
   * @param by Who is asking, when the caller knows: the approver's user id,
   * or an address for an approval page that has not signed anyone in yet.
   * Passing it arms {@link DEVICE_USER_CODE_MAX_ATTEMPTS}; leaving it out asks
   * a question nobody is accountable for and gets no ceiling. `decide` always
   * passes the approver.
   */
  async byUserCode(
    userCode: string,
    by?: string,
  ): Promise<DeviceAuthorization | undefined> {
    if (by && (await this.failureCount(by)) >= DEVICE_USER_CODE_MAX_ATTEMPTS) {
      // Indistinguishable from a wrong code on purpose. Saying "too many
      // attempts" would tell someone enumerating codes that they are being
      // counted, and which of their guesses were even considered.
      return undefined;
    }

    const deviceCode = await this.byUser.get(this.normalize(userCode));
    const record = deviceCode ? await this.byDevice.get(deviceCode) : undefined;

    if (!record && by) {
      await this.failures.incr(by);
    }

    return record;
  }

  /**
   * Wrong codes tried by this asker so far in the current window.
   */
  async failureCount(by: string): Promise<number> {
    return (await this.failures.get(by)) ?? 0;
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
    // The approver is the guesser: a brute force here is someone signed in,
    // posting codes at the approval endpoint. Counting against `userId` is
    // what makes the ceiling reachable at all.
    const record = await this.byUserCode(userCode, userId);
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
