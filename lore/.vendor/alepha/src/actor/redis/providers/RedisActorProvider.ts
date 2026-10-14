import { $inject, $store, Alepha, AlephaError } from "alepha";
import {
  ActorCodec,
  ActorContentionError,
  ActorProvider,
  ActorRegistry,
  type ActorRequest,
  type ActorEnvelope,
} from "alepha/actor";
import { DateTimeProvider } from "alepha/datetime";

import { actorRedisOptions } from "../actorRedisOptions.ts";
import { ActorRedisConnection } from "./ActorRedisConnection.ts";

/**
 * One-key exact-byte CAS of validated actor envelopes using Redis eval.
 * Only a definite CAS conflict retries a pure reducer. Transport errors have
 * an unknown outcome and propagate without retry. Expiry is lazy: an expired
 * envelope reads as missing, and Redis drops the key at `expiresAt` plus
 * `expiryGraceMs`. No local cache.
 */
export class RedisActorProvider extends ActorProvider {
  protected readonly alepha = $inject(Alepha);
  protected readonly codec = $inject(ActorCodec);
  protected readonly registry = $inject(ActorRegistry);
  protected readonly dateTime = $inject(DateTimeProvider);
  protected readonly settings = $store(actorRedisOptions);
  protected readonly redis = $inject(ActorRedisConnection);
  protected readonly queues = new Map<string, Promise<unknown>>();
  /**
   * Exact-byte compare-and-set. On a conflict it returns the value present, so
   * a retry needs no GET; `{0}` alone means the key is gone (deleted or
   * evicted meanwhile) and the retry treats it as missing. An expiring (v2)
   * envelope is written with `PXAT` (Redis 6.2+); a v1 envelope with a plain
   * SET, which also clears any expiry the key had.
   */
  protected static readonly cas = `local current = redis.call('GET', KEYS[1])
if ARGV[1] == 'missing' then
  if current then return {0, current} end
else
  if current ~= ARGV[2] then
    if current then return {0, current} end
    return {0}
  end
end
if ARGV[4] == '' then
  redis.call('SET', KEYS[1], ARGV[3])
else
  redis.call('SET', KEYS[1], ARGV[3], 'PXAT', ARGV[4])
end
return {1}`;

  public override execute(request: ActorRequest): Promise<unknown> {
    const identity = this.codec.identity(
      this.alepha.name,
      request.name,
      request.key,
    );
    const args = this.codec.copy(request.args);
    const operation = (this.queues.get(identity) ?? Promise.resolve())
      .catch(() => {})
      .then(() => this.commit(identity, { ...request, args }));
    this.queues.set(identity, operation);
    void operation
      .finally(() => {
        if (this.queues.get(identity) === operation)
          this.queues.delete(identity);
      })
      .catch(() => {});
    return operation;
  }

  protected async commit(
    identity: string,
    request: ActorRequest,
  ): Promise<unknown> {
    const declaration = this.registry.get(request.name);
    const { maxAttempts: max, baseDelayMs, maxDelayMs } = this.settings;
    if (!Number.isSafeInteger(max) || max < 1)
      throw new AlephaError(
        "Actor maxAttempts must be a positive safe integer",
      );
    if (
      !Number.isSafeInteger(baseDelayMs) ||
      !Number.isSafeInteger(maxDelayMs) ||
      baseDelayMs < 0 ||
      maxDelayMs < baseDelayMs
    )
      throw new AlephaError(
        "Actor baseDelayMs and maxDelayMs must be integers with 0 <= baseDelayMs <= maxDelayMs",
      );
    // One GET, then one CAS per attempt: a conflict returns the current value.
    let raw = await this.load(identity);
    for (let attempt = 0; attempt < max; attempt++) {
      // An expired envelope reads as the initial state, but the CAS below still
      // compares against the raw bytes present, never against "missing".
      const envelope = this.codec.current(
        raw,
        declaration,
        this.dateTime.nowMillis(),
      );
      // A read never writes: a missing key stays missing.
      if (request.method === undefined) return this.codec.copy(envelope.state);
      const next = this.codec.transition(
        declaration,
        envelope,
        request.method,
        request.args,
      );
      // An unchanged state issues no CAS, on a missing key too.
      if (next === envelope) return this.codec.copy(envelope.state);
      const result = await this.compareAndSet(identity, raw, next);
      if (result.committed) return this.codec.copy(next.state);
      raw = result.current;
      // A definite conflict: back off before the next attempt, so replicas
      // contending on one hot key do not exhaust their attempts together.
      // Transport errors never get here: they propagate without retry.
      if (attempt + 1 < max) await this.backoff(attempt);
    }
    throw new ActorContentionError("Actor transition contention exhausted");
  }

  /**
   * Full-jitter exponential backoff after the given failed attempt (0-based),
   * slept through `DateTimeProvider` so specs control it.
   */
  protected backoff(attempt: number): Promise<void> {
    const { baseDelayMs, maxDelayMs } = this.settings;
    const cap = Math.min(maxDelayMs, baseDelayMs * 2 ** attempt);
    return this.dateTime.wait(Math.floor(this.random() * cap));
  }

  /**
   * The jitter's randomness, in [0, 1). Reducers never see it.
   */
  protected random(): number {
    return Math.random();
  }

  protected async load(identity: string): Promise<string | undefined> {
    return (await this.redis.get(identity))?.toString("utf8");
  }

  protected async compareAndSet(
    identity: string,
    raw: string | undefined,
    next: ActorEnvelope,
  ): Promise<{ committed: boolean; current?: string }> {
    const result = await this.redis.eval(
      RedisActorProvider.cas,
      [identity],
      [
        raw === undefined ? "missing" : "present",
        raw ?? "",
        JSON.stringify(next),
        next.expiresAt === undefined
          ? ""
          : String(next.expiresAt + this.settings.expiryGraceMs),
      ],
    );
    if (!Array.isArray(result) || (result[0] !== 0 && result[0] !== 1))
      throw new AlephaError("Unexpected actor CAS response");
    if (result[0] === 1) return { committed: true };
    const current = result[1];
    if (current === undefined || current === null) return { committed: false };
    return {
      committed: false,
      current:
        typeof current === "string"
          ? current
          : new TextDecoder().decode(current as Uint8Array),
    };
  }
}
