import { $inject, Alepha } from "alepha";

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
  protected readonly snapshots = new Map<string, string>();
  protected readonly queues = new Map<string, Promise<unknown>>();

  public override execute(request: ActorRequest): Promise<unknown> {
    const identity = this.codec.identity(
      String(this.alepha.env.ALEPHA_ACTOR_NAMESPACE ?? ""),
      request.name,
      request.key,
    );
    const operation = (this.queues.get(identity) ?? Promise.resolve())
      .catch(() => {})
      .then(() => {
        const declaration = this.registry.get(request.name);
        const raw = this.snapshots.get(identity);
        let envelope =
          raw === undefined
            ? this.codec.initial(declaration)
            : this.codec.decode(raw, declaration);
        if (raw === undefined)
          this.snapshots.set(identity, JSON.stringify(envelope));
        if (request.method !== undefined)
          envelope = this.codec.transition(
            declaration,
            envelope,
            request.method,
            request.args,
          );
        this.snapshots.set(identity, JSON.stringify(envelope));
        return this.codec.copy(envelope.state);
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
