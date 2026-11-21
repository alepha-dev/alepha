import { $inject, AlephaError } from "alepha";
import { $cache } from "alepha/cache";
import { CryptoProvider } from "alepha/crypto";
import { DateTimeProvider } from "alepha/datetime";
import { $rateLimit } from "alepha/rate-limit";
import { HttpError } from "alepha/server";

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
 * What a human answered, kept apart from the authorization it answers.
 */
export interface DeviceDecision {
  status: "approved" | "denied";
  userId: string;
}

/**
 * The result of one poll, shaped so the caller cannot forget a case.
 *
 * An approved result names the client the flow was STARTED as, which is the
 * one the human approved. The token endpoint binds the session to it and holds
 * the poll's own `client_id` to it (#Q2388): taking the poll's word instead let
 * a device start as one client and collect a session bound to another.
 */
export type DevicePollResult =
  | { status: "pending" }
  | { status: "slow_down" }
  | { status: "denied" }
  | { status: "expired" }
  | {
      status: "approved";
      userId: string;
      clientId: string;
      scopes: string[];
      resource?: string;
    };

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
 * An authorization is three entries, each with one writer, so no write can
 * undo another: the record `start` wrote and nobody rewrites, the human's
 * decision, and the time of the device's last poll. The two transitions that
 * must happen once (a decision, the handing over of the grant) are claimed
 * through the cache's atomic counter, so they hold between instances
 * sharing a cache. Every entry ends with the record: `expires_in` is counted
 * from `createdAt` and checked on every read.
 *
 * ⚠ With the default in-memory cache this only holds for a single process. Run
 * more than one instance behind a load balancer and a poll can land on a node
 * that never saw the authorization: configure a shared cache provider
 * (`DatabaseCacheProvider`, Redis) before scaling out.
 */
export class DeviceCodeService {
  protected readonly dateTime = $inject(DateTimeProvider);
  protected readonly crypto = $inject(CryptoProvider);

  /**
   * Alphabet for the code a human retypes.
   *
   * No vowels, so no code can spell something unfortunate. No `0/O`,
   * `1/I/L`, `5/S`, `2/Z`, `8/B`: every pair someone would mistype reading a
   * code off one screen and into another, which is the entire situation
   * this grant exists for.
   */
  protected readonly userCodeAlphabet = "CDFGHJKMNPQRTVWXY34679";

  /**
   * Authorizations as started, keyed by device code: what the polling device
   * presents. Written once, by `start`.
   */
  protected readonly byDevice = $cache<DeviceAuthorization>({
    name: "oauth-device-code",
    ttl: [DEVICE_CODE_TTL_SECONDS, "seconds"],
  });

  /**
   * Device code keyed by user code: what the human types.
   *
   * A second index rather than a second copy, so approval and polling can never
   * disagree about the state of one authorization.
   */
  protected readonly byUser = $cache<string>({
    name: "oauth-device-user-code",
    ttl: [DEVICE_CODE_TTL_SECONDS, "seconds"],
  });

  /**
   * The human's answer, keyed by device code. Written once, by whoever won
   * the `decide` claim.
   */
  protected readonly decisions = $cache<DeviceDecision>({
    name: "oauth-device-decision",
    ttl: [DEVICE_CODE_TTL_SECONDS, "seconds"],
  });

  /**
   * When the device last polled, keyed by device code. Written by `poll`
   * alone.
   */
  protected readonly polls = $cache<number>({
    name: "oauth-device-poll",
    ttl: [DEVICE_CODE_TTL_SECONDS, "seconds"],
  });

  /**
   * Counters behind the two transitions that happen once: `decide:<code>`
   * and `redeem:<code>`. The caller that takes a counter from 0 to 1 owns
   * the transition; any other finds it taken.
   */
  protected readonly claims = $cache<number>({
    name: "oauth-device-claim",
    ttl: [DEVICE_CODE_TTL_SECONDS, "seconds"],
  });

