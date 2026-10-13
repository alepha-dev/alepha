import { $inject, Alepha } from "alepha";
import { DateTimeProvider } from "alepha/datetime";

import type { ActorRequest } from "../interfaces/ActorInterfaces.ts";
import { ActorCodec } from "./ActorCodec.ts";
import { ActorProvider } from "./ActorProvider.ts";
import { ActorRegistry } from "./ActorRegistry.ts";

/**
 * Volatile actor snapshots scoped to one container, serialized per identity.
 */
export class MemoryActorProvider extends ActorProvider {
  protected readonly alepha = $inject(Alepha);
  protected readonly codec = $inject(ActorCodec);
  protected readonly registry = $inject(ActorRegistry);
  protected readonly dateTime = $inject(DateTimeProvider);
  protected readonly snapshots = new Map<string, string>();
  protected readonly queues = new Map<string, Promise<unknown>>();

  public override execute(request: ActorRequest): Promise<unknown> {
    const identity = this.codec.identity(
      this.alepha.name,
      request.name,
      request.key,
    );
    const operation = (this.queues.get(identity) ?? Promise.resolve())
      .catch(() => {})
      .then(() => {
        const declaration = this.registry.get(request.name);
        const raw = this.snapshots.get(identity);
        const envelope = this.codec.current(
          raw,
          declaration,
          this.dateTime.nowMillis(),
        );
        // A read never writes: a missing key stays missing.
        if (request.method === undefined)
          return this.codec.copy(envelope.state);
        const updated = this.codec.transition(
          declaration,
          envelope,
          request.method,
          request.args,
        );
        // An unchanged state commits nothing, on a missing key too.
        if (updated !== envelope)
          this.snapshots.set(identity, JSON.stringify(updated));
        return this.codec.copy(updated.state);
      });
    this.queues.set(identity, operation);
    void operation
      .finally(() => {
        if (this.queues.get(identity) === operation)
          this.queues.delete(identity);
      })
      .catch(() => {});
    return operation;
  }
}
