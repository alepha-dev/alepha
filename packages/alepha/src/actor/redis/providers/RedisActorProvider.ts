import { $inject, $store, Alepha, AlephaError } from "alepha";
import {
  ActorCodec,
  ActorProvider,
  ActorRegistry,
  type ActorRequest,
  type ActorEnvelope,
} from "alepha/actor";

import { actorRedisOptions } from "../actorRedisOptions.ts";
import { ActorContentionError } from "../errors/ActorContentionError.ts";
import { ActorRedisConnection } from "./ActorRedisConnection.ts";

/**
 * One-key exact-byte CAS of validated actor envelopes using Redis eval.
 * Only a definite CAS conflict retries a pure reducer. Transport errors have
 * an unknown outcome and propagate without retry. No cache, expiry or eviction.
 */
export class RedisActorProvider extends ActorProvider {
  protected readonly alepha = $inject(Alepha);
  protected readonly codec = $inject(ActorCodec);
  protected readonly registry = $inject(ActorRegistry);
  protected readonly settings = $store(actorRedisOptions);
  protected readonly redis = $inject(ActorRedisConnection);
  protected readonly queues = new Map<string, Promise<unknown>>();
  protected static readonly cas = `local current = redis.call('GET', KEYS[1])
if ARGV[1] == 'missing' then
  if current then return 0 end
else
  if current ~= ARGV[2] then return 0 end
end
redis.call('SET', KEYS[1], ARGV[3])
return 1`;

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
    const max = this.settings.maxAttempts;
    if (!Number.isSafeInteger(max) || max < 1)
      throw new AlephaError(
        "Actor maxAttempts must be a positive safe integer",
      );
    for (let attempt = 0; attempt < max; attempt++) {
      const raw = (await this.redis.get(identity))?.toString("utf8");
      const envelope =
        raw === undefined
          ? this.codec.initial(declaration)
          : this.codec.decode(raw, declaration);
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
      if (await this.compareAndSet(identity, raw, next))
        return this.codec.copy(next.state);
    }
    throw new ActorContentionError("Actor transition contention exhausted");
  }

  protected async compareAndSet(
    identity: string,
    raw: string | undefined,
    next: ActorEnvelope,
  ): Promise<boolean> {
    const result = await this.redis.eval(
      RedisActorProvider.cas,
      [identity],
      [
        raw === undefined ? "missing" : "present",
        raw ?? "",
        JSON.stringify(next),
      ],
    );
    if (result !== 0 && result !== 1)
      throw new AlephaError("Unexpected actor CAS response");
    return result === 1;
  }
}
