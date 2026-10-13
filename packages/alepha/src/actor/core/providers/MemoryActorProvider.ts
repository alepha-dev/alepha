import { $inject, Alepha } from "alepha";
import { DateTimeProvider } from "alepha/datetime";

import type { ActorRequest } from "../interfaces/ActorInterfaces.ts";
import { ActorCodec } from "./ActorCodec.ts";
import { ActorProvider } from "./ActorProvider.ts";
import { ActorRegistry } from "./ActorRegistry.ts";

/**
 * Volatile actor snapshots scoped to one container, serialized per identity.
 * Expired snapshots are reclaimed by a bounded sweep on every write.
 */
export class MemoryActorProvider extends ActorProvider {
  protected readonly alepha = $inject(Alepha);
  protected readonly codec = $inject(ActorCodec);
  protected readonly registry = $inject(ActorRegistry);
  protected readonly dateTime = $inject(DateTimeProvider);
  protected readonly snapshots = new Map<string, string>();
  protected readonly queues = new Map<string, Promise<unknown>>();
  /**
   * `expiresAt` of every stored v2 snapshot, kept beside the raw string so the
   * sweep never decodes state.
   */
  protected readonly expiries = new Map<string, number>();
  /**
   * Entries checked per write. Deterministic: a cursor walks `expiries`, so
   * every expired snapshot is reclaimed within `expiries.size / sweepSize`
   * writes, and a single-instance app cannot grow its Map without bound.
   */
  protected readonly sweepSize = 8;
  protected cursor?: MapIterator<[string, number]>;

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
        const now = this.dateTime.nowMillis();
        const envelope = this.codec.current(raw, declaration, now);
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
        if (updated !== envelope) {
          this.snapshots.set(identity, JSON.stringify(updated));
          if (updated.expiresAt === undefined) this.expiries.delete(identity);
          else this.expiries.set(identity, updated.expiresAt);
          this.sweep(now);
        }
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

  /**
   * Check at most `sweepSize` entries from the cursor and delete the expired
   * ones. Safe without the identity queues: every operation reads, transitions
   * and writes synchronously, and an expired snapshot already reads as missing.
   */
  protected sweep(now: number): void {
    for (let checked = 0; checked < this.sweepSize; checked++) {
      let entry = this.cursor?.next();
      if (!entry || entry.done) {
        this.cursor = this.expiries.entries();
        entry = this.cursor.next();
        if (entry.done) return;
      }
      const [identity, expiresAt] = entry.value;
      if (expiresAt <= now) {
        this.expiries.delete(identity);
        this.snapshots.delete(identity);
      }
    }
  }
}