  /**
   * Wrong user codes per asker, keyed by whoever was doing the looking.
   *
   * Not on the authorization record, which is where a counter first looks
   * like it belongs: a wrong code resolves to no record at all, so there is
   * nothing there to count. The guess is counted against the guesser instead,
   * BEFORE the lookup, so a burst of parallel guesses cannot all slip under
   * the ceiling (#Q2529); a code that resolves gives its slot back. Same
   * window as the codes' lifetime.
   */
  protected readonly attempts = $rateLimit({
    name: "oauth:device-user-code",
    limit: DEVICE_USER_CODE_MAX_ATTEMPTS,
    window: [DEVICE_CODE_TTL_SECONDS, "seconds"],
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
      // 43 base64url characters, 256 bits: this one is never retyped, so it
      // can be as long as it likes, and it is the value that actually
      // protects the grant.
      deviceCode: this.crypto.randomText(43),
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
   * Returns undefined for unknown or expired codes without saying which: the
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
    const attempt = by ? await this.attempts.consume(by) : undefined;
    if (attempt && !attempt.allowed) {
      // An outage is not a wrong code: answering "unknown" would send a real
      // user back to retype a right one.
      if (attempt.reason === "store")
        throw new HttpError(
          { status: 503 },
          { message: "Device authorization is temporarily unavailable" },
        );
      // Indistinguishable from a wrong code on purpose. Saying "too many
      // attempts" would tell someone enumerating codes that they are being
      // counted, and which of their guesses were even considered.
      return undefined;
    }

    const deviceCode = await this.byUser.get(this.normalize(userCode));
    const record = deviceCode ? await this.live(deviceCode) : undefined;

    // Only wrong codes count: a code that resolves gives its slot back.
    if (record && attempt?.ticket) await this.attempts.refund(attempt.ticket);

    return record ? this.withDecision(record) : undefined;
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
    // Deciding twice is not an error to hide: the second answer must not
    // silently overwrite the first, or a denied grant could be re-approved.
    // The counter, not the status read above, is what refuses it: two
    // answers arriving together both read "pending".
    if (
      record.status !== "pending" ||
      (await this.claims.incr(`decide:${record.deviceCode}`)) !== 1
    ) {
      throw new AlephaError("This code has already been answered");
    }
    const answer: DeviceDecision = {
      status: decision === "approve" ? "approved" : "denied",
      userId,
    };
    await this.decisions.set(record.deviceCode, answer, this.remaining(record));
    return { ...record, ...answer };
  }

  /**
   * Polls on behalf of the device.
   *
   * Enforces the interval here rather than trusting the client to: a client that
   * ignores it is exactly the one worth slowing down.
   */
  async poll(deviceCode: string): Promise<DevicePollResult> {
    const record = await this.live(deviceCode);
    if (!record) {
      // Absent means expired or never existed. The device cannot act
      // differently on those, and distinguishing them would leak whether a
      // device code was ever valid.
      return { status: "expired" };
    }

    const now = this.dateTime.nowMillis();
    const lastPolledAt = await this.polls.get(deviceCode);
    if (lastPolledAt) {
      const since = (now - lastPolledAt) / 1000;
      if (since < DEVICE_POLL_INTERVAL_SECONDS) {
        // Deliberately does NOT update the last poll: a client hammering the
        // endpoint would otherwise keep pushing its own window forward and
        // never be allowed through.
        return { status: "slow_down" };
      }
    }
    await this.polls.set(deviceCode, now, this.remaining(record));

    const decision = await this.decisions.get(deviceCode);
    if (!decision) {
      return { status: "pending" };
    }
    // Single use: the code is spent the moment it yields an answer, so a
    // leaked device code cannot be replayed for a second token, and of two
    // polls arriving together one gets it.
    if ((await this.claims.incr(`redeem:${deviceCode}`)) !== 1) {
      return { status: "expired" };
    }
    await this.forget(record);
    if (decision.status === "denied") {
      return { status: "denied" };
    }
    return {
      status: "approved",
      userId: decision.userId,
      clientId: record.clientId,
      scopes: record.scopes,
      resource: record.resource,
    };
  }

  /**
   * The authorization a device code names, while `expires_in` has not
   * passed since it was started.
   *
   * The clock is read here as well as left to the cache: a store may keep an
   * entry longer than it was asked to, and a code past its lifetime must not
   * be approved or redeemed on the strength of that.
   */
  protected async live(
    deviceCode: string,
  ): Promise<DeviceAuthorization | undefined> {
    const record = await this.byDevice.get(deviceCode);
    if (!record) return undefined;
    if (this.remainingMillis(record) <= 0) {
      await this.forget(record);
      return undefined;
    }
    return record;
  }

  /**
   * The authorization with the human's answer and the last poll read in.
   */
  protected async withDecision(
    record: DeviceAuthorization,
  ): Promise<DeviceAuthorization> {
    const decision = await this.decisions.get(record.deviceCode);
    const lastPolledAt = await this.polls.get(record.deviceCode);
    return {
      ...record,
      ...decision,
      ...(lastPolledAt ? { lastPolledAt } : {}),
    };
  }

  /**
   * Milliseconds the authorization has left, from when it was started.
   */
  protected remainingMillis(record: DeviceAuthorization): number {
    return (
      record.createdAt +
      DEVICE_CODE_TTL_SECONDS * 1000 -
      this.dateTime.nowMillis()
    );
  }

  /**
   * What the authorization has left, as the ttl of an entry written for it:
   * a later write never outlives the record.
   */
  protected remaining(record: DeviceAuthorization): [number, "milliseconds"] {
    return [Math.max(1, this.remainingMillis(record)), "milliseconds"];
  }

  /**
   * Drop everything read for an authorization. The claims stay until their
   * own ttl: they are what keeps a spent code spent.
   */
  protected async forget(record: DeviceAuthorization): Promise<void> {
    await this.byDevice.invalidate(record.deviceCode);
    await this.byUser.invalidate(this.normalize(record.userCode));
    await this.decisions.invalidate(record.deviceCode);
    await this.polls.invalidate(record.deviceCode);
  }

  /**
   * Normalizes what a human typed: case and separators carry no meaning.
   */
  normalize(userCode: string): string {
    return userCode.toUpperCase().replace(/[^A-Z0-9]/g, "");
  }

  /**
   * Eight characters from a 22-symbol alphabet, about 35 bits, well past the
   * 20 RFC 8628 asks for, and still short enough to read aloud.
   *
   * A uniform draw rather than a random byte modulo 22, which is biased
   * toward the first symbols and quietly costs entropy.
   */
  protected generateUserCode(): string {
    let out = "";
    for (let i = 0; i < 8; i++) {
      out +=
        this.userCodeAlphabet[
          this.crypto.randomInt(this.userCodeAlphabet.length)
        ];
    }
    // Grouped for reading; the separator is stripped on the way back in.
    return `${out.slice(0, 4)}-${out.slice(4)}`;
  }
}
